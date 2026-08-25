/**
 * routes/ui.ts — the Lát 4 UI-only endpoints (spec 009 Endpoints), kept SEPARATE from the Lát 3
 * gated `routes/tasks.ts` so the gate state machine is untouched:
 *
 *   - GET  /api/tree            → the Project ▸ Workflow ▸ Task sidebar tree (artifacts.buildTree)
 *   - GET  /api/seeds           → existing Dify apps for the seed picker. The real producer
 *                                 (`sync.py list`) lands in Lát 5; here it DEGRADES to an empty list
 *                                 (`{seeds:[], note}`) so the UI renders gracefully (spec Endpoints).
 *   - GET  /api/tasks/:id/spec  → the current SPEC.md content (for the editable artifact panel)
 *   - PUT  /api/tasks/:id/spec  → persist an in-place SPEC.md edit (explicit Save, last-writer; the
 *                                 raw markdown body is written to the SAME path the §A gate-check +
 *                                 Implement re-read, so a manual edit wins — spec §Revision Cleanups).
 *
 * READ-only except the SPEC.md PUT — no gate/verify/spawn here (dumb-renderer guarantee). Origin is
 * checked on the mutating PUT by the global onRequest hook in index.ts (spec §J).
 */
import type { FastifyPluginAsync } from 'fastify';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { deleteTask, loadTask, taskDir } from '../state/task.js';
import { buildTree, listActiveTasks, listConsultTasks, listProjectTaskIds, listPromoteTasks, listWorkflowTaskIds, specPathFor, workflowPathFor } from '../lib/artifacts.js';
import { buildBundle } from '../lib/bundle.js';
import { loadShareConfig, postExportBundle } from '../lib/share.js';
import { localOverride } from '../lib/settings.js';
import type { FetchLike } from '../lib/orchestrator-shared.js';
import { revealInFileManager } from '../lib/reveal.js';
import { listSeeds } from '../lib/dify-io.js';
import { runPython as realRunPython } from '../lib/shell.js';
import { checkProjectName, scaffoldProjectTier } from '../lib/project-create.js';
import { importYamlAsBase, probeImportedBase, type BaseProbe } from '../lib/base-import.js';
import { evictCancelled, taskTurnRunning } from '../lib/lock.js';

export interface UiRoutesOptions {
  projectsDir: string;
  /** Injected so the tree's relative-time labels are deterministic per request (no Date in lib). */
  now: () => number;
  /** 013-D2 seam: tests inject a fake spawn; production uses the real `init_project.py` runner. */
  runPython?: typeof realRunPython;
  /** spec 051 D2 seam: the optional import-probe. Tests inject a no-op/fake (hermetic — the real probe
   *  would hit Dify when the dev has creds in their env); production uses the real `probeImportedBase`. */
  importProbe?: BaseProbe;
  /** spec 062 follow-up: the fetch used to POST an export bundle to the team Drive drop. Tests inject a
   *  fake; production uses the global fetch. */
  fetchFn?: FetchLike;
}

const uiRoutes: FastifyPluginAsync<UiRoutesOptions> = async (app, opts) => {
  const { projectsDir, now } = opts;
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const runPython = opts.runPython ?? realRunPython;
  const importProbe = opts.importProbe ?? probeImportedBase;

  // taskId is a 13+-digit ms timestamp (mintTaskId). Reject anything else BEFORE it reaches
  // loadTask → join(.runs, id, …): a crafted id like `../../..` would otherwise path-traverse off
  // the runs dir (spec §J confinement; the dev-endpoint slug guard does the same in index.ts).
  const isTaskId = (id: string): boolean => /^\d{13,}$/.test(id);

  /** Content-Type for a served upload. Images get their real type (the browser must render them in the
   *  history bubble); everything else is served as a download-safe octet-stream — we are handing back
   *  user-supplied bytes, so no text/html sniffing surface. */
  const uploadMime = (name: string): string => {
    const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
    const img: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
    return img[ext] ?? 'application/octet-stream';
  };

  // ── GET /api/tree — 3-level sidebar tree: a direct 2-level walk of projects/<project>/<workflow>/ (spec 030) ──
  app.get('/api/tree', async () => {
    return { projects: await buildTree(projectsDir, now()) };
  });

  // ── POST /api/projects — scaffold an EMPTY project tier on demand (spec 031): projects/<slug>/ manifest
  //    + envs, NO workflow. The exact `init_project.py --kind project` the Spec gate makes (shared argv via
  //    scaffoldProjectTier). D3: an English/folder-safe name is required — a non-English name is REJECTED
  //    (400), never coerced. D4: a name that collides with an existing folder returns 409 { error, existing }
  //    so the modal offers "open existing". Not a build turn → no confinement / gate interaction. Origin is
  //    checked on this mutating POST by the global onRequest hook (index.ts). ──
  app.post('/api/projects', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const check = checkProjectName(String(body.name ?? ''));
    if (!check.ok) return reply.code(400).send({ error: check.error }); // name_required | name_charset | reserved
    const slug = check.slug;
    const name = String(body.name).trim();

    const projectDirAbs = join(projectsDir, 'projects', slug);
    if (existsSync(projectDirAbs)) return reply.code(409).send({ error: 'project exists', existing: slug }); // D4

    const r = await scaffoldProjectTier(projectsDir, slug, name, runPython);
    if (r.code !== 0) {
      return reply.code(500).send({ error: `scaffold failed: ${(r.stderr || r.stdout).trim().slice(0, 300)}` });
    }
    return reply.send({ project: slug, name });
  });

  // ── DELETE /api/projects/:project — spec 084 follow-up: PERMANENTLY remove a whole project (its
  //    `projects/<slug>/` folder = ALL its workflows/YAML) + CASCADE-remove every build record (.runs/<id>
  //    whose task.project matches), so no orphan task re-homes under _drafts. Guards:
  //      - the `_drafts` scratch home is a SYSTEM project → 400 (never deletable).
  //      - a traversal / bad slug → 400; a missing project → 404.
  //      - any build of this project has a turn RUNNING → 409 (cancel it first). ──
  app.delete<{ Params: { project: string } }>('/api/projects/:project', async (req, reply) => {
    const slug = req.params.project;
    if (!/^[A-Za-z0-9._-]+$/.test(slug) || slug === '..' || slug === '.') {
      return reply.code(400).send({ error: 'invalid project slug' });
    }
    if (slug === '_drafts') {
      return reply.code(400).send({ error: 'the _drafts scratch area is a system project and cannot be deleted' });
    }
    const projectDirAbs = join(projectsDir, 'projects', slug);
    if (!existsSync(projectDirAbs)) return reply.code(404).send({ error: `no such project: ${slug}` });

    const taskIds = await listProjectTaskIds(projectsDir, slug);
    if (taskIds.some((id) => taskTurnRunning(id))) {
      return reply.code(409).send({ error: 'a build in this project has a turn running — cancel it before deleting the project' });
    }
    await rm(projectDirAbs, { recursive: true, force: true }); // the folder (all workflows/YAML)
    for (const id of taskIds) {
      await deleteTask(projectsDir, id); // cascade the build records
      evictCancelled(id);
    }
    return reply.send({ ok: true, tasksRemoved: taskIds.length });
  });

  // ── DELETE /api/projects/:project/workflows/:workflow — spec 084 follow-up: remove ONE workflow (its
  //    `projects/<project>/<workflow>/` folder) + CASCADE its build records. The Build/`_drafts` rows ARE
  //    workflows (a from-scratch build scaffolds `projects/_drafts/<slug>/`), so this is the "delete a junk
  //    build" door. Guards mirror project-delete (bad slug → 400, missing → 404, a running turn → 409).
  //    `_drafts` workflows ARE deletable here (that's the point — clearing scratch); only the `_drafts`
  //    PROJECT itself is protected. ──
  app.delete<{ Params: { project: string; workflow: string } }>('/api/projects/:project/workflows/:workflow', async (req, reply) => {
    const { project, workflow } = req.params;
    const safe = (s: string): boolean => /^[A-Za-z0-9._-]+$/.test(s) && s !== '..' && s !== '.';
    if (!safe(project) || !safe(workflow)) return reply.code(400).send({ error: 'invalid slug' });
    const wfDirAbs = join(projectsDir, 'projects', project, workflow);
    if (!existsSync(wfDirAbs)) return reply.code(404).send({ error: `no such workflow: ${project}/${workflow}` });

    const taskIds = await listWorkflowTaskIds(projectsDir, project, workflow);
    if (taskIds.some((id) => taskTurnRunning(id))) {
      return reply.code(409).send({ error: 'a build in this workflow has a turn running — cancel it before deleting it' });
    }
    await rm(wfDirAbs, { recursive: true, force: true });
    for (const id of taskIds) {
      await deleteTask(projectsDir, id);
      evictCancelled(id);
    }
    return reply.send({ ok: true, tasksRemoved: taskIds.length });
  });

  // ── POST /api/bases — import ONE standalone YAML as a local edit-existing base (spec 051 D1). A raw
  //    `.yml` a field user hands over reaches neither base door today; this validates it (D2: the same
  //    4-linter gate the ③ build gate runs), derives a folder slug (JP `app.name` preserved for the
  //    chip label — the slug is a separate ASCII concern), scaffolds the workflow tier, and writes the
  //    file verbatim to projects/<project>/<slug>/workflows/main.yml — whence /api/tree lists it as a
  //    base for free (D4). NOT a build turn → no gate/turn interaction (like POST /api/projects). Origin
  //    is checked on this mutating POST by the global onRequest hook (index.ts). ──
  app.post('/api/bases', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const r = await importYamlAsBase(
      projectsDir,
      { yaml: body.yaml, name: body.name, project: body.project, fileName: body.fileName },
      runPython,
      importProbe
    );
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return reply.send({
      project: r.project,
      workflow: r.workflow,
      ...(r.slugNote ? { slugNote: r.slugNote } : {}),
      ...(r.probeNote ? { probeNote: r.probeNote } : {}),
    });
  });

  // ── GET /api/active — the in-progress builds (non-terminal), newest first (Lát 6). With the
  //    turn-level lock, multiple builds can sit parked at gates; the SPA fetches this on load to list
  //    + reach them all so a parked build is never stranded (extends AC #22 to the no-taskId case). ──
  app.get('/api/active', async () => {
    return { active: await listActiveTasks(projectsDir, now()) };
  });

  // ── GET /api/consults — the consult chats (spec 082), newest first. Their one listing surface:
  //    excluded from /api/tree (no project) and from /api/active (born `done`, never non-terminal). ──
  app.get('/api/consults', async () => {
    return { consults: await listConsultTasks(projectsDir, now()) };
  });

  // ── GET /api/promotes — the distill/promote tasks (spec 084 S1.5), newest first. Their own sidebar
  //    "蒸留" section: excluded from /api/tree, shows ALL (incl. done/shared) as history. ──
  app.get('/api/promotes', async () => {
    return { promotes: await listPromoteTasks(projectsDir, now()) };
  });

  // ── GET /api/seeds — existing Dify apps (backend `sync.py list`, token backend-only). Degrades
  //    GRACEFULLY: `list` exits 1 for BOTH no-creds AND request failure (indistinguishable by code),
  //    so we parse stderr → reason and ALWAYS return HTTP 200 with an empty list + reason (the picker
  //    renders an empty list, never an error toast). The token is on the child env only, never logged. ──
  app.get('/api/seeds', async () => {
    const { seeds, reason, stderrTail } = await listSeeds(projectsDir);
    const NOTE: Record<string, string> = {
      'no-credentials': 'connect Dify (DIFY_CONSOLE_URL / DIFY_CONSOLE_TOKEN) to seed from a workspace app',
      'dify-unreachable': 'Dify unreachable — check DIFY_CONSOLE_URL and that the workspace is up',
      unknown: 'could not list Dify apps',
    };
    if (reason) {
      app.log.warn({ reason, stderrTail }, 'seeds: degraded to empty list');
      return { seeds: [], reason, note: NOTE[reason] };
    }
    // Map app_id → the UI's `Seed.id` (the picker feeds this id back as the createTask `seed`).
    return { seeds: seeds.map((s) => ({ id: s.app_id, name: s.name, mode: s.mode })) };
  });

  // ── GET /api/tasks/:id/spec — current SPEC.md content for the editable panel ──
  app.get<{ Params: { id: string } }>('/api/tasks/:id/spec', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    const { readFile } = await import('node:fs/promises');
    try {
      const content = await readFile(specPathFor(projectsDir, task), 'utf8');
      return { content };
    } catch {
      return { content: '' }; // pre-Spec phase → no SPEC.md yet; panel shows empty
    }
  });

  // ── GET /api/tasks/:id/uploads/:idx — serve one file the user attached to THIS task, so the chat
  //    history can show it back (an <img> thumbnail for an image, a download link otherwise). Read-only,
  //    no gate/turn, hence here beside the other GETs.
  //
  //    The index addresses `task.attachments[idx]` — our OWN recorded list, not a caller-supplied path —
  //    and the resolved file must still sit inside this task's `uploads/` dir, so a crafted id/index
  //    can't read anything else. Files are immutable once written (uploads never overwrite — the index
  //    keeps climbing, spec 025 D6), so the response is safely cacheable forever.
  //
  //    WHY a route at all: the composer holds base64 data-URLs, and stuffing those into the persisted
  //    thread would blow the ~5MB localStorage quota with a single screenshot. Serving from disk is what
  //    keeps a reopened build's history showing the files it was given. ──
  app.get<{ Params: { id: string; idx: string } }>('/api/tasks/:id/uploads/:idx', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0) return reply.code(400).send({ error: 'invalid upload index' });
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    const rel = task.attachments?.[idx];
    if (!rel) return reply.code(404).send({ error: 'no such upload' });
    const abs = resolve(projectsDir, rel);
    const dir = join(taskDir(projectsDir, task.taskId), 'uploads');
    if (!abs.startsWith(dir + sep)) {
      app.log.warn({ taskId: task.taskId, rel }, 'upload path escapes the task uploads dir — refusing');
      return reply.code(404).send({ error: 'no such upload' });
    }
    const { readFile } = await import('node:fs/promises');
    try {
      const bytes = await readFile(abs);
      const name = abs.slice(dir.length + 1);
      return reply
        .header('Content-Type', uploadMime(name))
        .header('Content-Disposition', `inline; filename="${name.replace(/[^A-Za-z0-9._-]+/g, '-')}"`)
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .send(bytes);
    } catch {
      return reply.code(404).send({ error: 'no such upload' });
    }
  });

  // ── PUT /api/tasks/:id/spec — persist an in-place SPEC.md edit (last-writer) ──
  app.put<{ Params: { id: string } }>('/api/tasks/:id/spec', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    // Spec 033 §1 mandatory fix: this manual Save had NO turn-lock check — a race with ANY live turn
    // (a phase turn OR an Ask) risked silent last-writer-wins data loss, and specifically undermined
    // Ask's layer-2 byte-compare (a legitimate Save landing inside the Ask's snapshot window would be
    // misattributed to the Ask and wrongly restored-over). Mirrors the identical guard at
    // PATCH /api/tasks/:id (routes/tasks.ts).
    if (taskTurnRunning(req.params.id)) {
      return reply.code(409).send({ error: 'a turn is running for this build — save once it pauses' });
    }
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    // Spec 103 Lane B — refuse while a spec PROPOSAL is open. The panel shows the DRAFT then, and a
    // write aimed at the live spec would be destroyed moments later by `apply`'s rename: the human
    // would see "saved", then watch the edit vanish with no message. Silent data loss wearing the
    // costume of a successful save; a 409 they can act on is strictly better.
    if (task.specRevise) {
      return reply.code(409).send({ error: 'a plan is waiting for your decision — settle it before editing the spec' });
    }
    // Accept the raw markdown body (text/plain) OR a JSON `{content}` envelope.
    const body = req.body;
    const content =
      typeof body === 'string'
        ? body
        : typeof (body as { content?: unknown })?.content === 'string'
          ? (body as { content: string }).content
          : null;
    if (content == null) {
      return reply.code(400).send({ error: 'spec content is required (raw markdown or {content})' });
    }
    // Reject a blank Save: an empty SPEC.md would arm the ② gate's "artifact empty" failure on the
    // next Implement, which the user wouldn't connect to their own clear-and-save (last-writer foot-gun).
    if (content.trim() === '') {
      return reply.code(400).send({ error: 'SPEC.md cannot be empty' });
    }
    await writeFile(specPathFor(projectsDir, task), content);
    return { ok: true, path: specPathFor(projectsDir, task) };
  });

  // ── GET /api/tasks/:id/bundle — the run dossier zip (spec 062). A READ endpoint (no gate/turn), so it
  //    lives here beside the spec GET, not in the gated routes/tasks.ts. `buildBundle` reads ONLY the run
  //    dir + the task's workflow subtree (confinement, S5); the id is validated first so a crafted id
  //    can't traverse. Streams `application/zip` with a sanitized download filename. ──
  app.get<{ Params: { id: string } }>('/api/tasks/:id/bundle', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    try {
      const zip = await buildBundle(projectsDir, task);
      // Sanitize the slug for the Content-Disposition filename (a stray char can't break the header).
      const slug = (task.workflowSlug || 'run').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'run';
      const filename = `builder-${slug}-${task.taskId}.zip`;
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', String(zip.length))
        .send(zip);
    } catch (e) {
      app.log.error({ err: String(e), taskId: req.params.id }, 'bundle assembly failed');
      return reply.code(500).send({ error: 'could not assemble the run bundle' });
    }
  });

  // ── POST /api/tasks/:id/export-drive — spec 062 follow-up: upload the run dossier zip STRAIGHT to the
  //    team's Drive (exports/ folder), reusing the share drop (URL/secret). No drop configured → 409, so
  //    the FE falls back to the plain download. ──
  app.post<{ Params: { id: string } }>('/api/tasks/:id/export-drive', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    const cfg = await loadShareConfig(projectsDir);
    if (!cfg) return reply.code(409).send({ error: 'no team Drive configured' }); // FE → download fallback
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    let zip: Buffer;
    try {
      zip = await buildBundle(projectsDir, task);
    } catch (e) {
      app.log.error({ err: String(e), taskId: req.params.id }, 'bundle assembly failed (export-drive)');
      return reply.code(500).send({ error: 'could not assemble the run bundle' });
    }
    const slug = (task.workflowSlug || 'run').replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'run';
    const who = await localOverride(projectsDir, 'contributor');
    const out = await postExportBundle(cfg, { slug, contributor: who, zipBase64: zip.toString('base64') }, fetchFn);
    if (!out.ok) return reply.code(502).send({ error: out.error });
    // `unconfirmed`: the write reached Google and almost certainly landed, but its redirect echo didn't
    // return a JSON ack — the FE shows a "verify in exports/" notice instead of a plain success.
    return reply.send({ ok: true, path: out.path, unconfirmed: out.unconfirmed ?? false });
  });

  // ── The two files the artifact panel shows, and the two the "reveal / copy path" actions address.
  //    A caller names WHICH artifact it means — never a path; both are resolved server-side from the
  //    task, which is what keeps these routes from becoming arbitrary-file handles.
  //
  //    Two literal comparisons rather than a lookup table: `which` is caller-supplied, and `w in TABLE`
  //    would answer true for 'constructor' and every other Object.prototype key. ──
  const isArtifactFile = (w: string): w is 'spec' | 'workflow' => w === 'spec' || w === 'workflow';
  const artifactPathFor = (task: Parameters<typeof specPathFor>[1], which: 'spec' | 'workflow'): string | null =>
    which === 'spec' ? specPathFor(projectsDir, task) : workflowPathFor(projectsDir, task);

  /** Shared preamble for both routes below: validate the id + `which`, load the task, resolve the file.
   *  Returns the absolute path, or the reply already sent. SPEC.md and the workflow YAML differ in WHEN
   *  they exist (a spec lands a phase earlier, and pre-scaffold it lives in the run dir), so "not on
   *  disk yet" is a normal answer for either — the UI hides the action rather than offering a dead path. */
  async function resolveArtifactFile(
    req: { params: { id: string }; query: { which?: string } },
    // Structural, not `FastifyReply`: the two routes below carry different route generics, and naming
    // either concrete type here would reject the other. All this needs is the ability to answer.
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ): Promise<string | null> {
    if (!isTaskId(req.params.id)) {
      void reply.code(400).send({ error: 'invalid task id' });
      return null;
    }
    const which = req.query.which ?? 'workflow'; // absent ⇒ the workflow YAML, as this route always meant
    if (!isArtifactFile(which)) {
      void reply.code(400).send({ error: `unknown file: ${which}` });
      return null;
    }
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      void reply.code(404).send({ error: `no such task: ${req.params.id}` });
      return null;
    }
    const abs = artifactPathFor(task, which);
    if (!abs || !existsSync(abs)) {
      void reply.code(404).send({ error: `${which} file not on disk yet` });
      return null;
    }
    return abs;
  }

  // ── GET /api/tasks/:id/artifact-path?which=spec|workflow — the ABSOLUTE path of one of the panel's
  //    files, as text. The "copy path" button: Reveal-in-Finder hands you the file in a GUI, this hands
  //    you the string you paste into a terminal or an editor's open-file box.
  //
  //    Read-only, so a GET and no side effect — deliberately NOT a flag on the reveal POST, which exists
  //    to spawn the file manager. Wanting the path is not wanting a window. ──
  app.get<{ Params: { id: string }; Querystring: { which?: string } }>(
    '/api/tasks/:id/artifact-path',
    async (req, reply) => {
      const abs = await resolveArtifactFile(req, reply);
      return abs === null ? reply : { path: abs };
    },
  );

  // ── POST /api/tasks/:id/reveal?which=spec|workflow — open the OS file manager at that file ("Reveal
  //    in Finder"). The launcher is spawned via execFile (no shell), so even a path with shell
  //    metacharacters is one argv element. Origin-checked by the global mutating-request hook
  //    (index.ts). `which` defaults to the workflow YAML: this route predates the parameter, and a
  //    caller that omits it must keep getting what it always got. ──
  app.post<{ Params: { id: string }; Querystring: { which?: string } }>(
    '/api/tasks/:id/reveal',
    async (req, reply) => {
      const abs = await resolveArtifactFile(req, reply);
      if (abs === null) return reply;
      try {
        await revealInFileManager(abs);
        return { ok: true, path: abs };
      } catch (e) {
        app.log.warn({ err: String(e) }, 'reveal-in-finder failed');
        return reply.code(500).send({ error: 'could not open the file manager' });
      }
    },
  );
};

export default uiRoutes;

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
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadTask } from '../state/task.js';
import { buildTree, listActiveTasks, specPathFor, workflowPathFor } from '../lib/artifacts.js';
import { revealInFileManager } from '../lib/reveal.js';
import { listSeeds } from '../lib/dify-io.js';
import { runPython as realRunPython } from '../lib/shell.js';
import { checkProjectName, scaffoldProjectTier } from '../lib/project-create.js';

export interface UiRoutesOptions {
  projectsDir: string;
  /** Injected so the tree's relative-time labels are deterministic per request (no Date in lib). */
  now: () => number;
  /** 013-D2 seam: tests inject a fake spawn; production uses the real `init_project.py` runner. */
  runPython?: typeof realRunPython;
}

const uiRoutes: FastifyPluginAsync<UiRoutesOptions> = async (app, opts) => {
  const { projectsDir, now } = opts;
  const runPython = opts.runPython ?? realRunPython;

  // taskId is a 13+-digit ms timestamp (mintTaskId). Reject anything else BEFORE it reaches
  // loadTask → join(.runs, id, …): a crafted id like `../../..` would otherwise path-traverse off
  // the runs dir (spec §J confinement; the dev-endpoint slug guard does the same in index.ts).
  const isTaskId = (id: string): boolean => /^\d{13,}$/.test(id);

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

  // ── GET /api/active — the in-progress builds (non-terminal), newest first (Lát 6). With the
  //    turn-level lock, multiple builds can sit parked at gates; the SPA fetches this on load to list
  //    + reach them all so a parked build is never stranded (extends AC #22 to the no-taskId case). ──
  app.get('/api/active', async () => {
    return { active: await listActiveTasks(projectsDir, now()) };
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

  // ── PUT /api/tasks/:id/spec — persist an in-place SPEC.md edit (last-writer) ──
  app.put<{ Params: { id: string } }>('/api/tasks/:id/spec', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
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

  // ── POST /api/tasks/:id/reveal — open the OS file manager at the task's workflow YAML ("Reveal in
  //    Finder"). The path is computed SERVER-SIDE from the task (never a client path), so this can't
  //    reveal an arbitrary file; the launcher is spawned via execFile (no shell). Origin-checked by the
  //    global mutating-request hook (index.ts). 404 before the file is scaffolded (no slug / not on disk). ──
  app.post<{ Params: { id: string } }>('/api/tasks/:id/reveal', async (req, reply) => {
    if (!isTaskId(req.params.id)) return reply.code(400).send({ error: 'invalid task id' });
    let task;
    try {
      task = await loadTask(projectsDir, req.params.id);
    } catch {
      return reply.code(404).send({ error: `no such task: ${req.params.id}` });
    }
    const abs = workflowPathFor(projectsDir, task);
    if (!abs || !existsSync(abs)) {
      return reply.code(404).send({ error: 'workflow file not on disk yet' });
    }
    try {
      await revealInFileManager(abs);
      return { ok: true, path: abs };
    } catch (e) {
      app.log.warn({ err: String(e) }, 'reveal-in-finder failed');
      return reply.code(500).send({ error: 'could not open the file manager' });
    }
  });
};

export default uiRoutes;

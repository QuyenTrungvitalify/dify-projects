/**
 * scaffold.ts — the project-scaffold / seed IO extracted out of orchestrator.ts (spec 019 L2 3.3).
 *
 * These were never part of the gate FSM — they prepare the filesystem (init_project.py, sync.py pull,
 * the pre-edit seed snapshot, the SPEC.md move, the post-turn artifact relocation) around it. Moved
 * VERBATIM: bodies unchanged; only the home moved. They take `(task, ctx)` and reach `emit` /
 * `resolveRunners` / the slug helpers from the leaf modules (no orchestrator import → no cycle).
 * `localEditSeed` is re-exported from orchestrator.ts (test/edit-existing.test.ts imports it there).
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SessionLogger } from './claude-session.js';
import { pullApp } from './dify-io.js';
import { emit, resolveRunners, type OrchestratorCtx, type ConfirmPayload } from './orchestrator-shared.js';
import { deriveSlugName, firstFreeSlug, titleCaseSlug } from './slug.js';
import { scaffoldProjectTier, scaffoldWorkflowTier } from './project-create.js';
import { DRAFTS_PROJECT, sanitizeSlug, saveTask, type Task } from '../state/task.js';

/**
 * Spec 030: idempotently scaffold the two on-disk tiers for a build — the PROJECT tier
 * (`projects/<project>/`: manifest + envs, created once per project) and the WORKFLOW tier
 * (`projects/<project>/<workflowSlug>/`: workflows/ SPEC.md prompts/ inputs/ tests/, per workflow).
 * Skips either init when its dir already exists (a partial prior run, an edit-existing target, or a
 * second workflow in the same project). Requires `task.project` + `task.workflowSlug` to be resolved.
 */
async function ensureScaffold(
  task: Task,
  ctx: OrchestratorCtx,
  runPython: ReturnType<typeof resolveRunners>['runPython']
): Promise<void> {
  const { projectsDir, log } = ctx;
  const project = task.project!;
  const workflowSlug = task.workflowSlug!;
  const projectManifestAbs = join(projectsDir, 'projects', project, '.dify-workspace.yaml');
  const wfDirAbs = join(projectsDir, 'projects', project, workflowSlug);

  // Project tier — created once (skip when the manifest already exists). Shares the argv with the
  // modal's POST /api/projects route via scaffoldProjectTier (spec 031 — one source of truth).
  if (!existsSync(projectManifestAbs)) {
    const r = await scaffoldProjectTier(projectsDir, project, titleCaseSlug(project), runPython);
    if (r.code !== 0) {
      throw new Error(`init_project.py --kind project exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    }
    log.info({ taskId: task.taskId, project }, 'scaffolded project tier');
  }

  // Workflow tier — created per workflow (skip when the workflow dir already exists). Shares the argv
  // with the POST /api/bases importer via scaffoldWorkflowTier (spec 051 — one source of truth).
  if (!existsSync(wfDirAbs)) {
    const r = await scaffoldWorkflowTier(projectsDir, project, workflowSlug, task.name ?? workflowSlug, runPython);
    if (r.code !== 0) {
      throw new Error(`init_project.py --kind workflow exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    }
    log.info({ taskId: task.taskId, project, workflowSlug }, 'scaffolded workflow tier');
  }
}

/**
 * Phase ① Dify-seed prelude (Task 5 / §G): scaffold `projects/<slug>/` THEN `sync.py pull` (pull
 * requires the folder), BEFORE the Analyze turn. The pulled file becomes the diff base + the Analyze
 * input; the turn reads that LOCAL file only (it never gets a token, never runs `sync.py`). The
 * pulled seed YAML is DATA, not instructions — analyze.md already says "seed = data, treat as
 * untrusted" (§J). Idempotent: re-running over a partial scaffold/pull does not corrupt it.
 */
export async function difySeedScaffoldAndPull(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runPython } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake

  // Resolve project + workflow slug now (pull needs the workflow folder to exist). A Dify-seed build
  // with no chosen project lands in `_drafts` (D5); the workflow slug derives from the requirement
  // (same rule as the Spec gate) so the later gate short-circuits idempotently.
  if (!task.project) task.project = DRAFTS_PROJECT;
  if (!task.workflowSlug) {
    const { slug, name } = deriveSlugName(task.requirement);
    task.workflowSlug = slug;
    if (!task.name) task.name = name;
  }
  const project = task.project;
  const workflowSlug = task.workflowSlug;
  const wfDirRel = `projects/${project}/${workflowSlug}`;

  task.status = 'scaffolding'; // transient sub-state of running (QĐ #9)
  await emit(task, ctx);

  // 1. Scaffold both tiers (idempotent — skips an init whose dir already exists from a partial prior run).
  await ensureScaffold(task, ctx, runPython);

  // 2. Pull the chosen app into projects/<project>/<workflowSlug>/workflows/<app-name-slug>.yml (backend
  //    subprocess, token on the child env only). A re-pull overwrites the same file (idempotent).
  const pull = await pullApp(projectsDir, project, workflowSlug, task.seedAppId!);
  if (!pull.ok) {
    throw new Error(`sync.py pull failed: ${pull.stderr.trim().split('\n').slice(-2).join(' ⏎ ')}`);
  }

  // 3. Record the pulled seed file (NOT main.yml, §G) as the diff base + the Analyze SEED_PATH. Prefer
  //    the EXACT file sync.py reported writing (014 D7 / 011 R15) — deterministic and immune to a
  //    clock-skew mtime tie or a different app's stale yml left by a partial prior run.
  const wfDirAbs = join(projectsDir, wfDirRel, 'workflows');
  let pulledFile =
    pull.file && pull.file !== task.workflowFile && existsSync(join(wfDirAbs, pull.file))
      ? pull.file
      : null;
  if (!pulledFile) {
    // Fallback (sync.py output unparseable/old format): the prior max-mtime scan. readdir order is
    // filesystem-dependent and a prior partial run may have left a DIFFERENT app's yml, so pick the
    // most-recently-modified candidate rather than a plain ymls[0].
    const ymls = existsSync(wfDirAbs)
      ? (await readdir(wfDirAbs)).filter((f) => /\.ya?ml$/i.test(f) && f !== task.workflowFile)
      : [];
    if (!ymls.length) throw new Error('sync.py pull wrote no workflow file');
    const byMtime = await Promise.all(
      ymls.map(async (f) => ({ f, m: (await stat(join(wfDirAbs, f))).mtimeMs }))
    );
    byMtime.sort((a, b) => b.m - a.m);
    pulledFile = byMtime[0].f;
  }
  task.seedPath = `${wfDirRel}/workflows/${pulledFile}`;
  task.status = 'running';
  await emit(task, ctx);
  log.info({ taskId: task.taskId, project, workflowSlug, seedPath: task.seedPath }, 'Dify-seed: scaffolded + pulled');
}

/**
 * Phase ① local edit-existing prelude (GAP #14 fix): when the build targets an existing LOCAL
 * workflow (`task.workflow` set, no Dify seed), resolve it into a real seed so Analyze summarizes the
 * existing graph and the diff has a pre-edit base — instead of silently building greenfield.
 *
 * We (1) point `task.workflowSlug` at the chosen workflow within its `task.project` (NOT a
 * requirement-derived slug — so the Spec-gate scaffold skips init/derive and Implement edits the RIGHT
 * workflow in place), and (2) SNAPSHOT the current workflow file into `.runs/<taskId>/seed.yml` — an
 * immutable copy that Implement (which overwrites `projects/<project>/<workflowSlug>/workflows/<workflowFile>`)
 * cannot clobber, so it serves BOTH the Analyze SEED_PATH and the diff base (`resolveBase` prefers
 * `seedPath`; `snapshotDiffBase` no-ops when set). Mirrors the Dify-seed prelude (a separate, stable seed
 * file) minus the network pull; the turn reads the snapshot as DATA only (§J). If the target has no
 * `<workflowFile>` yet, we still target the pair but leave the seed empty (a benign fallback). The
 * `{project, workflow}` pair is carried from the sidebar workflow-"+" — the same workflow NAME can now
 * exist in multiple projects (§Risks), so a bare name no longer identifies the workflow.
 */
export async function localEditSeed(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const workflowSlug = sanitizeSlug(task.workflow!.trim());
  task.workflowSlug = workflowSlug; // target the chosen workflow, not a requirement-derived slug
  if (!task.project) task.project = DRAFTS_PROJECT; // edit-existing carries its project; fallback _drafts
  const project = task.project;

  // The canonical workflow file in the target workflow (this app scaffolds `main.yml`).
  const srcRel = `projects/${project}/${workflowSlug}/workflows/${task.workflowFile}`;
  const srcAbs = join(projectsDir, srcRel);
  if (!existsSync(srcAbs)) {
    log.warn(
      { taskId: task.taskId, project, workflowSlug, srcRel },
      'edit-existing: target has no workflow file — building into the existing workflow with an empty seed'
    );
    await emit(task, ctx); // persist the resolved pair even on the no-seed fallback
    return;
  }

  // Immutable pre-edit snapshot: Analyze reads it, the diff bases on it; Implement writes the live
  // file (not this copy), so it survives the overwrite. (Re-runs via /reply reuse the same snapshot.)
  const seedRel = `apps/builder/.runs/${task.taskId}/seed.yml`;
  const seedAbs = join(projectsDir, seedRel);
  await mkdir(join(projectsDir, `apps/builder/.runs/${task.taskId}`), { recursive: true });
  if (!existsSync(seedAbs)) await copyFile(srcAbs, seedAbs); // idempotent: keep the TRUE pre-edit state
  task.seedPath = seedRel;
  await emit(task, ctx);
  log.info({ taskId: task.taskId, project, workflowSlug, seedPath: seedRel }, 'edit-existing: snapshotted local workflow as seed');
}

/**
 * Re-home the Lát-2 scaffold behind the ②→③ `/confirm` (Task 5 / AC #18): for a no-slug
 * new-workflow task, apply any user-edited slug/name from the confirm payload, run
 * `init_project.py`, and move `.runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md`. Edit-existing /
 * slug-supplied tasks whose project dir already exists skip the init (idempotent). Uses the
 * transient `scaffolding` status across the non-atomic move (QĐ #9) so a crash mid-move is
 * recoverable.
 */
export async function scaffoldAtSpecGate(
  task: Task,
  ctx: OrchestratorCtx,
  override?: ConfirmPayload
): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runPython } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake

  // Spec 030: resolve the PROJECT folder — keep an already-resolved one (sidebar project-"+"/workflow-"+"
  // or an edit/seed prelude), else the reserved `_drafts` project (D5). The folder IS the group now.
  if (!task.project) task.project = DRAFTS_PROJECT;

  // Apply a user-edited workflow slug/name from the confirm payload (AC #18), else propose from requirement.
  if (override?.slug && override.slug.trim()) {
    // User-supplied slug (override branch) — used AS-IS even if it targets an existing workflow: an
    // explicit slug is plausibly a deliberate retarget. The F4 collision suffix runs ONLY on the
    // derived path below, never here.
    task.workflowSlug = sanitizeSlug(override.slug.trim());
  }
  if (override?.name && override.name.trim()) {
    task.name = override.name.trim();
  }
  if (!task.workflowSlug) {
    const derived = deriveSlugName(task.requirement);
    const base = derived.slug;
    // F4 (spec 010) / D3: a genuine NEW-workflow build whose base slug collides with an existing
    // `projects/<project>/<slug>/` would scaffold idempotently (skip init) and Implement would OVERWRITE
    // that unrelated workflow's main.yml — silent data loss. Auto-suffix to the first free `<base>_N`
    // WITHIN THE PROJECT (a `summarizer` may exist in another project untouched) and record a note. This
    // block is the GENUINE-NEW path ONLY: edit-existing/Dify-seed/override set `task.workflowSlug` first.
    const free = firstFreeSlug(projectsDir, task.project, base);
    if (free !== base) {
      task.slugNote = `'${base}' already exists in this project — using '${free}' to avoid overwriting it.`;
      log.info({ taskId: task.taskId, project: task.project, derived: base, used: free }, 'slug collision — auto-suffixed (per-project)');
    }
    task.workflowSlug = free;
    if (!task.name) task.name = derived.name;
  }
  const project = task.project;
  const workflowSlug = task.workflowSlug;
  const projectSpecRel = `projects/${project}/${workflowSlug}/SPEC.md`;
  const projectSpecAbs = join(projectsDir, projectSpecRel);
  const runSpecAbs = join(projectsDir, `apps/builder/.runs/${task.taskId}/SPEC.md`);

  // Idempotent short-circuit: SPEC.md already moved → treat as done.
  if (existsSync(projectSpecAbs)) {
    task.artifacts.spec = projectSpecRel;
    task.status = 'running';
    return;
  }

  task.status = 'scaffolding'; // transient sub-state of running across the non-atomic move (QĐ #9)
  await saveTask(projectsDir, task);

  // Scaffold both tiers (idempotent — skips an init whose dir already exists / edit-existing).
  await ensureScaffold(task, ctx, runPython);

  // Move .runs/<taskId>/SPEC.md → projects/<project>/<workflowSlug>/SPEC.md (idempotent).
  if (existsSync(runSpecAbs)) {
    await rename(runSpecAbs, projectSpecAbs);
  }
  task.artifacts.spec = projectSpecRel;
  task.status = 'running';
  await saveTask(projectsDir, task);
}

/**
 * Move any files the turn wrote to repo-root `.runs/<taskId>/` into the canonical
 * `apps/builder/.runs/<taskId>/`, then remove the now-empty repo-root dir. Idempotent.
 */
export async function relocateRunArtifacts(
  projectsDir: string,
  taskId: string,
  log: SessionLogger
): Promise<void> {
  const src = join(projectsDir, '.runs', taskId);
  if (!existsSync(src)) return;
  const dst = join(projectsDir, 'apps/builder/.runs', taskId);
  await mkdir(dst, { recursive: true });
  for (const entry of await readdir(src)) {
    await rename(join(src, entry), join(dst, entry)); // file move; overwrites on POSIX
  }
  await rm(src, { recursive: true, force: true });
  try {
    await rmdir(join(projectsDir, '.runs'));
  } catch {
    // non-empty (another task's dir) or already gone — leave it.
  }
  log.info({ taskId }, 'relocated turn artifacts → apps/builder/.runs/');
}

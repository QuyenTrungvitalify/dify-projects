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
import { deriveSlugName, firstFreeSlug } from './slug.js';
import { sanitizeSlug, saveTask, type Task } from '../state/task.js';

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

  // Resolve the slug now (pull needs projects/<slug>/ to exist). User-supplied wins; else derive
  // from the requirement (same rule as the Spec gate) so the later gate short-circuits idempotently.
  if (!task.slug) {
    const { slug, name } = deriveSlugName(task.requirement);
    task.slug = task.project = slug;
    if (!task.name) task.name = name;
  }
  const slug = task.slug;
  const projectDirAbs = join(projectsDir, 'projects', slug);

  task.status = 'scaffolding'; // transient sub-state of running (QĐ #9)
  await emit(task, ctx);

  // 1. Scaffold (idempotent — skip init if the dir already exists from a partial prior run).
  if (!existsSync(projectDirAbs)) {
    const r = await runPython(projectsDir, [
      'tools/dify_base/init_project.py', '--non-interactive',
      '--name', task.name ?? slug, '--slug', slug,
      '--app-type', 'workflow', '--primary-lang', 'en',
    ]);
    if (r.code !== 0) {
      throw new Error(`init_project.py exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    }
  }

  // 2. Pull the chosen app into projects/<slug>/workflows/<app-name-slug>.yml (backend subprocess,
  //    token on the child env only). A re-pull overwrites the same file (idempotent).
  const pull = await pullApp(projectsDir, slug, task.seedAppId!);
  if (!pull.ok) {
    throw new Error(`sync.py pull failed: ${pull.stderr.trim().split('\n').slice(-2).join(' ⏎ ')}`);
  }

  // 3. Record the pulled seed file (NOT main.yml, §G) as the diff base + the Analyze SEED_PATH. Prefer
  //    the EXACT file sync.py reported writing (014 D7 / 011 R15) — deterministic and immune to a
  //    clock-skew mtime tie or a different app's stale yml left by a partial prior run.
  const wfDirAbs = join(projectDirAbs, 'workflows');
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
  task.seedPath = `projects/${slug}/workflows/${pulledFile}`;
  task.status = 'running';
  await emit(task, ctx);
  log.info({ taskId: task.taskId, slug, seedPath: task.seedPath }, 'Dify-seed: scaffolded + pulled');
}

/**
 * Phase ① local edit-existing prelude (GAP #14 fix): when the build targets an existing LOCAL
 * workflow (`task.workflow` set, no Dify seed), resolve it into a real seed so Analyze summarizes the
 * existing graph and the diff has a pre-edit base — instead of silently building greenfield.
 *
 * We (1) point `task.slug` at the chosen workflow (NOT a requirement-derived slug — so the Spec-gate
 * scaffold skips init/derive and Implement edits the RIGHT project in place), and (2) SNAPSHOT the
 * current workflow file into `.runs/<taskId>/seed.yml` — an immutable copy that Implement (which
 * overwrites `projects/<slug>/workflows/<workflowFile>`) cannot clobber, so it serves BOTH the Analyze
 * SEED_PATH and the diff base (`resolveBase` prefers `seedPath`; `snapshotDiffBase` no-ops when set).
 * Mirrors the Dify-seed prelude (a separate, stable seed file) minus the network pull; the turn reads
 * the snapshot as DATA only (§J). If the target has no `<workflowFile>` yet, we still target the slug
 * but leave the seed empty (from-scratch-into-the-existing-project) — a benign fallback.
 */
export async function localEditSeed(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const slug = sanitizeSlug(task.workflow!.trim());
  task.slug = task.project = slug; // target the chosen workflow, not a requirement-derived slug

  // The canonical workflow file in the target project (this app scaffolds `main.yml`).
  const srcRel = `projects/${slug}/workflows/${task.workflowFile}`;
  const srcAbs = join(projectsDir, srcRel);
  if (!existsSync(srcAbs)) {
    log.warn(
      { taskId: task.taskId, slug, srcRel },
      'edit-existing: target has no workflow file — building into the existing project with an empty seed'
    );
    await emit(task, ctx); // persist the resolved slug even on the no-seed fallback
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
  log.info({ taskId: task.taskId, slug, seedPath: seedRel }, 'edit-existing: snapshotted local workflow as seed');
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

  // Apply a user-edited slug/name from the confirm payload (AC #18), else propose from the requirement.
  if (override?.slug && override.slug.trim()) {
    // User-supplied slug (override branch) — used AS-IS even if it targets an existing project: an
    // explicit slug is plausibly a deliberate retarget. The F4 collision suffix runs ONLY on the
    // derived path below, never here.
    task.slug = task.project = sanitizeSlug(override.slug.trim());
  }
  if (override?.name && override.name.trim()) {
    task.name = override.name.trim();
  }
  if (!task.slug) {
    const { slug, name } = deriveSlugName(task.requirement);
    if (!task.name) task.name = name;
    // F4 (spec 010): a genuine NEW-workflow build whose DERIVED slug collides with an existing
    // `projects/<slug>/` would scaffold idempotently (skip init) and Implement would OVERWRITE that
    // unrelated project's main.yml — silent data loss. Auto-suffix to the first free `<slug>_N` and
    // record a note (surfaced on the next gate + in the report). This block is the GENUINE-NEW path
    // ONLY: edit-existing (local) resolves its slug in `localEditSeed`, Dify-seed in
    // `difySeedScaffoldAndPull`, and the explicit-override branch above — each sets `task.slug` before
    // here. So reaching `!task.slug` means a fresh new workflow ⇒ always take first-free (which also
    // forecloses the GAP #14 data-loss tail: no edit-existing build can bypass the collision suffix).
    const free = firstFreeSlug(projectsDir, slug);
    if (free !== slug) {
      task.slugNote = `'${slug}' already exists — using '${free}' to avoid overwriting it.`;
      log.info({ taskId: task.taskId, derived: slug, used: free }, 'slug collision — auto-suffixed');
    }
    task.slug = task.project = free;
  }
  const slug = task.slug;
  const projectSpecRel = `projects/${slug}/SPEC.md`;
  const projectSpecAbs = join(projectsDir, projectSpecRel);
  const projectDirAbs = join(projectsDir, 'projects', slug);
  const runSpecAbs = join(projectsDir, `apps/builder/.runs/${task.taskId}/SPEC.md`);

  // Idempotent short-circuit: SPEC.md already moved → treat as done.
  if (existsSync(projectSpecAbs)) {
    task.artifacts.spec = projectSpecRel;
    task.status = 'running';
    return;
  }

  task.status = 'scaffolding'; // transient sub-state of running across the non-atomic move (QĐ #9)
  await saveTask(projectsDir, task);

  // Scaffold (skip init if the project dir already exists from a partial prior run / edit-existing).
  if (!existsSync(projectDirAbs)) {
    const r = await runPython(projectsDir, [
      'tools/dify_base/init_project.py',
      '--non-interactive',
      '--name',
      task.name ?? slug,
      '--slug',
      slug, // MUST equal the active task slug (arg-validation, §J). No --group (the tool has none).
      '--app-type',
      'workflow',
      '--primary-lang',
      'en',
    ]);
    if (r.code !== 0) {
      throw new Error(`init_project.py exit ${r.code}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    }
    log.info({ taskId: task.taskId, slug }, 'scaffolded project');
  }

  // Move .runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md (idempotent).
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

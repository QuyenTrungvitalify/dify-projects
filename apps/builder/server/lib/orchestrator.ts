/**
 * orchestrator.ts — the GATED phase state machine for spec 009 Lát 3 (the crux).
 *
 * Lát 2 was one auto-advancing loop. Lát 3 splits it into entry points each driven by a SEPARATE
 * HTTP request, so the build pauses at `awaiting_confirm` between phases and only the next request
 * issues the next turn (the gate is enforced by *who issues the turn*, not a soft "stop", §D):
 *
 *   - startTask     — POST /api/tasks   → runPhase(①) → gate → maybeAutoAdvance
 *   - confirmAdvance — POST /confirm     → run the NEXT phase as a fresh turn (no cross-phase resume)
 *   - replyWithin   — POST /reply        → re-run the CURRENT phase via --resume, re-gate, no advance
 *
 * ①②③ are fresh `claude` turns (model C, via ClaudeSession); ④ is backend (report.ts, no turn).
 * Verify is NEVER `is_error` alone (spike E5): ③ runs the full Lát-1 post-turn check, ①/② check
 * artifact-exists/non-empty + confinement-with-revert. The scaffold (`init_project.py` + SPEC.md
 * move) is re-homed from Lát 2's raw advance to the ②→③ `/confirm` (AC #18).
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeSession, type SessionLogger } from './claude-session.js';
import { confinementCheck, gitDirtyPaths, postTurnCheck as realPostTurnCheck } from './post-turn.js';
import { runPython as realRunPython } from './shell.js';
import { runTurn as realRunTurn, type TurnResult } from './turn-runner.js';
import { PHASES, renderPrompt, type PhaseDef } from './phases.js';
import { attachmentBlock } from './attachments.js';
import { snapshotDiffBase, writeDiffArtifact } from './diff.js';
import { appUrlFrom, difyCreds, pullApp, pushApp, reconcileAppIdByName } from './dify-io.js';
import { clearPushIntent, readPushIntent, writePushIntent } from './recovery.js';
import { runReport as realRunReport } from './report.js';
import { lintClean } from './linters.js';
import { computeGate, type GateOutcome } from './gate.js';
import { clearSession, isCancelled, setSession, turnHolderId } from './lock.js';
import { applyAnalysisToTask } from './analysis.js';
import { sanitizeSlug, saveTask, type Task } from '../state/task.js';

/**
 * Injectable subprocess seams (spec 013 D2, fixes C2). The orchestrator's verdict/advance code hard-
 * imports the runners that spawn a `claude` turn / a python subprocess / the report — so the riskiest
 * behaviors (AC #15 auto hands-free, AC #25 auto hard-stop / never-auto-import-lint≠0, AC #23
 * confinement revert) could only be exercised with a REAL claude turn + git tree. These optional seams
 * default to the real impls; production is untouched (absent ⇒ identical behavior) and only tests
 * inject fakes. `postTurnCheck` is included (beyond the spec's runTurn/runReport/runPython) because the
 * ③ Implement verdict flows through it — without it the advance ladder can't be driven without a real
 * `.venv` (013 Q3 seam scope).
 */
export interface OrchestratorRunners {
  runTurn: typeof realRunTurn;
  runPython: typeof realRunPython;
  runReport: typeof realRunReport;
  postTurnCheck: typeof realPostTurnCheck;
}

export interface OrchestratorCtx {
  projectsDir: string;
  /** ABSOLUTE path to apps/builder/headless-settings.json. */
  settingsPath: string;
  log: SessionLogger;
  /**
   * Lát 4 SSE relay (optional — curl/dev runs pass nothing). Called at every phase/status/gate
   * transition with the full task (`task:update`) and with each streamed assistant fragment
   * (`phase:output`). Pure side-channel: it never alters the state machine (the orchestrator runs
   * identically with or without it).
   */
  broadcast?: (taskId: string, event: string, data: unknown) => void;
  /** 013 D2: tests inject subprocess fakes here; absent ⇒ the real impls (no behavior change). */
  runners?: Partial<OrchestratorRunners>;
}

/** Resolve the runner seams once: each falls back to its real impl when not injected. */
function resolveRunners(ctx: OrchestratorCtx): OrchestratorRunners {
  const r = ctx.runners ?? {};
  return {
    runTurn: r.runTurn ?? realRunTurn,
    runPython: r.runPython ?? realRunPython,
    runReport: r.runReport ?? realRunReport,
    postTurnCheck: r.postTurnCheck ?? realPostTurnCheck,
  };
}

/**
 * Persist + relay the task state to the SSE clients (Lát 4). One call replaces a bare saveTask at
 * every UI-visible transition so the browser mirror stays in lock-step with task.json.
 */
async function emit(task: Task, ctx: OrchestratorCtx): Promise<void> {
  // Bump the monotonic snapshot revision FIRST so the persisted file AND the broadcast carry the same
  // new `rev` (spec 014 D5 / 011 R8): the web store uses it to drop a late GET that would otherwise
  // clobber a newer live update. Every UI-visible transition flows through `emit`, so `rev` increases
  // exactly once per transition; direct `saveTask` calls (session-id persistence) never broadcast, so
  // they deliberately do not bump it.
  task.rev = (task.rev ?? 0) + 1;
  await saveTask(ctx.projectsDir, task);
  ctx.broadcast?.(task.taskId, 'task:update', task);
}

/** A user-edited slug/name carried on the ②→③ `/confirm` (AC #18). */
export interface ConfirmPayload {
  slug?: string;
  name?: string;
}

/** Per-turn wall-clock budget (spec §I default 10 min; per-phase config is a later refinement). */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

interface PhaseVerify {
  outcome: GateOutcome;
  reasons: string[];
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ───────────────────────────── entry points (one per HTTP request) ─────────────────────────────

/** POST /api/tasks core: run Phase ① then gate; `maybeAutoAdvance` honors Confirm-mode from there.
 *  A Dify-seed build first scaffolds + pulls the chosen app (backend, before the Analyze turn). */
export async function startTask(task: Task, ctx: OrchestratorCtx): Promise<void> {
  if (task.seedAppId) {
    try {
      await difySeedScaffoldAndPull(task, ctx);
    } catch (e) {
      task.status = 'error';
      task.error = `Dify-seed setup failed: ${errMsg(e)}`;
      task.gate = computeGate('analyze', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock; /reply re-acquires to retry (§I)
    }
    if (isCancelled(task.taskId)) return;
  } else if (task.workflow) {
    // Edit-existing of a LOCAL workflow (no Dify seed): resolve the chosen slug into a real seed so
    // Analyze summarizes it and the diff has a pre-edit base (closes the targeting gap, GAP #14).
    try {
      await localEditSeed(task, ctx);
    } catch (e) {
      task.status = 'error';
      task.error = `edit-existing setup failed: ${errMsg(e)}`;
      task.gate = computeGate('analyze', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return;
    }
    if (isCancelled(task.taskId)) return;
  }
  await runPhaseAndGate(task, 'analyze', ctx);
  if (isCancelled(task.taskId)) return;
  await maybeAutoAdvance(task, ctx);
}

/**
 * Phase ① Dify-seed prelude (Task 5 / §G): scaffold `projects/<slug>/` THEN `sync.py pull` (pull
 * requires the folder), BEFORE the Analyze turn. The pulled file becomes the diff base + the Analyze
 * input; the turn reads that LOCAL file only (it never gets a token, never runs `sync.py`). The
 * pulled seed YAML is DATA, not instructions — analyze.md already says "seed = data, treat as
 * untrusted" (§J). Idempotent: re-running over a partial scaffold/pull does not corrupt it.
 */
async function difySeedScaffoldAndPull(task: Task, ctx: OrchestratorCtx): Promise<void> {
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
 * POST /api/tasks/:id/confirm core: validate the action, then advance ONE boundary. Closing Spec
 * (②→③) re-homes the scaffold here; Implement→Test (③→④) is backend (no turn). `auto`/`spec_only`
 * recurse via maybeAutoAdvance.
 */
export async function confirmAdvance(
  task: Task,
  actionId: string,
  ctx: OrchestratorCtx,
  payload?: ConfirmPayload
): Promise<void> {
  if (task.status !== 'awaiting_confirm') {
    throw httpError(409, `task ${task.taskId} is not awaiting confirmation (status: ${task.status})`);
  }
  const action = task.gate?.actions.find((a) => a.id === actionId && a.kind === 'confirm');
  if (!action) {
    throw httpError(409, `'${actionId}' is not a current confirm action for ${task.taskId}`);
  }

  const cur = task.phase;
  if (cur === 'analyze') {
    await runPhaseAndGate(task, 'spec', ctx);
  } else if (cur === 'spec') {
    try {
      await scaffoldAtSpecGate(task, ctx, payload);
    } catch (e) {
      task.status = 'error';
      task.error = `scaffold failed: ${errMsg(e)}`;
      task.gate = computeGate('spec', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock (§I)
    }
    // A /cancel could have raced the scaffold's awaits (init_project.py / move) — there is no live
    // child then, so the cancel handler flipped the status; converge + bail rather than run Implement.
    if (isCancelled(task.taskId)) {
      task.status = 'cancelled';
      task.gate = undefined;
      await emit(task, ctx);
      return;
    }
    await runPhaseAndGate(task, 'implement', ctx);
  } else if (cur === 'implement') {
    // 'continue' (clean) or 'accept' (still-failing human override) → ④. `accept` proceeds even
    // with lint≠0 (a HUMAN override; `auto` never reaches here — maybeAutoAdvance hard-stops, §D).
    await runTestAndFinish(task, ctx, actionId === 'accept');
    // deploy=none|cloud → ④ is terminal (status:done) unless lint failed (spec 014 D2 → a ④ accept
    // gate). selfhost-clean → runTestAndFinish parks at the Import gate. Either parked gate is a
    // `flag` that maybeAutoAdvance HARD-STOPS on (D1 deploy / D2 still-failing), so `auto`/`spec_only`
    // wait for the explicit human button rather than auto-confirming (AC #16/#25 reworded).
  } else if (cur === 'test') {
    // ④ gates: 'import' → backend push + finish; 'skip_import' → done w/o push; 'accept' → the D2
    // still-failing override (finish `done`, tagged accepted_lint_failure). 'discard' is /cancel.
    if (actionId === 'import') {
      await runImportAndFinish(task, ctx);
    } else if (actionId === 'accept') {
      await runTestAndFinish(task, ctx, /*acceptedLintFailure*/ true);
    } else {
      await finishWithoutImport(task, ctx);
    }
    return; // ④ is terminal
  } else {
    return; // defensively no-op
  }

  if (isCancelled(task.taskId)) return;
  await maybeAutoAdvance(task, ctx);
}

/**
 * POST /api/tasks/:id/reply core: re-run the CURRENT phase WITHIN the phase via
 * `--resume <sessionIds[phase]>` (Spike E5), re-verify, re-gate WITHOUT advancing. Also the Retry
 * path out of `error` (§I). A /reply never auto-advances — it is a human revise, so it always
 * pauses for the next decision (even in `auto`).
 */
export async function replyWithin(task: Task, text: string, ctx: OrchestratorCtx): Promise<void> {
  if (task.phase === 'test') {
    // ④ is backend (no turn/session) — a reply at the terminal phase just re-runs the report.
    await runTestAndFinish(task, ctx, false);
    return;
  }
  const resumeId = task.sessionIds[task.phase as 'analyze' | 'spec' | 'implement'];
  await runPhaseAndGate(task, task.phase, ctx, { resumeId, replyText: text });
}

// ───────────────────────────── internal steps ─────────────────────────────

async function runPhaseAndGate(
  task: Task,
  phaseId: 'analyze' | 'spec' | 'implement',
  ctx: OrchestratorCtx,
  opts?: { resumeId?: string; replyText?: string }
): Promise<void> {
  const verify = await runPhase(task, phaseId, ctx, opts);
  if (isCancelled(task.taskId)) return;
  await gateAfterPhase(task, verify, ctx);
}

/**
 * gateAfterPhase — set the gate + status from the verify outcome and STOP (do not issue the next
 * turn). Both outcomes END this turn's write-unit: `error` parks at `status:error` (a /reply retry
 * re-acquires the turn lock); success / still_failing park at `awaiting_confirm`. The turn lock is
 * freed by the dispatch `finally` when this work settles — a gate holds NO lock (turn-level, §I). The
 * caller decides whether to maybeAutoAdvance.
 */
async function gateAfterPhase(task: Task, verify: PhaseVerify, ctx: OrchestratorCtx): Promise<void> {
  task.gate = computeGate(task.phase, { outcome: verify.outcome }, task.deploy);
  if (verify.outcome === 'error') {
    task.status = 'error';
    task.error = verify.reasons.filter(Boolean).join(' | ') || 'phase failed';
    await emit(task, ctx);
    return;
  }
  task.status = 'awaiting_confirm'; // success or still_failing → park (the turn lock frees on settle)
  task.error = undefined;
  await emit(task, ctx);
}

/** Decide per Confirm-mode whether THIS boundary auto-advances, then issue the primary confirm. */
async function maybeAutoAdvance(task: Task, ctx: OrchestratorCtx): Promise<void> {
  if (isCancelled(task.taskId)) return; // a /cancel mutates a separate object — re-check the live flag
  if (task.status !== 'awaiting_confirm') return; // error / done / cancelled never auto-advance
  if (task.gate?.flag === 'still_failing') return; // `auto` HARD-STOPS at still-failing (§D / AC #25)
  if (task.gate?.flag === 'awaiting_import') return; // deploy is ALWAYS an explicit human decision (spec 014 D1)
  if (!boundaryAutoAdvances(task.confirmMode, task.phase)) return;
  const primary = task.gate?.actions.find((a) => a.kind === 'confirm');
  if (!primary) return; // terminal (④) — nothing to advance
  await confirmAdvance(task, primary.id, ctx);
}

/** auto → always; spec_only → pause only after Spec (② pauses, ①/③ auto); else (each_step OR any
 *  corrupt/unrecognized persisted value) → never auto. Fail-SAFE toward pausing, never toward an
 *  autonomous `auto` run (a stale `confirmMode:null` in a reconciled task.json must not silently run). */
export function boundaryAutoAdvances(mode: Task['confirmMode'], phase: Task['phase']): boolean {
  if (mode === 'auto') return true;
  if (mode === 'spec_only') return phase !== 'spec';
  return false; // each_step (and any unknown/corrupt value)
}

/**
 * runPhase — spawn exactly ONE fresh `claude` turn for `phaseId` (model C; `/reply` adds --resume),
 * persist its session id per-phase, then post-turn verify → PhaseVerify. For ③ the verify resolves
 * the clean / still-failing / hard-error variant from the structured post-turn detail; the backend
 * NEVER re-spawns the turn (the cap-5 validate→fix loop runs INSIDE the agent's single turn,
 * implement.md — re-spawning would double-apply edits and break §I idempotency).
 */
async function runPhase(
  task: Task,
  phaseId: 'analyze' | 'spec' | 'implement',
  ctx: OrchestratorCtx,
  opts?: { resumeId?: string; replyText?: string }
): Promise<PhaseVerify> {
  const { projectsDir, settingsPath, log } = ctx;
  const { runTurn } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  const phase = PHASES.find((p) => p.id === phaseId) as PhaseDef;
  const sessKey = phaseId;

  task.phase = phaseId;
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const body = await readFile(join(projectsDir, phase.promptFile!), 'utf8');
  const renderedFresh = renderPrompt(body, phase.injectVars(task));
  // Spec 012: the trailing `添付画像:` path block (empty string when no images). Appended ONCE to
  // whichever prompt string is finally sent — this is the single seam BOTH the fresh render and the
  // /reply resume prompt pass through (the resume prompt skips phases.ts injectVars entirely), so it is
  // the only place that covers create→Analyze AND a reply at any phase (AC2/AC3). Every phase benefits,
  // including a fresh Implement turn (which has no {{REQUIREMENT}} token to inject into).
  const block = attachmentBlock(task.attachments);
  // A /reply with a live session sends ONLY the change request (the resumed session has context); a
  // fresh fallback sends the rendered body + the request appended (seeded with the artifact PATH).
  const freshPrompt =
    (opts?.replyText
      ? `${renderedFresh}\n\n## Change request (revise the existing artifact; do not restart from scratch)\n${opts.replyText}`
      : renderedFresh) + block;
  const resumePrompt = opts?.replyText ? `${opts.replyText}${block}` : freshPrompt;

  // Snapshot the pre-edit workflow BEFORE Implement overwrites it, so an edit-existing diff has a
  // real base (idempotent: no-op on a no-seed new build, a Dify-seed, or a /reply re-run, Task 4).
  if (phaseId === 'implement') await snapshotDiffBase(projectsDir, task);

  // Confinement baseline for THIS turn (captured just before spawn — after any scaffold).
  const baseline = await gitDirtyPaths(projectsDir);

  const spawnOnce = async (resumeSessionId: string | undefined, prompt: string): Promise<TurnResult> => {
    const session = new ClaudeSession(`${task.taskId}:${phaseId}${resumeSessionId ? ':resume' : ''}`, {
      taskId: task.taskId,
      workingDir: projectsDir,
      settingsPath,
      log,
      resumeSessionId,
    });
    setSession(task.taskId, session); // hand the child to /cancel
    const turn = await runTurn(
      session,
      prompt,
      (sid) => {
        // Persist session_id the MOMENT init yields it (a /reply, a separate request, reads it back).
        task.sessionIds[sessKey] = sid;
        void saveTask(projectsDir, task);
      },
      {
        timeoutMs: TURN_TIMEOUT_MS,
        // Relay each assistant fragment to the SSE clients live (Lát 4) — high-volume, not buffered.
        onText: (text) => ctx.broadcast?.(task.taskId, 'phase:output', { phase: phaseId, text }),
      }
    );
    clearSession(task.taskId);
    // Don't write a `running`-bearing task AFTER a /cancel flipped it (would clobber `cancelled`).
    if (turn.sessionId && !isCancelled(task.taskId)) {
      task.sessionIds[sessKey] = turn.sessionId;
      await saveTask(projectsDir, task);
    }
    return turn;
  };

  // NEVER spawn a turn for a build that no longer owns the TURN lock. The primary guard is the live
  // `isCancelled` flag: a /cancel during the awaits above (emit/readFile/gitDirtyPaths) force-kills any
  // child + marks cancelled on a SEPARATELY-loaded object, and the auto-advance path gates only on the
  // stale in-memory status. `turnHolderId() !== task.taskId` is a defensive backstop (the turn lock is
  // held for THIS build across its whole dispatched work, so it should always match) — if it somehow
  // doesn't, the spawn's setSession() would no-op → an untracked, unkillable turn. Bail in either case.
  if (isCancelled(task.taskId) || turnHolderId() !== task.taskId) {
    task.status = 'cancelled';
    task.gate = undefined;
    await saveTask(projectsDir, task);
    return { outcome: 'error', reasons: ['cancelled before spawn'] };
  }

  log.info({ taskId: task.taskId, phase: phaseId, resume: !!opts?.resumeId }, 'spawning turn');
  let turn = await spawnOnce(opts?.resumeId, opts?.resumeId ? resumePrompt : freshPrompt);

  // Resume-failure fallback (spec §A persistence caveat / Q3): a bad/expired session id makes the
  // child exit before any result event — re-run as a FRESH turn seeded with the artifact PATH.
  // A wall-clock TIMEOUT (or a spawn failure) sets turn.note — that is NOT a resume failure, and
  // re-running would silently spend a SECOND full TURN_TIMEOUT_MS. Exclude it so a /reply timeout
  // parks at error like a fresh-turn timeout instead of doubling the budget (spec 014 D4 / C4).
  if (opts?.resumeId && turn.isError && !turn.result && !turn.note) {
    log.warn({ taskId: task.taskId, phase: phaseId }, 'resume failed → fresh turn seeded with artifact');
    turn = await spawnOnce(undefined, freshPrompt);
  }

  // A /cancel may have killed the child mid-turn. Converge the build's own state to `cancelled`
  // (idempotent with the cancel handler's write) and bail — do NOT verify/gate/advance. The lock is
  // owned/released by the cancel handler.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }

  const verify = await verifyPhase(phase, task, ctx, baseline, turn.note);
  // verifyPhase awaits python/git subprocesses — a /cancel can land in that window. Re-check (mirrors
  // the guard at the spawn boundary above) so the success save below can't clobber `cancelled`→`running`.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }
  if (verify.outcome !== 'error') {
    task.artifacts[sessKey] = phase.artifactRel(task);
    // Implement produced a (parseable) main.yml → compute + persist the {path,diff} payload now so
    // GET /api/tasks renders the split diff (base per kind: seed / pre-edit snapshot / empty, Task 4).
    if (phaseId === 'implement') {
      try {
        task.artifacts.diff = await writeDiffArtifact(projectsDir, task);
      } catch (e) {
        log.warn({ taskId: task.taskId, err: errMsg(e) }, 'diff producer failed (non-fatal)');
      }
    }
    await saveTask(projectsDir, task);
  }
  return verify;
}

/** Post-turn verify → outcome. ③ resolves clean/still-failing/hard-error from the post-turn detail. */
async function verifyPhase(
  phase: PhaseDef,
  task: Task,
  ctx: OrchestratorCtx,
  baseline: Set<string>,
  turnNote: string | undefined
): Promise<PhaseVerify> {
  const { projectsDir, log } = ctx;
  const { postTurnCheck } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake

  // The skill bodies write task artifacts to the shorthand `.runs/<taskId>/` (cwd = repo root).
  // Relocate them into the canonical `apps/builder/.runs/<taskId>/` (spec §A :517) BEFORE verifying.
  await relocateRunArtifacts(projectsDir, task.taskId, log);

  if (phase.id === 'implement') {
    const check = await postTurnCheck({
      projectsDir,
      slug: task.slug!,
      workflowFile: task.workflowFile,
      taskId: task.taskId,
      baseline,
      log,
    });
    const d = check.detail;
    const reasons = [...check.reasons];
    if (turnNote) reasons.unshift(turnNote);

    // HARD error (→ status:error, Retry): a crash/timeout, no artifact, unparseable YAML
    // (truncation), or a confinement breach (security — always reverted + error, AC #23). These are
    // NOT the still-failing gate (which assumes a present, parseable, in-confinement partial file).
    const hardError = !!turnNote || !d.artifactOk || !d.yamlOk || d.confinementBreaches.length > 0;
    if (hardError) return { outcome: 'error', reasons };

    // The Implement success gate consumes the SHARED lintClean (013 D1) — the identical clean-test the
    // ④ report's Import precondition uses, so the ③ gate and the ④ report can never disagree.
    if (lintClean(d.lintCodes) && d.idsOk) return { outcome: 'success', reasons: [] };

    // Present + parseable + in-confinement, but lint≠0 or non-13-digit ids → still-failing gate
    // (cap-5 reached; the agent self-corrected as far as it could in its one turn — §D / AC #20).
    return { outcome: 'still_failing', reasons };
  }

  // ①/②: artifact exists + non-empty (+ analyze.json valid JSON) + confinement+revert.
  const reasons: string[] = [];
  if (turnNote) reasons.push(turnNote);
  const rel = phase.artifactRel(task);
  const abs = join(projectsDir, rel);
  let size = -1;
  try {
    size = (await stat(abs)).size;
  } catch {
    reasons.push(`artifact missing: ${rel}`);
  }
  if (size === 0) reasons.push(`artifact empty: ${rel}`);
  if (phase.id === 'analyze' && size > 0) {
    try {
      // O2 (spec 019): also fold the chosen pattern + needed feature-set from analyze.json onto the
      // task and compute the pattern-coverage advisory (never a hard-fail). Throws on invalid JSON →
      // the same error path as before.
      applyAnalysisToTask(task, await readFile(abs, 'utf8'), projectsDir);
    } catch (e) {
      reasons.push(`analyze.json invalid JSON: ${errMsg(e)}`);
    }
  }
  // Confinement runs unconditionally — a breach must be reverted even if the artifact failed.
  reasons.push(
    ...(await confinementCheck({ projectsDir, slug: task.slug, taskId: task.taskId, baseline, log }))
  );
  return { outcome: reasons.length ? 'error' : 'success', reasons };
}

/**
 * ④ Test&Report — BACKEND write-unit (no turn): re-run the 3 linters, write report.json. For
 * `none`/`cloud` (and a selfhost build whose lint failed via "Accept anyway"), this is terminal →
 * `done`. For a CLEAN `selfhost` build it PARKS at the Import gate (`awaiting_confirm`) so the import
 * runs only on the explicit Import button (AC #16) — never auto-imports lint≠0 (AC #25). `cloud` skips
 * the import entirely; its report carries the copyable-YAML + Studio steps (AC #9). The turn lock is
 * freed by the dispatch `finally` when this work settles (done or parked) — it is never held at a gate.
 */
async function runTestAndFinish(
  task: Task,
  ctx: OrchestratorCtx,
  acceptedLintFailure: boolean
): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const res = await runReport(projectsDir, task, log, { acceptedLintFailure });
  if (isCancelled(task.taskId)) return; // a /cancel raced the (childless) ④ step

  if (!res.ok) {
    task.status = 'error';
    task.error = res.reasons.join(' | ');
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    return; // the dispatch `finally` frees the turn lock (§I)
  }

  // selfhost + clean lint → park behind the Import button (the push is runImportAndFinish). Deploy is
  // ALWAYS a human decision: `auto`/`spec_only` PARK here too (spec 014 D1) — maybeAutoAdvance no longer
  // auto-confirms the import; the turn lock frees on settle and the build waits for Import/Skip.
  if (task.deploy === 'selfhost' && res.lintClean) {
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'awaiting_import' }, task.deploy);
    await emit(task, ctx);
    return;
  }

  // lint≠0 and NOT a human-accepted ③ override → never silently `done` (spec 014 D2 / C2). Park at a
  // still-failing ④ gate for an explicit Accept (finish, tagged) or Discard; `auto` HARD-STOPS (flag).
  if (!res.lintClean && !acceptedLintFailure) {
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'still_failing' }, task.deploy);
    await emit(task, ctx);
    return;
  }

  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy); // terminal: no actions
  await emit(task, ctx);
}

/**
 * ④-import (selfhost, Task 6) — BACKEND: push the produced workflow to Dify as a NEW app, capture the
 * `app_id`, build the clickable `app_url`, re-write report.json, then `done` (the dispatch `finally`
 * frees the turn lock on settle). Idempotency
 * (§I / AC #25): a `push_intent` marker WITHOUT a confirmed `appId` means a prior push may have
 * created the app (crash mid-push) → reconcile via `list`, NEVER re-push (a re-push would duplicate).
 */
async function runImportAndFinish(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const slug = task.slug!;
  const appName = task.name ?? slug;

  const creds = difyCreds();
  if (!creds.url || !creds.token) {
    task.status = 'error';
    task.error = 'selfhost import needs DIFY_CONSOLE_URL + DIFY_CONSOLE_TOKEN in the backend env';
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    return; // the dispatch `finally` frees the turn lock
  }

  let appId: string | null = null;
  let reconcileAmbiguous = false; // ≥2 same-named apps matched — never silently attach the wrong one (D6)
  const existing = await readPushIntent(projectsDir, task.taskId);
  if (existing) {
    // A marker ALREADY exists → a prior attempt pushed (or may have). NEVER re-push (a re-push would
    // duplicate the app, AC #25) — use the captured id, else reconcile by slugified name. This covers
    // both a crash mid-push (appId null) AND a boot-recovered marker (appId already written back).
    log.warn({ taskId: task.taskId, hadAppId: !!existing.appId }, 'push_intent exists — reconciling, NOT re-pushing');
    if (existing.appId) {
      appId = existing.appId;
    } else {
      const rec = await reconcileAppIdByName(projectsDir, existing.appName);
      appId = rec.appId;
      reconcileAmbiguous = rec.ambiguous;
    }
  } else {
    // Fresh import: write the marker BEFORE the push (the guard keys off the PRE-push marker, §I).
    await writePushIntent(projectsDir, task.taskId, { slug, file: task.workflowFile, appName, appId: null });
    const push = await pushApp(projectsDir, slug, task.workflowFile, appName);
    // --json-out is PRIMARY; on absence/crash, reconcile by slugified name (D6: exactly-one match, else
    // ambiguous — never a silent newest-pick that could attach the wrong app).
    if (push.appId) {
      appId = push.appId;
    } else {
      const rec = await reconcileAppIdByName(projectsDir, appName);
      appId = rec.appId;
      reconcileAmbiguous = rec.ambiguous;
    }
    if (!push.ok && !appId) {
      // push failed AND nothing to reconcile → error. The marker (no appId) PERSISTS so a /reply
      // re-run reconciles instead of re-pushing (never a duplicate).
      const tail = push.stderr.trim().split('\n').slice(-2).join(' ⏎ ') || 'sync.py push exited non-zero';
      task.status = 'error';
      task.error = `import failed: ${tail}`;
      task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock
    }
  }

  const appUrl = appId ? appUrlFrom(creds.url, appId) : null;
  task.appId = appId;
  task.appUrl = appUrl;
  await writePushIntent(projectsDir, task.taskId, { slug, file: task.workflowFile, appName, appId });

  // Push ALWAYS makes a NEW app → editing an existing workflow silently DUPLICATES (spec footgun).
  const duplicateWarning = task.workflow
    ? `created a NEW Dify app (a DUPLICATE): Dify import always creates a new app, so "${task.workflow}" was NOT updated in place — delete the old app or reconcile in Dify.`
    : null;
  // D6 (C6): when ≥2 same-named apps matched we attached NONE (can't tell which is this build's), so say
  // so explicitly rather than letting a generic "check Dify" imply a single new app exists.
  const importNote = appId
    ? null
    : reconcileAmbiguous
      ? `ambiguous import — multiple Dify apps are named like "${appName}"; none was attached. Verify in Dify which one is this build.`
      : 'app id not captured — push may have completed; check Dify for the new app';

  await runReport(projectsDir, task, log, { appUrl, duplicateWarning, importNote });
  if (appId) await clearPushIntent(projectsDir, task.taskId); // resolved → drop the marker

  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy);
  await emit(task, ctx);
}

/** skip_import at the selfhost Import gate → finish `done` WITHOUT pushing (built + linted locally). */
async function finishWithoutImport(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.status = 'running';
  task.gate = undefined;
  await emit(task, ctx);
  await runReport(projectsDir, task, log, {
    importNote: 'import skipped by user (built + linted locally; not pushed to Dify).',
  });
  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy);
  await emit(task, ctx);
}

/**
 * Re-home the Lát-2 scaffold behind the ②→③ `/confirm` (Task 5 / AC #18): for a no-slug
 * new-workflow task, apply any user-edited slug/name from the confirm payload, run
 * `init_project.py`, and move `.runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md`. Edit-existing /
 * slug-supplied tasks whose project dir already exists skip the init (idempotent). Uses the
 * transient `scaffolding` status across the non-atomic move (QĐ #9) so a crash mid-move is
 * recoverable.
 */
async function scaffoldAtSpecGate(
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
async function relocateRunArtifacts(
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

/** Deterministic slug/name from the requirement: lowercase, [a-z0-9_], ≤4 content words. */
export function deriveSlugName(requirement: string): { slug: string; name: string } {
  const stop = new Set([
    'a', 'an', 'the', 'that', 'this', 'takes', 'take', 'and', 'returns', 'return', 'of', 'to',
    'with', 'for', 'in', 'on', 'is', 'are', 'it', 'its',
  ]);
  const words = requirement
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const content = words.filter((w) => !stop.has(w));
  const picked = (content.length ? content : words).slice(0, 4);
  const slug = (picked.join('_') || 'workflow').slice(0, 40).replace(/_+$/, '') || 'workflow';
  const name =
    slug
      .split('_')
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ') || 'Workflow';
  return { slug, name };
}

/**
 * F4 (spec 010): the first slug in `slug, slug_2, slug_3, …` whose `projects/<slug>/` does NOT exist.
 * Returns `slug` unchanged when it is already free (today's behavior). Synchronous `existsSync` is fine
 * here — this runs once per Spec-gate confirm, single-writer under the turn lock.
 */
export function firstFreeSlug(projectsDir: string, slug: string): string {
  const exists = (s: string): boolean => existsSync(join(projectsDir, 'projects', s));
  if (!exists(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    // Reserve room for the suffix BEFORE the 40-char cap, else a near-40-char slug truncates the
    // suffix away and collapses back onto the colliding slug (never finding a free candidate).
    const cand = `${slug.slice(0, 40 - suffix.length).replace(/_+$/, '')}${suffix}`;
    if (!exists(cand)) return cand;
  }
  return `${slug.slice(0, 26)}_${Date.now()}`; // pathological fallback (≤40, never expected); non-colliding
}

/** Tag an Error with an HTTP status code the route maps to a response. */
function httpError(statusCode: number, message: string): Error {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = statusCode;
  return e;
}

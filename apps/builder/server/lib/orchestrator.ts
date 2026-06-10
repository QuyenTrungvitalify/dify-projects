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
import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeSession, type SessionLogger } from './claude-session.js';
import { confinementCheck, gitDirtyPaths, postTurnCheck } from './post-turn.js';
import { runPython } from './shell.js';
import { runTurn, type TurnResult } from './turn-runner.js';
import { PHASES, renderPrompt, type PhaseDef } from './phases.js';
import { runReport } from './report.js';
import { computeGate, type GateOutcome } from './gate.js';
import { clearSession, isCancelled, release, setSession } from './lock.js';
import { sanitizeSlug, saveTask, type Task } from '../state/task.js';

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
}

/**
 * Persist + relay the task state to the SSE clients (Lát 4). One call replaces a bare saveTask at
 * every UI-visible transition so the browser mirror stays in lock-step with task.json.
 */
async function emit(task: Task, ctx: OrchestratorCtx): Promise<void> {
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

/** POST /api/tasks core: run Phase ① then gate; `maybeAutoAdvance` honors Confirm-mode from there. */
export async function startTask(task: Task, ctx: OrchestratorCtx): Promise<void> {
  await runPhaseAndGate(task, 'analyze', ctx);
  if (isCancelled(task.taskId)) return;
  await maybeAutoAdvance(task, ctx);
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
      release(task.taskId);
      return;
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
    return; // ④ is terminal — no further gate / auto-advance
  } else {
    return; // 'test' is terminal; defensively no-op
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
 * turn). `error` releases the lock (§I: error releases; retry re-acquires via /reply); success /
 * still_failing pause at `awaiting_confirm`. The caller decides whether to maybeAutoAdvance.
 */
async function gateAfterPhase(task: Task, verify: PhaseVerify, ctx: OrchestratorCtx): Promise<void> {
  task.gate = computeGate(task.phase, { outcome: verify.outcome }, task.deploy);
  if (verify.outcome === 'error') {
    task.status = 'error';
    task.error = verify.reasons.filter(Boolean).join(' | ') || 'phase failed';
    await emit(task, ctx);
    release(task.taskId); // error RELEASES the run-lock (§I) — /reply re-acquires to retry
    return;
  }
  task.status = 'awaiting_confirm'; // success or still_failing → pause; lock stays HELD at the gate
  task.error = undefined;
  await emit(task, ctx);
}

/** Decide per Confirm-mode whether THIS boundary auto-advances, then issue the primary confirm. */
async function maybeAutoAdvance(task: Task, ctx: OrchestratorCtx): Promise<void> {
  if (task.status !== 'awaiting_confirm') return; // error / done / cancelled never auto-advance
  if (task.gate?.flag === 'still_failing') return; // `auto` HARD-STOPS at still-failing (§D / AC #25)
  if (!boundaryAutoAdvances(task.confirmMode, task.phase)) return;
  const primary = task.gate?.actions.find((a) => a.kind === 'confirm');
  if (!primary) return; // terminal (④) — nothing to advance
  await confirmAdvance(task, primary.id, ctx);
}

/** auto → always; spec_only → pause only after Spec (② pauses, ①/③ auto); else (each_step OR any
 *  corrupt/unrecognized persisted value) → never auto. Fail-SAFE toward pausing, never toward an
 *  autonomous `auto` run (a stale `confirmMode:null` in a reconciled task.json must not silently run). */
function boundaryAutoAdvances(mode: Task['confirmMode'], phase: Task['phase']): boolean {
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
  const phase = PHASES.find((p) => p.id === phaseId) as PhaseDef;
  const sessKey = phaseId;

  task.phase = phaseId;
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const body = await readFile(join(projectsDir, phase.promptFile!), 'utf8');
  const renderedFresh = renderPrompt(body, phase.injectVars(task));
  // A /reply with a live session sends ONLY the change request (the resumed session has context); a
  // fresh fallback sends the rendered body + the request appended (seeded with the artifact PATH).
  const freshPrompt = opts?.replyText
    ? `${renderedFresh}\n\n## Change request (revise the existing artifact; do not restart from scratch)\n${opts.replyText}`
    : renderedFresh;
  const resumePrompt = opts?.replyText ?? freshPrompt;

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

  log.info({ taskId: task.taskId, phase: phaseId, resume: !!opts?.resumeId }, 'spawning turn');
  let turn = await spawnOnce(opts?.resumeId, opts?.resumeId ? resumePrompt : freshPrompt);

  // Resume-failure fallback (spec §A persistence caveat / Q3): a bad/expired session id makes the
  // child exit before any result event — re-run as a FRESH turn seeded with the artifact PATH.
  if (opts?.resumeId && turn.isError && !turn.result) {
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

    const lintClean =
      d.lintCodes != null &&
      d.lintCodes.validate === 0 &&
      d.lintCodes.lint_refs === 0 &&
      d.lintCodes.lint_plugin_hashes === 0;
    if (lintClean && d.idsOk) return { outcome: 'success', reasons: [] };

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
      JSON.parse(await readFile(abs, 'utf8'));
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
 * ④ Test&Report — BACKEND (no turn): re-run the 3 linters on the produced file, write report.json,
 * set `done`, RELEASE the lock. `acceptedLintFailure` (the still-failing "Accept anyway" path) is
 * surfaced in the report. On a report failure → `error` + Retry, lock released.
 */
async function runTestAndFinish(
  task: Task,
  ctx: OrchestratorCtx,
  acceptedLintFailure: boolean
): Promise<void> {
  const { projectsDir, log } = ctx;
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
    release(task.taskId);
    return;
  }
  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy); // terminal: no actions
  await emit(task, ctx);
  release(task.taskId); // done RELEASES the run-lock (§I)
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

  // Apply a user-edited slug/name from the confirm payload (AC #18), else propose from the requirement.
  if (override?.slug && override.slug.trim()) {
    task.slug = task.project = sanitizeSlug(override.slug.trim());
  }
  if (override?.name && override.name.trim()) {
    task.name = override.name.trim();
  }
  if (!task.slug) {
    const { slug, name } = deriveSlugName(task.requirement);
    task.slug = task.project = slug;
    if (!task.name) task.name = name;
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
function deriveSlugName(requirement: string): { slug: string; name: string } {
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

/** Tag an Error with an HTTP status code the route maps to a response. */
function httpError(statusCode: number, message: string): Error {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = statusCode;
  return e;
}

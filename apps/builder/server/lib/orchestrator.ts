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
import { ClaudeSession } from './claude-session.js';
import { confinementCheck, gitDirtyPaths } from './post-turn.js';
import { type TurnResult } from './turn-runner.js';
import { PHASES, renderPrompt, type PhaseDef } from './phases.js';
import { attachmentBlock } from './attachments.js';
import { snapshotDiffBase, writeDiffArtifact } from './diff.js';
import { lintClean } from './linters.js';
import { computeGate, type GateOutcome } from './gate.js';
import { clearSession, isCancelled, setSession, turnHolderId } from './lock.js';
import { emit, errMsg, httpError, resolveRunners, type OrchestratorCtx, type ConfirmPayload } from './orchestrator-shared.js';
import { deriveSlugName, firstFreeSlug } from './slug.js';
import { difySeedScaffoldAndPull, localEditSeed, scaffoldAtSpecGate, relocateRunArtifacts } from './scaffold.js';
import { runImportAndFinish, finishWithoutImport } from './import.js';
import { saveTask, type Task } from '../state/task.js';

// L2 (spec 019): the runner seams, ctx types, ConfirmPayload, and emit/errMsg/httpError moved to
// orchestrator-shared.ts (a leaf the extracted scaffold/import modules can import without a cycle); the
// pure slug helpers moved to slug.ts; the scaffold/seed IO moved to scaffold.ts. Re-export the public
// surface so routes/tasks.ts + the tests keep importing them from here unchanged.
export type { OrchestratorCtx, OrchestratorRunners, ConfirmPayload } from './orchestrator-shared.js';
export { deriveSlugName, firstFreeSlug };
export { localEditSeed };

/** Per-turn wall-clock budget (spec §I default 10 min; per-phase config is a later refinement). */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

interface PhaseVerify {
  outcome: GateOutcome;
  reasons: string[];
}

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




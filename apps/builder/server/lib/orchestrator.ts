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
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { ClaudeSession } from './claude-session.js';
import {
  confinementCheck, gitDirtyPaths, artifactHash, specRelFor, isSpecStale, type PostTurnDetail,
} from './post-turn.js';
import { type TurnResult, isTimeoutNote } from './turn-runner.js';
import { costFromResult } from './cost.js';
import { PHASES, renderPrompt, type PhaseDef } from './phases.js';
import { languagePin } from './language.js';
import { attachmentBlock } from './attachments.js';
import {
  applySpecProposal, beginSpecProposal, dropSpecProposal, fixRoundUndoable,
  snapshotDiffBase, snapshotSpecBase, writeDiffArtifact,
} from './diff.js';
import { lintClean, type LintCodes } from './linters.js';
import { computeGate, type GateOutcome } from './gate.js';
import { buildHolderId, clearSession, isCancelled, setSession } from './lock.js';
import { emit, errMsg, httpError, resolveLiveOps, resolveRunners, type OrchestratorCtx, type ConfirmPayload } from './orchestrator-shared.js';
import { deriveSlugName, firstFreeSlug } from './slug.js';
import { difySeedScaffoldAndPull, localEditSeed, scaffoldAtSpecGate, relocateRunArtifacts } from './scaffold.js';
import { runImportAndFinish, finishWithoutImport } from './import.js';
import { runLiveTest, finishLiveAccepted, cleanupTestApps } from './live-test.js';
import { difyTargets, enabledModelCount, harvestWorkspaceFacts, knowledgeBlock, loadWorkspaceFacts, redactSecrets } from './dify-io.js';
import { applyAnalysisToTask, gapReferences } from './analysis.js';
// `probeVerdict` only — the report RUNNER still arrives via resolveRunners (the 013 D2 test seam);
// these are pure wording (spec 066 S4), shared so the two probes cannot drift apart again.
import { probeVerdict } from './report.js';
import { checkRunnability, preflightNote, sourceContractNote } from './runnability.js';
import { persistCriteria } from './criteria.js';
import { AttemptRecorder } from './run-transcript.js';
import { logEvent } from './run-events.js';
import { bumpRev, noteUserLang, saveTask, taskDir, type Task } from '../state/task.js';

// L2 (spec 019): the runner seams, ctx types, ConfirmPayload, and emit/errMsg/httpError moved to
// orchestrator-shared.ts (a leaf the extracted scaffold/import modules can import without a cycle); the
// pure slug helpers moved to slug.ts; the scaffold/seed IO moved to scaffold.ts. Re-export the public
// surface so routes/tasks.ts + the tests keep importing them from here unchanged.
export type { OrchestratorCtx, OrchestratorRunners, ConfirmPayload } from './orchestrator-shared.js';
export { deriveSlugName, firstFreeSlug };
export { localEditSeed };

/** Per-turn wall-clock budget. Spec 085: raised to 15 min — a real ~30-node build lands lint-clean
 *  right at the old 10-min cap (run ng_quy_tr_nh_3: 600.7s on a valid file), so 10 min timed out
 *  legitimate builds by a hair. Ships in code (not a local .env) so `git pull` + rebuild carries it to
 *  every machine. Env-tunable (spec 048 D1): read ONCE at module load, so a change needs a restart. */
export const TURN_TIMEOUT_MS = Number(process.env.BUILDER_TURN_TIMEOUT_MS) || 15 * 60 * 1000;

interface PhaseVerify {
  outcome: GateOutcome;
  reasons: string[];
  /** ③'s lint exit codes (spec 048 D2) — threaded to ④ ONLY on the windowless maybeAutoAdvance
   *  ③→④ hop (same dispatched request, turn lock held), so runReport skips the identical re-run.
   *  Every path with a human window (each_step continue, ④ accept, /reply) re-runs (037 r2). */
  lintCodes?: LintCodes;
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
  // Spec 028: a fast build (from-scratch single-LLM; seed/edit/slug already forced fastMode:false, so
  // task.workflowSlug is null here) SKIPS the standalone Analyze turn+gate — `runPhaseAndGate('spec')` runs the
  // merged Analyze+Spec `draft.md` (the `spec` slot's fast, pre-scaffold promptFile) and stops at the
  // Spec gate. The Analyze gate is simply never emitted.
  // Spec 055: a from-scratch STANDARD build now runs a real (lean) Analyze turn — a requirement DIGEST
  // (overview the user can verify + find.py pattern pick + features), not the 046 D1 backend constant. It
  // routes through the same `runPhaseAndGate('analyze')` the seeded path uses, so it gets the Analyze gate
  // + report card in every mode. Only Fast (028) still starts at Spec (the merged `draft.md`). SEEDED builds
  // keep their full Analyze turn (seed summary/change_points) + gain the overview on top (055 D4).
  const startPhase: 'analyze' | 'spec' = task.fastMode ? 'spec' : 'analyze';
  await runPhaseAndGate(task, startPhase, ctx);
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
  payload?: ConfirmPayload,
  // Spec 048 D2: INTERNAL-ONLY (maybeAutoAdvance's windowless hop) — deliberately NOT a ConfirmPayload
  // field: payload is the HTTP request body, and a client-supplied reuseLint could skip the ④ lint
  // re-run on a WINDOWED path (fabricated codes after a gate edit). routes/ never populates this.
  internal?: { reuseLint?: LintCodes }
): Promise<void> {
  // Spec 103 Lane B — dropping a plan is the ONE confirm that must work from an ERROR too, so it sits
  // above the awaiting_confirm guard. A ② revise that died (a usage limit, a dropped connection) leaves
  // the build stranded at phase 'spec' with the draft open, and the error gate otherwise offers only
  // Retry (another paid turn) or Discard (throw away the whole build). "Forget the plan, put me back"
  // is free and is what a human wants after a turn dies through no fault of theirs.
  //
  // Safe above the guard because it runs NO turn: it deletes a scratch file and restores the state
  // captured when the proposal opened. Still gated on the gate actually offering it (never trust an
  // action id off the wire) and on `specRevise` (nothing to drop otherwise).
  if (actionId === 'drop_spec' && task.specRevise && task.gate?.actions.some((a) => a.id === 'drop_spec')) {
    await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'gate_action', phase: task.phase, detail: actionId });
    await dropSpecProposal(ctx.projectsDir, task);
    task.specRevise = undefined;
    await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'spec_proposal_dropped', phase: task.phase });
    await reparkAfterProposal(task, ctx);
    return;
  }
  if (task.status !== 'awaiting_confirm') {
    throw httpError(409, `task ${task.taskId} is not awaiting confirmation (status: ${task.status})`);
  }
  const action = task.gate?.actions.find((a) => a.id === actionId && a.kind === 'confirm');
  if (!action) {
    throw httpError(409, `'${actionId}' is not a current confirm action for ${task.taskId}`);
  }
  await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'gate_action', phase: task.phase, detail: actionId }); // S1b

  const cur = task.phase;
  // Spec 048 D2: the ③ verify captured here (spec branch) rides to the tail's maybeAutoAdvance — the
  // ONLY consumer is the windowless ③→④ hop inside this same dispatched request (lock still held).
  let implVerify: PhaseVerify | undefined;
  if (cur === 'analyze') {
    await runPhaseAndGate(task, 'spec', ctx);
  } else if (cur === 'spec') {
    // Spec 103 Lane B — the proposal decisions come FIRST: both are `confirm` actions at a spec gate,
    // and the generic branch below would scaffold + build without ever applying the draft.
    // `drop_spec` is handled at the TOP of this function — it must work from an error gate too, which
    // is above the awaiting_confirm guard. Never a CANCEL/DISCARD either way: those end the BUILD.
    if (actionId === 'apply_spec') {
      // ORDER IS LOAD-BEARING. Arm the undo snapshots BEFORE the rename: the rename is this round's
      // FIRST mutation, so a snapshot taken after it would record the already-changed spec — and the
      // undo button would then restore the wrong round, silently, which is worse than no undo. The ③
      // below runs from `confirmAdvance` and therefore carries no `replyText`, so runPhase's own
      // arming (which is gated on a reply) never fires for this path. This is the only place it can.
      await snapshotDiffBase(ctx.projectsDir, task, { restart: true });
      await snapshotSpecBase(ctx.projectsDir, task);
      task.fixUndoable = fixRoundUndoable(ctx.projectsDir, task);
      if (!(await applySpecProposal(ctx.projectsDir, task))) {
        task.status = 'error';
        task.error = 'the spec proposal is gone — nothing to apply';
        task.gate = computeGate('spec', { outcome: 'error' }, task.deploy);
        await emit(task, ctx);
        return;
      }
      task.specRevise = undefined;
      task.specReviseFrom = undefined; // consumed: the build moves forward from here, not back
      task.specApplied = true; // consumed by the ③ below: suppress the stale flag, keep the duty (H1)
      // The acceptance-criteria rubric is derived from SPEC.md, and SPEC.md just changed. It is
      // normally refreshed by the ② verify — which a revise deliberately skips, because a rubric must
      // never come from a draft nobody approved. So it has to be refreshed HERE, at the moment the
      // draft becomes real. Without this the live-test judge grades the new workflow against the OLD
      // spec's criteria: this spec's own drift disease, one artifact over.
      // Non-fatal, exactly as at the ② verify — a bad rubric degrades the judge, it must not fail a build.
      try {
        await persistCriteria(
          ctx.projectsDir, task,
          join(ctx.projectsDir, `projects/${task.project}/${task.workflowSlug}/SPEC.md`)
        );
      } catch (e) {
        ctx.log.warn({ taskId: task.taskId, err: errMsg(e) }, 'criteria refresh after apply failed (non-fatal)');
      }
      await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'spec_proposal_applied', phase: 'spec' });
      // RESUME the implement session, do not start a fresh ③. Lane B is only ever reachable from a
      // build that already HAS a workflow, and a fresh ③ re-instantiates from the pattern — on a large
      // workflow that is a rebuild wearing a fix's clothes. The normal ②→③ hop below runs fresh because
      // there is nothing yet to edit; here there is.
      await runPhaseAndGate(task, 'implement', ctx, { resumeId: task.sessionIds.implement });
      return;
    }
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
    implVerify = await runPhaseAndGate(task, 'implement', ctx);
  } else if (cur === 'implement') {
    // Spec 032: `test_live` → the LIVE sub-orchestrator (import→run→verify). `continue`/`accept` → the
    // STATIC path exactly as before (`accept` = the still-failing human override, lint≠0).
    if (actionId === 'test_live') {
      // Spec 036 D4: stamp the chosen target so report.ts and the /reply-re-runs-live path
      // (replyWithin's `testMode==='live'`) label the verdict as a real selfhost live test — not
      // `deploy=none` (createTask now defaults deploy:'none', S1). The stamp persists via runLiveTest's
      // first `emit` (which saveTasks). testMode='live' also arms the `/reply` re-run to stay live.
      task.deploy = 'selfhost';
      task.testMode = 'live';
      await runLiveTest(task, ctx);
      return; // ④ live parks at its own gate (test_result / infra_degraded) — never falls through
    }
    // 048 D2: reuseLint applies to 'continue' only — 'accept' is always a human click at a
    // still_failing gate (maybeAutoAdvance HARD-STOPS on that flag, so internal is never set there).
    await runTestAndFinish(task, ctx, actionId === 'accept', actionId === 'continue' ? internal?.reuseLint : undefined);
    // deploy=none|cloud → ④ is terminal (status:done) unless lint failed (spec 014 D2 → a ④ accept
    // gate). selfhost-clean → runTestAndFinish parks at the Import gate. Either parked gate is a
    // `flag` that maybeAutoAdvance HARD-STOPS on (D1 deploy / D2 still-failing), so `auto`/`spec_only`
    // wait for the explicit human button rather than auto-confirming (AC #16/#25 reworded).
  } else if (cur === 'test') {
    // Spec 032 live-test ④ gates (distinguished by the gate flag) take precedence over the static ones:
    //   test_result: accept → done · test_live → re-test (new app) · (changes is a /reply)
    //   infra_degraded: retry_live → re-run live · accept_static → done on the static result
    const flag = task.gate?.flag;
    if (actionId === 'test_live' || actionId === 'retry_live') {
      // A re-test ALWAYS makes a NEW app (D5); spec 036: runLiveTest auto-deletes the PRIOR apps so they
      // don't accumulate (the new app supersedes the old ones).
      await runLiveTest(task, ctx);
      return;
    }
    if (actionId === 'cleanup_apps') {
      // S6 / spec 036: delete this build's test apps then re-park the same live gate (the result still
      // stands). `payload.keepCurrent` deletes only the OLD apps (keep the current one); absent → delete all.
      await cleanupTestApps(task, ctx, payload?.keepCurrent === true);
      return;
    }
    if (actionId === 'accept_static' || (actionId === 'accept' && flag === 'test_result')) {
      await finishLiveAccepted(task, ctx); // accept the live/static result → done
      return;
    }
    // ── static ④ gates (unchanged) ──
    // 'import' → backend push + finish; 'skip_import' → done w/o push; 'accept' → the D2 still-failing
    // override (finish `done`, tagged accepted_lint_failure). 'discard' is /cancel.
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
  // implVerify.lintCodes is set only when THIS request just ran the ③ verify (spec branch above) —
  // for every other branch this is the plain no-reuse call it always was.
  await maybeAutoAdvance(task, ctx, implVerify?.lintCodes ? { reuseLint: implVerify.lintCodes } : undefined);
}

/**
 * POST /api/tasks/:id/reply core: re-run the CURRENT phase WITHIN the phase via
 * `--resume <sessionIds[phase]>` (Spike E5), re-verify, re-gate WITHOUT advancing. Also the Retry
 * path out of `error` (§I). A /reply never auto-advances — it is a human revise, so it always
 * pauses for the next decision (even in `auto`).
 */
export async function replyWithin(
  task: Task,
  text: string,
  ctx: OrchestratorCtx,
  /** Spec 103 Lane B — 'propose' = the human chose "show me the plan first" on THIS send. Per-send,
   *  never sticky: a mode that outlives the message that set it is a mode people forget they are in. */
  opts?: { mode?: 'direct' | 'propose' }
): Promise<void> {
  // Remember what language the human is writing in, BEFORE any branch below: only some of them carry
  // `text` into the prompt (the ④ static path re-runs the report with no turn at all), and every later
  // Continue carries none. Without this the language would silently revert at the next gate.
  await noteUserLang(ctx.projectsDir, task, text);
  // Spec 062 S1b: capture the USER'S steering — a Retry out of error vs a "Request changes" revision —
  // with the change text, so the dossier can explain WHY the build changed direction.
  await logEvent(taskDir(ctx.projectsDir, task.taskId), {
    kind: task.status === 'error' ? 'retry' : 'request_changes',
    phase: task.phase,
    detail: text,
  });
  // Spec 103 Lane B — the human wants the plan before the build. Route to ② in revise mode instead of
  // straight to ③. Deliberately ahead of every other branch: this is the human's explicit choice about
  // THIS message, and no gate-shape heuristic below should be able to override it.
  if (opts?.mode === 'propose') {
    if (await beginSpecProposal(ctx.projectsDir, task)) {
      // Capture where the human is standing BEFORE the phase moves — this is what a drop restores.
      task.specReviseFrom = { phase: task.phase, status: task.status, gate: task.gate };
      task.specRevise = true;
      await runPhaseAndGate(task, 'spec', ctx, { replyText: text });
      return;
    }
    // No spec on disk to revise — there is nothing to draft against, so fall through to the ordinary
    // fix path rather than failing the request. (Structurally near-unreachable: Lane B is only offered
    // on a build that already has a spec.)
  }
  if (task.phase === 'test') {
    // Spec 041 (generalizes the spec-032→036 fix): a "Request changes" at ANY ④ gate is a REVISION —
    // the human wants the WORKFLOW changed per their feedback. Route it back through the IMPLEMENT phase
    // (resume the implement session, edit main.yml with the change request), then re-park at the Implement
    // gate — the human re-tests from there via "Test with workflow". This holds for the LIVE gates
    // (test_result/infra_degraded) AND the STATIC gates (awaiting_import/still_failing): a ④ revision is
    // `status==='awaiting_confirm'`. The signal is `status`, NOT `testMode`, so the static gates now edit
    // the workflow instead of silently re-running the report on the UNCHANGED main.yml.
    //   (History: 032 dropped `text` and re-ran runLiveTest on the unchanged workflow → the edit no-op'd;
    //    036 fixed it for the live path only; 041 extends the same correct routing to every ④ gate.)
    //   `done` rides the SAME branch (the post-import fix loop): a finished build reopens for a revision
    //   instead of dying, so the fix the human found while testing in Dify lands in THIS conversation —
    //   same thread, same implement session — rather than in a brand-new edit-existing build. The route
    //   admits it only when `canRequestFix` holds (which already requires sessionIds.implement), so the
    //   fall-through below stays the awaiting_confirm/error path it always was.
    if ((task.status === 'awaiting_confirm' || task.status === 'done') && task.sessionIds.implement) {
      await runPhaseAndGate(task, 'implement', ctx, { resumeId: task.sessionIds.implement, replyText: text });
      return;
    }
    // Retry OUT OF ERROR (status==='error'), or no implement session to resume: re-run ④ itself, exactly
    // as before — a live turn on the live path, else the backend static report (no turn/session).
    if (task.testMode === 'live') {
      const resumeId = task.sessionIds.implement;
      await runPhaseAndGate(task, 'implement', ctx, { resumeId, replyText: text });
      return;
    }
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
): Promise<PhaseVerify | undefined> {
  // 048 D2: returns the verify (additive — most callers ignore it) so confirmAdvance's spec branch
  // can hand ③'s lintCodes to the windowless auto-hop. undefined on the cancel bail.
  const verify = await runPhase(task, phaseId, ctx, opts);
  if (isCancelled(task.taskId)) return undefined;
  await gateAfterPhase(task, verify, ctx);
  return verify;
}

/**
 * gateAfterPhase — set the gate + status from the verify outcome and STOP (do not issue the next
 * turn). Both outcomes END this turn's write-unit: `error` parks at `status:error` (a /reply retry
 * re-acquires the turn lock); success / still_failing park at `awaiting_confirm`. The turn lock is
 * freed by the dispatch `finally` when this work settles — a gate holds NO lock (turn-level, §I). The
 * caller decides whether to maybeAutoAdvance.
 */
async function gateAfterPhase(task: Task, verify: PhaseVerify, ctx: OrchestratorCtx): Promise<void> {
  // Spec 036 D1/D4: capability-aware Implement gate — the live "Test with workflow" button is offered per
  // reachable Dify target (difyTargets()), NOT by an upfront `deploy=selfhost` declaration. computeGate is
  // PURE, so the env probe happens HERE and the targets are passed in. Only computeGate's `implement`
  // branch reads them, so probing at every phase is harmless (analyze/spec/test ignore `targets`).
  const targets = difyTargets();
  // Spec 103 Lane B — a no-op revise never reaches a gate of its own: it returns the build to exactly
  // where the human was standing, with a one-line explanation there. Handled before computeGate
  // because there IS no ② gate shape for "nothing to decide".
  if (verify.outcome === 'spec_noop') {
    await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'spec_proposal_dropped', phase: 'spec', detail: 'no change needed' });
    await reparkAfterProposal(task, ctx);
    return;
  }
  task.gate = computeGate(task.phase, { outcome: verify.outcome }, task.deploy, targets, { specRevise: task.specRevise });
  if (verify.outcome === 'error') {
    task.status = 'error';
    task.error = verify.reasons.filter(Boolean).join(' | ') || 'phase failed';
    await emit(task, ctx);
    await logEvent(taskDir(ctx.projectsDir, task.taskId), { kind: 'error', phase: task.phase, detail: task.error }); // S1b
    return;
  }
  task.status = 'awaiting_confirm'; // success or still_failing → park (the turn lock frees on settle)
  task.error = undefined;
  await emit(task, ctx);
  await logEvent(taskDir(ctx.projectsDir, task.taskId), {
    kind: 'gate_reached',
    phase: task.phase,
    detail: task.gate?.flag ?? verify.outcome,
  }); // S1b
}

/** Spec 028 §5: true iff `features` is a NON-EMPTY array whose every entry is 'llm'. Deliberately
 *  FALSE for undefined/[] — ∅ ⊆ {llm} is vacuously true, but the guard must hard-stop on a merged
 *  draft that wrote no features (fail-safe), so we require non-empty. */
function featuresSubsetOfLlm(features: string[] | undefined): boolean {
  return Array.isArray(features) && features.length > 0 && features.every((f) => f === 'llm');
}

/** Decide per Confirm-mode whether THIS boundary auto-advances, then issue the primary confirm.
 *  `internal.reuseLint` (spec 048 D2) carries ③'s just-verified lint codes across the windowless
 *  ③→④ hop — mode-agnostic on purpose: `auto` AND `spec_only` (AND the fast+auto path) all ride
 *  this same seam, and all of them hop inside the one dispatched request that holds the turn lock. */
async function maybeAutoAdvance(
  task: Task,
  ctx: OrchestratorCtx,
  internal?: { reuseLint?: LintCodes }
): Promise<void> {
  if (isCancelled(task.taskId)) return; // a /cancel mutates a separate object — re-check the live flag
  if (task.status !== 'awaiting_confirm') return; // error / done / cancelled never auto-advance
  // Spec 103 Lane B: the whole point of a proposal is that a HUMAN reads it. An `auto` build that
  // self-approved its own plan would have paid for the extra ② turn and bought nothing.
  if (task.gate?.flag === 'spec_proposal') return;
  if (task.gate?.flag === 'still_failing') return; // `auto` HARD-STOPS at still-failing (§D / AC #25)
  if (task.gate?.flag === 'awaiting_import') return; // deploy is ALWAYS an explicit human decision (spec 014 D1)
  if (task.gate?.flag === 'test_result') return; // spec 032 B4: live-test verdict → human decides (auto only parks here on a fail)
  if (task.gate?.flag === 'infra_degraded') return; // spec 032 D1c: degrade-to-static → human decides
  if (!boundaryAutoAdvances(task.confirmMode, task.phase)) return;
  // Spec 028 §5: the auto+fast structural sanity-check — the ONE config with no human gate. Before
  // auto-confirming the MERGED Spec gate, require the draft's analyze.json.features (folded onto
  // task.analysisFeatures by the merged verify) to be a non-empty subset of {llm}. If the merged draft
  // itself found a non-trivial shape — or wrote no features — hard-stop and park at the Spec gate for a
  // human. (each_step/spec_only already paused via boundaryAutoAdvances, so this only fires under `auto`.)
  if (task.fastMode && task.phase === 'spec' && !featuresSubsetOfLlm(task.analysisFeatures)) {
    task.fastReviewNote = 'Fast build found a non-trivial shape — review before continuing';
    await emit(task, ctx);
    return;
  }
  // Spec 036 D5: an autonomous build is ALWAYS static at the implement gate — the primary is `continue`
  // (the first confirm). The 032 `testMode==='live' → primary=test_live` auto-pick is DELETED: `auto`/
  // `spec_only` never live-test (live is a human action from the done state, S5). testMode is never 'live'
  // at an autonomous implement gate anyway (only a human `test_live` click stamps it), so this is both the
  // policy AND already unreachable — even with self-host creds present the implement gate offers the
  // `test_live` button but auto takes `continue`, finishing `done` on the static test (AC #4).
  const primary = task.gate?.actions.find((a) => a.kind === 'confirm');
  if (!primary) return; // terminal (④) — nothing to advance
  await confirmAdvance(task, primary.id, ctx, undefined, internal);
}

/** auto → always; spec_only → pause only after Spec (② pauses, ①/③ auto); else (each_step OR any
 *  corrupt/unrecognized persisted value) → never auto. Fail-SAFE toward pausing, never toward an
 *  autonomous `auto` run (a stale `confirmMode:null` in a reconciled task.json must not silently run). */
export function boundaryAutoAdvances(mode: Task['confirmMode'], phase: Task['phase']): boolean {
  if (mode === 'auto') return true;
  if (mode === 'spec_only') return phase !== 'spec';
  return false; // each_step (and any unknown/corrupt value)
}

/** The header that tells an inlined phase doc where it lives, so its relative links resolve. Kept
 *  ASCII and one short block: it sits between the language pin (which must stay token-one) and the
 *  doc body, and every phase pays for its length on every turn. */
export function docOrigin(rel: string): string {
  return (
    `> The document below is the file \`${rel}\`, inlined here. Resolve every relative link in it ` +
    `from \`${dirname(rel)}/\`, and read paths from the repo root — e.g. \`[SKILL.md](SKILL.md)\` ` +
    `means \`${join(dirname(rel), 'SKILL.md')}\`.\n\n`
  );
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

  // Spec 103 step 1 — read BEFORE the overwrite two lines down: a /reply can be a fresh REVISION of a
  // clean round, or a RETRY of one that ERRORED mid-write. The snapshot logic below must tell them
  // apart, and after `status = 'running'` nothing can.
  const retryFromError = task.status === 'error';
  task.phase = phaseId;
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  task.fastReviewNote = undefined; // spec 028: a re-run/reply re-evaluates the §5 guard from scratch
  task.specNoop = undefined; // spec 103 Lane B: last round's "nothing to change" does not describe this one
  await emit(task, ctx);
  // Spec 062 S1b: record the phase start on the run timeline (non-fatal — logEvent swallows its own IO).
  await logEvent(taskDir(projectsDir, task.taskId), {
    kind: 'phase_start',
    phase: phaseId,
    detail: opts?.replyText ? 'reply' : opts?.resumeId ? 'resume' : 'fresh',
  });

  // The phase doc is INLINED into the prompt, so the subprocess receives its TEXT and never learns
  // which file that text came from. Every relative link inside it then resolves against the cwd (the
  // repo root) and misses: `[SKILL.md](SKILL.md)` — the ground rules each phase is ordered to read
  // FIRST — is looked for at the repo root and isn't there, and `[AGENTS.md](../../../AGENTS.md)`
  // climbs OUT of the repo. So no phase read the ground rules; each re-derived the shell-sandbox
  // rules by trial and error (one Analyze burned 8 consecutive hook-denied `find` calls). Naming the
  // origin costs two lines and fixes it for every phase of every build.
  const promptRel = phase.promptFile!(task);
  const body = docOrigin(promptRel) + (await readFile(join(projectsDir, promptRel), 'utf8'));
  // Spec 037 S2+S3 (Implement only): harvest the workspace facts (D5 — degrades to nothing without
  // creds/Dify; never blocks), then render them into the {{KNOWLEDGE}} token. The orchestrator owns
  // this — phases.ts stays pure/io-free (r2); the vars() default '' keeps every other phase (and a
  // facts-less Implement) byte-identical.
  let knowledge = '';
  let references = '';
  if (phaseId === 'implement') {
    await harvestWorkspaceFacts(projectsDir, task.taskId, log);
    knowledge = knowledgeBlock(await loadWorkspaceFacts(projectsDir, task.taskId));
    // The vetted files covering what the approved pattern LACKS. ③ is told to build from that one
    // pattern and never to search for another — but a build composes shapes, and one file rarely
    // carries them all. Handing ③ the missing example costs one Read; making it hunt costs ~38 turns
    // (run 1784267358546: 25 hook-denied greps for an `iteration` example the index could have named).
    // The pointer belongs HERE, not in SPEC.md: naming a path there is exactly what SKILL.md forbids
    // ("never surface the machinery … don't cite where it lives") — correct for the human at the ②
    // gate, fatal for the machine reading the same file. Same io-in-the-orchestrator seam as KNOWLEDGE.
    references = gapReferences(projectsDir, task.analysisPattern ?? '', task.analysisFeatures).join(' · ');
  }
  const renderedFresh = renderPrompt(body, {
    ...phase.injectVars(task),
    KNOWLEDGE: knowledge,
    REFERENCES: references,
  });
  // Spec 012: the trailing `添付画像:` path block (empty string when no images). Appended ONCE to
  // whichever prompt string is finally sent — this is the single seam BOTH the fresh render and the
  // /reply resume prompt pass through (the resume prompt skips phases.ts injectVars entirely), so it is
  // the only place that covers create→Analyze AND a reply at any phase (AC2/AC3). Every phase benefits,
  // including a fresh Implement turn. (046 D2: Implement now DOES inject {{REQUIREMENT}} — the
  // language banner needs the raw string — this seam still covers what token injection can't: resumes.)
  const block = attachmentBlock(task.attachments);
  // A /reply carries a CHANGE REQUEST under an explicit "revise the artifact" header. The resumed session
  // already has context, but WITHOUT this header a terse request (e.g. "Return the summary in ALL
  // UPPERCASE") reads as conversational and the model may answer instead of EDITING the file — the
  // observed bug where a live-gate "Request changes" re-ran Implement but left main.yml unchanged. Give the
  // resume prompt the SAME header as the fresh path so "revise the artifact" is unambiguous either way.
  const CHANGE_REQUEST = '## Change request (revise the existing artifact; do not restart from scratch)';
  // Spec 103 L0 — kept short on purpose: it rides EVERY fix round's prompt. Ordered by what goes wrong
  // most, not by what is easiest to say. Rule 1 is the observed failure; rule 2 is how it happens.
  //
  // Two things learned from the first real round that obeyed it (task 1787190372697):
  //  - NO shouty ALL-CAPS emphasis. The first draft said "made FALSE", and the model transliterated
  //    the English straight into its Japanese chat prose ("Now SPEC.md の false になった記述を直します").
  //    Salient English words get quoted back; plain ones do not.
  //  - The task id is HANDED OVER, never described. The resume path runs no token substitution, so
  //    "task id" as a phrase left the model to guess — it wrote the workflow slug instead, and the
  //    change-log row lost the one thing that makes it traceable. Same lesson as spec 090 S4: give
  //    the agent a value, never a condition (or, here, a name for a value it cannot see).
  const SPEC_RECONCILE =
    '## Also bring SPEC.md up to date\n' +
    'SPEC.md must describe the workflow as it is now — not the request it started from. After the ' +
    'workflow edit is in place:\n' +
    '1. Re-read SPEC.md and find every statement this change has made untrue. Correct those ' +
    'statements where they stand. A new decision written correctly, while the sentence it ' +
    'contradicts is left in place, is a broken spec — this is the most common way it breaks.\n' +
    '2. Do not add a new section for the change, and do not append an amendment or decision block. ' +
    'The change belongs in the section that already covers that topic.\n' +
    '3. One exception: a change-log table as the last section of the file. Append exactly one row — ' +
    `date, one line on what changed, and the task id \`${task.taskId}\` verbatim. Never rewrite an ` +
    'existing row. Heading and column names follow the language of the rest of the file.\n' +
    'If nothing in the document has become untrue, change nothing — a no-op is a correct outcome.';
  // Layer 1 reply-language guard: a native-language pin prepended at the TOP of every phase prompt (fresh
  // AND /reply) so the model's chat prose follows the HUMAN's language from token one. The single seam
  // covering both prompts, like the attachment block below. All four rungs are passed, and the order
  // matters — see resolveLang: this turn's own text first (a reply pinned off the requirement is the bug
  // that started this), then the sticky hint (THIS call is why it exists: a Continue past a gate arrives
  // here with no replyText at all), then the requirement (back-compat for everyone who never opts in).
  const langPin = languagePin({
    chatLang: task.chatLang,
    latest: opts?.replyText,
    hint: task.langHint,
    requirement: task.requirement,
  });
  // Spec 103 Lane B (§H1) — the ③ that follows an APPROVED proposal carries no `replyText`, so the
  // reconcile tail below is silent for it. It still needs a duty, and a DIFFERENT one: the spec is already
  // correct and human-approved, so the failure to guard against is not "forgot to update the spec"
  // but "could not build what was approved, and said nothing". ② has never met Dify's linters.
  const approvedTail =
    phaseId === 'implement' && task.specApplied
      ? '\n\n## The spec you are building was just approved by a human\n' +
        'Build exactly what SPEC.md now says. If some part of it cannot be built — a node type that ' +
        'does not exist, a shape the linters reject — do NOT quietly build something else. Say which ' +
        'part could not be built and why, update SPEC.md to describe what you actually built, and ' +
        'make the difference explicit in your reply.'
      : '';
  const freshPrompt =
    langPin + (opts?.replyText ? `${renderedFresh}\n\n${CHANGE_REQUEST}\n${opts.replyText}` : renderedFresh) + block + approvedTail;
  // Spec 037 D6(b): the RESUME prompt skips phases.ts injectVars entirely, so the facts ride the
  // same fresh+resume seam as the attachment block — appended on the replyText branch only (a fresh
  // turn already carries them via the token; appending here too would double them).
  const knowledgeTail = knowledge && opts?.replyText ? `\n\n${knowledge}` : '';
  // Spec 103 L0 — the reconcile directive rides the SAME resume seam as the facts above, and for the
  // same reason: a `/reply` prompt is `CHANGE_REQUEST + the user's text` and carries NO skill body, so
  // anything living only in `implement.md` reaches a FRESH turn and nothing else. That is exactly
  // inverted for this rule: a fresh ③ has a SPEC.md that ② wrote minutes ago (nothing to reconcile,
  // and nothing measured), while the fix round — the only place the document can go stale, and the
  // only place `specHashBefore` is captured — resumes.
  //
  // Shipped once WITHOUT this, and the miss was invisible: the turn happened to update SPEC.md on its
  // own initiative, so `specStale` read false and every check was green. What the human found by
  // READING the file was a spec contradicting itself — a new decision appended while the sentence it
  // falsified stood untouched. The directive below names that failure first, because it is the one
  // that actually happened.
  //
  // The gate is deliberately IDENTICAL to `specHashBefore`'s below: the instruction is delivered on
  // exactly the turns the measurement judges. Duplicated in `implement.md` step 6 for the fresh path,
  // the same way CHANGE_REQUEST is stated on both paths — see the comment there.
  const reconcileTail =
    phaseId === 'implement' && opts?.replyText ? `\n\n${SPEC_RECONCILE}` : '';
  // Spec 103 step 1 — an undo rewrote the files UNDER a live session. The resumed model still has its
  // own edits in context and would otherwise patch on top of a state that no longer exists (a resume
  // prompt carries no skill body, so implement.md's "re-read it fresh" never reaches it). Say so, once,
  // and clear the flag below so it is not repeated on later rounds.
  const undoneTail =
    phaseId === 'implement' && opts?.replyText && task.fixUndone
      ? '\n\n## Note: your previous edit in this session was UNDONE by the user\n' +
        'The files on disk are back to the state from before that edit. Re-read `main.yml` and ' +
        'SPEC.md from disk before changing anything — do not assume your earlier edits are still there.'
      : '';
  const resumePrompt = opts?.replyText
    ? langPin + `${CHANGE_REQUEST}\n${opts.replyText}${block}${knowledgeTail}${reconcileTail}${approvedTail}${undoneTail}`
    // Spec 103 Lane B — an APPROVED plan resumes ③ with no `replyText`. Falling through to
    // `freshPrompt` would re-send the whole implement.md body to a session that already built this
    // workflow, telling it to "instantiate" a file it has been editing for rounds: wasted tokens and,
    // worse, an instruction to start over. Give it the same shape a fix round gets — a short
    // instruction against the session's existing context.
    : task.specApplied && phaseId === 'implement'
      ? langPin +
        '## The spec changed — bring the workflow in line with it\n' +
        'A human just approved a revision of SPEC.md. Re-read it and edit the existing workflow to ' +
        'match. Do not rebuild from scratch.' +
        block + knowledgeTail + approvedTail
      : freshPrompt;
  // NOT cleared here. Clearing before the spawn means a turn that never started still consumed the
  // note, and the retry would go in blind onto files it believes it already edited. It is cleared after
  // the turn has actually run (verifyPhase), which is when the note has demonstrably been delivered.

  // Snapshot the pre-edit workflow BEFORE Implement overwrites it, so an edit-existing diff has a
  // real base (idempotent: no-op on a no-seed new build, a Dify-seed, or a /reply re-run, Task 4).
  // Spec 103 L0: a REVISION round (`replyText`) re-arms the base so the `差分` tab reads "this round",
  // not "since the build began". A first Implement keeps the original once-per-task capture.
  // `!retryFromError` on both arms: a RETRY re-runs a round that DIED MID-WRITE, so the disk may hold
  // that round's partial edits (a truncated main.yml is exactly the common ③ error). Re-arming here
  // would enshrine the corpse as the "pre-round state" — and the undo button, the one safety net,
  // would then restore corruption. The snapshots from the round's FIRST attempt are the true base and
  // must stand. (First-implement retry: nothing was ever armed, so `fixRoundUndoable` stays false and
  // no undo is offered — correct, since the true pre-round state is "no file".)
  if (phaseId === 'implement') {
    await snapshotDiffBase(projectsDir, task, { restart: !!opts?.replyText && !retryFromError });
  }
  // Spec 103 step 1 — and SPEC.md, on fix rounds ONLY. Same gate as `specHashBefore` below and as
  // SPEC_RECONCILE above, so three things stay one fact: this round is instructed to reconcile the
  // spec, measured on whether it did, and undoable if it did it wrong.
  if (phaseId === 'implement' && opts?.replyText) {
    if (!retryFromError) await snapshotSpecBase(projectsDir, task);
    // A HINT for the FE, re-checked by the route before it acts (the route is the authority; a
    // disagreement surfaces as a 409, never as a partial restore). Recomputed from disk rather than
    // assumed, because `snapshotDiffBase` no-ops for a Dify-seed build — those rounds are genuinely
    // not undoable, and a flag that claimed otherwise would offer a button that always fails.
    task.fixUndoable = fixRoundUndoable(projectsDir, task);
  }

  // Confinement baseline for THIS turn (captured just before spawn — after any scaffold).
  const baseline = await gitDirtyPaths(projectsDir);

  // Spec 094 S1 — the artifact's content hash for THIS turn, same moment as the baseline (after any
  // scaffold, before the spawn). ③ only: ①/② produce analyze.json / SPEC.md, whose "did it change"
  // question nobody asked. `null` here means the file does not exist yet (a first Implement), which
  // compares correctly against the post-turn hash — that turn WILL read as changed.
  const artifactHashBefore =
    phaseId === 'implement' ? await artifactHash(projectsDir, phase.artifactRel(task)) : undefined;

  // Spec 103 L0 — the SPEC.md hash, same moment, but ONLY on a REVISION round (`replyText`). On a first
  // Implement ② has just written SPEC.md from the requirement, so the document already describes the
  // workflow about to be built; measuring there would mark every new build stale on its first turn.
  // A revision is the case the spec exists for: the workflow moves on a free-text request, and until
  // now nothing moved the document with it (spec 103 §1.2).
  const specHashBefore =
    phaseId === 'implement' && opts?.replyText && task.project && task.workflowSlug
      ? await artifactHash(projectsDir, specRelFor(task.project, task.workflowSlug))
      : undefined;

  const runDir = taskDir(projectsDir, task.taskId);
  const spawnOnce = async (
    resumeSessionId: string | undefined,
    prompt: string,
    attempt: number
  ): Promise<TurnResult> => {
    const session = new ClaudeSession(`${task.taskId}:${phaseId}${resumeSessionId ? ':resume' : ''}`, {
      taskId: task.taskId,
      workingDir: projectsDir,
      settingsPath,
      log,
      resumeSessionId,
      // Spec 096: the start-bound model choice, so all four phases of one build are the same bet.
      // Undefined on a pre-096 task ⇒ no --model flag ⇒ unchanged behaviour.
      model: task.model,
    });
    setSession(task.taskId, session); // hand the child to /cancel
    // Spec 062 S1: record THIS attempt (prompt + output + tool calls + result). Best-effort — every
    // recorder callback is try-wrapped so it can never affect the turn; the SSE broadcast fires FIRST
    // and unchanged (AC #6).
    const rec = new AttemptRecorder({ phase: phaseId, attempt, resume: !!resumeSessionId, prompt });
    // Spec 085 S0: stamp the spawn moment on the timeline. Its delta from phase_start is the pre-turn
    // overhead, and the delta to the phase's terminal event bounds the turn's wall-clock — the split
    // that tells thrash-inside-the-turn apart from host-sleep/pre-turn time (run 1785770419076 had
    // ~13 min of its "23-minute ③" that no code between those two points can spend).
    await logEvent(runDir, {
      kind: 'turn_spawned',
      phase: phaseId,
      detail: `attempt ${attempt}${resumeSessionId ? ' (resume)' : ''}`,
    });
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
        onText: (text) => {
          ctx.broadcast?.(task.taskId, 'phase:output', { phase: phaseId, text });
          try {
            rec.onText(text);
          } catch {
            /* transcript is best-effort */
          }
        },
        onEvent: (event) => rec.onEvent(event),
      }
    );
    clearSession(task.taskId);
    // Append this attempt's transcript block (append, never overwrite — an error→retry keeps both, S1).
    const attemptCost = costFromResult(turn.result);
    await rec.flush(runDir, { cost: attemptCost, note: turn.note });
    // …and tell the live view what THIS ATTEMPT cost.
    //
    // `task.cost[phase]` cannot answer that question: it is last-write-wins across re-runs of the same
    // phase (see its own comment below), so after three fix rounds it holds only the third. Painting it
    // under all three run items would show one round's numbers three times, two of them false — the
    // exact failure this meter exists to expose. Per-attempt data was already being computed here for
    // the transcript; this only stops throwing it away.
    if (attemptCost) {
      ctx.broadcast?.(task.taskId, 'phase:cost', { phase: phaseId, cost: attemptCost });
      // …and write it where it outlives the browser. The live event only reaches a client that is
      // watching, and the thread it lands in is localStorage — so on any other machine, or on a run
      // nobody had open, the number was simply gone. `events.jsonl` already outlives all of that and
      // already ships inside the exported bundle.
      await logEvent(runDir, { kind: 'turn_cost', phase: phaseId, cost: attemptCost });
    }
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
  // stale in-memory status. `buildHolderId() !== task.taskId` is a defensive backstop (the BUILD lane is
  // held for THIS build across its whole dispatched work, so it should always match — 082) — if it
  // somehow doesn't, the spawn's setSession() would no-op → an untracked, unkillable turn. Bail either way.
  if (isCancelled(task.taskId) || buildHolderId() !== task.taskId) {
    task.status = 'cancelled';
    task.gate = undefined;
    await saveTask(projectsDir, task);
    return { outcome: 'error', reasons: ['cancelled before spawn'] };
  }

  log.info({ taskId: task.taskId, phase: phaseId, resume: !!opts?.resumeId }, 'spawning turn');
  let turn = await spawnOnce(opts?.resumeId, opts?.resumeId ? resumePrompt : freshPrompt, 1);

  // Resume-failure fallback (spec §A persistence caveat / Q3): a bad/expired session id makes the
  // child exit before any result event — re-run as a FRESH turn seeded with the artifact PATH.
  // A wall-clock TIMEOUT (or a spawn failure) sets turn.note — that is NOT a resume failure, and
  // re-running would silently spend a SECOND full TURN_TIMEOUT_MS. Exclude it so a /reply timeout
  // parks at error like a fresh-turn timeout instead of doubling the budget (spec 014 D4 / C4).
  if (opts?.resumeId && turn.isError && !turn.result && !turn.note) {
    log.warn({ taskId: task.taskId, phase: phaseId }, 'resume failed → fresh turn seeded with artifact');
    turn = await spawnOnce(undefined, freshPrompt, 2);
  }

  // Spec 059: record THIS phase's cost/metrics from the turn's terminal `result` event. Pure
  // observability — set AFTER the turn on the in-memory task, never read by the FSM, so it cannot
  // move behavior or quality. `null` when the turn died before a result (record no entry). Rides the
  // existing verify-success save AND gateAfterPhase's `emit` on the error/still-failing paths; `at`
  // orders a /reply re-run of the same phase (last write wins).
  const cost = costFromResult(turn.result);
  if (cost) task.cost = { ...(task.cost ?? {}), [phaseId]: { ...cost, at: Date.now() } };

  // A /cancel may have killed the child mid-turn. Converge the build's own state to `cancelled`
  // (idempotent with the cancel handler's write) and bail — do NOT verify/gate/advance. The lock is
  // owned/released by the cancel handler.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }

  const verify = await verifyPhase(phase, task, ctx, baseline, turn.note, artifactHashBefore, specHashBefore, turn.noteAdvisory);
  // verifyPhase awaits python/git subprocesses — a /cancel can land in that window. Re-check (mirrors
  // the guard at the spawn boundary above) so the success save below can't clobber `cancelled`→`running`.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }
  if (verify.outcome !== 'error') {
    // Spec 103 Lane B — a REVISE must NOT publish its draft as "the spec". `artifacts.spec` is read by
    // ③ as `{{PRIOR_ARTIFACT}}` (phases.ts) and by Ask as the spec to answer from; pointing either at
    // `SPEC.next.md` would make them build from / answer about an UNAPPROVED draft — and, once the
    // proposal is applied or dropped, from a path that no longer exists.
    if (!(phaseId === 'spec' && task.specRevise)) task.artifacts[sessKey] = phase.artifactRel(task);
    // Implement produced a (parseable) main.yml → compute + persist the {path,diff} payload now so
    // GET /api/tasks renders the split diff (base per kind: seed / pre-edit snapshot / empty, Task 4).
    if (phaseId === 'implement') {
      try {
        const written = await writeDiffArtifact(projectsDir, task);
        task.artifacts.diff = written.rel;
        // Spec 103 step 1 follow-up — how many places in SPEC.md this round touched. Only kept when the
        // spec actually moved: `0` and `undefined` both mean "nothing to say on the card", and the two
        // bad cases (workflow unchanged / spec left behind) already have their own badge and warning.
        task.specEdits = written.specHunks ? written.specHunks : undefined;
      } catch (e) {
        log.warn({ taskId: task.taskId, err: errMsg(e) }, 'diff producer failed (non-fatal)');
      }
    }
    await saveTask(projectsDir, task);
  }
  return verify;
}

/**
 * Spec 039 D5 — the ③ variant fold, extracted PURE so the hard/success/still_failing split is
 * directly unit-testable (post-turn-multi-lint.test.ts; `PostTurnResult.status` cannot express it).
 *
 * HARD error (→ status:error, Retry): a crash, a spawn/exit failure, a wall-clock TIMEOUT that left NO
 * usable artifact (missing/broken/out-of-confinement), unparseable YAML (truncation), a confinement breach
 * (security — always reverted + error, AC #23), an unparseable/missing EXTRA workflow file, or an
 * extension TWIN of the declared file (039 D4 — two canonical-looking artifacts is a correctness ambiguity
 * even lint-clean). These are NOT the still-failing gate (which assumes present, parseable, in-confinement
 * files). Spec 085: a TIMEOUT whose artifact is present/parseable/in-confinement is NO LONGER auto-hard —
 * it falls through to the lint check and is salvaged to `success` when clean (the cap often fires at the
 * tail of a big build's fix loop on an already-valid file).
 *
 * Success consumes the SHARED lintClean (013 D1) — the identical clean-test the ④ report's Import
 * precondition uses — for the declared artifact AND every extra (039 D5); anything else parks at
 * still_failing (cap-5 reached; the agent self-corrected as far as it could — §D / AC #20).
 */
export function resolveImplementOutcome(
  d: PostTurnDetail,
  turnNote: string | undefined,
  /** spec 104 S3 — the note came off a terminal `result` event, so it EXPLAINS rather than routes.
   *  Before S3 that path carried no note at all and this function decided purely on the post-turn
   *  detail; `otherNote` must keep behaving exactly that way, or attaching an explanation would
   *  silently start discarding clean artifacts — a full rebuild billed to the user who just hit
   *  their limit, which is the very cost spec 104 is about. */
  noteAdvisory?: boolean
): 'error' | 'success' | 'still_failing' {
  // Spec 085 (salvage-on-timeout): the 600s cap fires at the TAIL of a big build's fix loop, discarding an
  // artifact the independent post-turn verify would confirm CLEAN — only to force a full-cost rebuild (run
  // ng_quy_tr_nh_3: 29 nodes, validate/refs/plugin-hashes all 0, killed at 600.7s → HARD error). So a
  // TIMEOUT is not automatically hard: it hard-errors only if the artifact is missing/broken/out-of-
  // confinement (nothing worth keeping). Any OTHER note (spawn/exit failure) is never salvageable.
  const timedOut = isTimeoutNote(turnNote);
  const otherNote = !!turnNote && !timedOut && !noteAdvisory;
  const hardError =
    otherNote || !d.artifactOk || !d.yamlOk || d.confinementBreaches.length > 0 ||
    d.extraFiles.some((f) => !f.yamlOk || f.twin);
  if (hardError) return 'error';
  if (lintClean(d.lintCodes) && d.idsOk && d.extraFiles.every((f) => lintClean(f.lintCodes) && f.idsOk)) {
    return 'success'; // a timeout that nonetheless left a lint-clean, in-confinement artifact is salvaged
  }
  // Not clean: a timeout cut the fix loop short → do NOT ship a dirty file (stays HARD error, as before).
  // A no-note run that simply exhausted cap-5 parks at still_failing for the human (unchanged).
  return timedOut ? 'error' : 'still_failing';
}

/**
 * Spec 103 Lane B — after a proposal is dropped, put the build back where the human left it.
 *
 * A dropped proposal changed NOTHING: no file, no phase progress, no money spent past the ② turn. So
 * the build must return to the gate it was sitting at when the human asked — not to a spec gate it
 * never really left, and certainly not forward. `implement` is that gate for every entry point Lane B
 * has (a fix from the ③ gate, from ④, or from a finished build), because Lane B is only ever reachable
 * from a build that already HAS a workflow.
 */
async function reparkAfterProposal(task: Task, ctx: OrchestratorCtx): Promise<void> {
  // Restore the EXACT state captured when the proposal opened. Not a recomputed ③ gate: Lane B is
  // reachable from a ④ gate and from a finished build too, and reparking those at ③ would throw away a
  // gate / un-finish a `done` build — a real change, from the one button that promises none.
  const from = task.specReviseFrom;
  task.specReviseFrom = undefined;
  task.error = undefined;
  if (from) {
    task.phase = from.phase;
    task.status = from.status;
    task.gate = from.gate;
  } else {
    // Only reachable on a task written before this field existed. ③ is the safe landing: it is where
    // every Lane B entry point can move forward from, and it never claims a build is finished.
    task.phase = 'implement';
    task.status = 'awaiting_confirm';
    task.gate = computeGate('implement', { outcome: 'success' }, task.deploy, difyTargets());
  }
  bumpRev(task);
  await emit(task, ctx);
}

/** Post-turn verify → outcome. ③ resolves clean/still-failing/hard-error from the post-turn detail. */
async function verifyPhase(
  phase: PhaseDef,
  task: Task,
  ctx: OrchestratorCtx,
  baseline: Set<string>,
  turnNote: string | undefined,
  /** spec 094 S1 — the pre-spawn artifact hash (③ only; `undefined` elsewhere ⇒ not measured). */
  artifactHashBefore?: string | null,
  /** spec 103 L0 — the pre-spawn SPEC.md hash (③ REVISION rounds only; `undefined` ⇒ not measured). */
  specHashBefore?: string | null,
  /** spec 104 S3 — see resolveImplementOutcome. The note still shows in `reasons`; it just cannot route. */
  noteAdvisory?: boolean
): Promise<PhaseVerify> {
  const { projectsDir, log } = ctx;
  const { postTurnCheck } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake

  // The skill bodies write task artifacts to the shorthand `.runs/<taskId>/` (cwd = repo root).
  // Relocate them into the canonical `apps/builder/.runs/<taskId>/` (spec §A :517) BEFORE verifying.
  await relocateRunArtifacts(projectsDir, task.taskId, log);

  if (phase.id === 'implement') {
    const check = await postTurnCheck({
      projectsDir,
      project: task.project!,
      workflowSlug: task.workflowSlug!,
      workflowFile: task.workflowFile,
      taskId: task.taskId,
      baseline,
      artifactHashBefore,
      specHashBefore,
      log,
    });
    const reasons = [...check.reasons];
    if (turnNote) reasons.unshift(turnNote);

    // Spec 094 S1 — carry the measurement onto the Task so BOTH gates can render it: ③ right here, and
    // ④ `awaiting_import` after the ③→④ hop (the R3→R4 path, where the user re-imported a file they
    // believed was new). A Task field, not a Gate field: `Gate.flag` is a union of mutually-exclusive
    // gate STATES, while "this round changed nothing" is an attribute that can ride any of them — and
    // the ④ gate is computed far from here, with no access to this verify.
    // `undefined` (not measured) leaves both fields untouched rather than asserting anything.
    if (check.detail.artifactChanged !== undefined) {
      task.artifactUnchanged = !check.detail.artifactChanged;
      task.artifactHash = await artifactHash(projectsDir, phase.artifactRel(task));
      if (task.artifactUnchanged) {
        await logEvent(taskDir(projectsDir, task.taskId), {
          kind: 'artifact_unchanged',
          phase: 'implement',
          // The dossier's only record of an empty round: before this, the ONLY way to tell R3 from R1
          // was opening the transcript and counting Write/Edit calls by hand.
          detail: task.workflowFile,
        });
      }
    }

    // Spec 103 L0 — the tripwire. `main.yml` is supposed to be a function of `SPEC.md` (§2.1); a fix
    // round that moves the workflow WITHOUT moving the document breaks that, and used to break it
    // silently. Both measurements must be present: `undefined` on either side means "not measured"
    // (a first Implement does not measure the spec at all), and a missing measurement must never be
    // read as an assertion — the 094 S1 contract, kept verbatim.
    //
    // ADVISORY, deliberately: this is set/cleared on the Task and rendered at the gate, it does NOT
    // push a reason and does NOT fail the phase. Killing a lint-clean `main.yml` over a bookkeeping
    // miss costs more than it protects, and a hard stop here would re-open the ③ thrash spec 085 paid
    // real money to close. Whether the badge should ever become a block is a question for the measured
    // rate after this ships (spec 103 §3.4 / §7 Q6), not for a guess today.
    // Spec 103 Lane B (§H1) — an APPROVED plan suppresses the flag EXPLICITLY, not by accident. It
    // happens not to fire today only because the apply path carries no `replyText` and so captures no
    // before-hash; the day someone threads the request text through that path, the flag would raise a
    // false alarm on every single approval. Say it out loud instead of depending on the omission.
    // The DUTY is not suppressed — `approvedTail` still tells that turn it may not silently deviate.
    task.specStale = task.specApplied
      ? undefined
      : isSpecStale(check.detail.artifactChanged, check.detail.specChanged);
    task.specApplied = undefined; // consumed by the turn it was set for
    // Spec 103 step 1 — the undo note rode THIS turn's prompt, so it is delivered; clear it so later
    // rounds are not told about an undo they had nothing to do with. Cleared even when the turn errored:
    // the model received the prompt either way, and a note that never expires is a note that lies.
    task.fixUndone = undefined;
    if (task.specStale) {
      await logEvent(taskDir(projectsDir, task.taskId), {
        kind: 'spec_stale',
        phase: 'implement',
        detail: task.workflowFile,
      });
    }

    // Spec 037 S1 — the runnability preflight (D3/D4): recomputed on EVERY implement verify (fresh,
    // /reply revise) so a fix clears the note and a regression re-raises it; persisted to
    // .runs/<id>/preflight.json (the criteria.json convention) for the report/tests; NON-FATAL —
    // a detector throw (unparseable artifact etc.) logs and never fails the phase. Deliberately
    // NOT in gateAfterPhase (036's seam) — the two specs edit disjoint code (D4/D8).
    try {
      // Spec 066 S3: the ③ gate card shares preflightNote with the ④ report, so it must make the
      // same promise — the harvest ran moments ago (harvestWorkspaceFacts precedes every Implement
      // spawn), so its model count is fresh here.
      const pf = await checkRunnability(projectsDir, phase.artifactRel(task), resolveRunners(ctx).runPython, {
        workspaceModelCount: enabledModelCount(await loadWorkspaceFacts(projectsDir, task.taskId)),
      });
      await writeFile(
        join(projectsDir, `apps/builder/.runs/${task.taskId}/preflight.json`),
        JSON.stringify(pf, null, 2)
      );
      task.preflightNote = preflightNote(pf) ?? undefined;
      task.sourceContractNote = sourceContractNote(pf) ?? undefined; // spec 072 S2 — rides the reuse hop like preflightNote
    } catch (e) {
      log.warn({ taskId: task.taskId, err: errMsg(e) }, 'runnability preflight failed (advisory, non-fatal)');
    }

    const outcome = resolveImplementOutcome(check.detail, turnNote, noteAdvisory);
    // 048 D2: expose ③'s lint codes for the windowless hop. `?? undefined` — detail.lintCodes is
    // null when the artifact was missing/empty, but that maps to 'error' (never hops) anyway.
    return {
      outcome,
      reasons: outcome === 'success' ? [] : reasons,
      lintCodes: check.detail.lintCodes ?? undefined,
    };
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
    // Spec 090 S3 — adopt a misplaced ② SPEC.md before declaring it missing. On a slug-set task the
    // canonical path is `projects/…/SPEC.md`, but a turn that misread the state as pre-slug wrote a
    // GOOD file to `.runs/<taskId>/SPEC.md` and the build then died UNRECOVERABLY (retry re-read the
    // same misplaced file and wrote nothing — runs 1785901684698 + 1785916628346). The file is this
    // task's own artifact in its own run dir, so adopting = moving it to the path every downstream
    // reader (③ PRIOR_ARTIFACT, /spec panel, bundle, criteria) derives from the SAME slug rule.
    // Guards: spec phase only; canonical path is projects/… only (a pre-slug task's canonical path
    // IS the run dir — structurally unreachable here); non-empty only (never adopt a stub).
    // Precedent: scaffoldAtSpecGate moves this very file on the healthy path.
    let salvaged = false;
    if (phase.id === 'spec' && rel.startsWith('projects/')) {
      const strayAbs = join(projectsDir, `apps/builder/.runs/${task.taskId}/SPEC.md`);
      try {
        const straySize = (await stat(strayAbs)).size;
        if (straySize > 0) {
          await mkdir(dirname(abs), { recursive: true });
          await rename(strayAbs, abs);
          size = straySize;
          salvaged = true;
          log.warn({ taskId: task.taskId, from: strayAbs, to: rel }, '② SPEC.md adopted from the run dir (spec 090 S3)');
        }
      } catch {
        /* stray missing/unreadable → fall through to the normal missing-artifact reason */
      }
    }
    if (!salvaged) reasons.push(`artifact missing: ${rel}`);
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
  // Spec 028 §3: the MERGED draft turn (fast `spec`) also wrote analyze.json — fold it too. Its path is
  // NOT `phase.artifactRel` (that is SPEC.md); it is the analyze slot's canonical path (post-relocate).
  // Folding sets task.analysisFeatures, which the §5 auto+fast guard reads. Set artifacts.analyze here
  // (runPhase sets artifacts.spec via `artifacts[sessKey]`). Throws on invalid/missing JSON → error.
  if (phase.id === 'spec' && task.fastMode) {
    const analyzeRel = PHASES.find((p) => p.id === 'analyze')!.artifactRel(task);
    try {
      applyAnalysisToTask(task, await readFile(join(projectsDir, analyzeRel), 'utf8'), projectsDir);
      task.artifacts.analyze = analyzeRel;
    } catch (e) {
      reasons.push(`analyze.json invalid/missing (merged draft): ${errMsg(e)}`);
    }
  }
  // Spec 032 A3: persist the Acceptance-Criteria rubric from SPEC.md → criteria.json. NON-FATAL — a
  // parse/write failure never fails Spec; the live-test judge (T3) just degrades to a smoke-test. Runs
  // for every spec verify (standard + fast + /reply) so a human's gate edit to the criteria is captured.
  // Spec 103 Lane B: `task.specRevise` skipped — the criteria rubric describes the SHIPPING spec, and
  // a draft nobody approved must not silently become what the live-test judge grades against.
  if (phase.id === 'spec' && size > 0 && !task.specRevise) {
    try {
      await persistCriteria(projectsDir, task, abs);
    } catch (e) {
      log.warn({ taskId: task.taskId, err: errMsg(e) }, 'criteria persist failed (non-fatal)');
    }
  }
  // Confinement runs unconditionally — a breach must be reverted even if the artifact failed.
  reasons.push(
    ...(await confinementCheck({ projectsDir, project: task.project, workflowSlug: task.workflowSlug, taskId: task.taskId, baseline, log })).breaches
  );
  // Spec 103 Lane B — a clean REVISE settles as its own outcome, which is what lets the pure
  // `computeGate` offer the proposal gate instead of the build gate (an outcome, not a task read).
  if (!reasons.length && phase.id === 'spec' && task.specRevise) {
    // Spec 103 Lane B — a revise that (correctly) found nothing to change must NOT park at a gate
    // headed "here is what I would change". `spec-revise.md` explicitly allows a no-op — a request
    // that only affects how the YAML is written has no place in a document about behaviour — so this
    // is a normal outcome, not a failure. Reaching a decision gate with an empty decision wastes the
    // human's attention and teaches them the gate is noise.
    const liveAbs = join(projectsDir, `projects/${task.project}/${task.workflowSlug}/SPEC.md`);
    let identical = false;
    try {
      identical = (await readFile(abs, 'utf8')) === (await readFile(liveAbs, 'utf8'));
    } catch {
      /* unreadable → treat as a real proposal; the gate is the safe direction */
    }
    if (identical) {
      await dropSpecProposal(projectsDir, task);
      task.specRevise = undefined;
      task.specReviseFrom = undefined;
      task.specNoop = true; // the ③ gate says so, instead of the build silently doing nothing
      return { outcome: 'spec_noop', reasons: [] };
    }
    return { outcome: 'spec_proposal', reasons: [] };
  }
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
/**
 * Spec 049 D2 — the ④ import-probe: push the produced YAML to the user's REAL Dify, capture the
 * verdict, delete the probe app immediately. The one oracle that catches import blockers our
 * linters have not met yet (the mimic-drift problem). ADVISORY ONLY in v1 (020: warn → measure →
 * promote): the returned note NEVER feeds lintClean or a gate. Returns undefined (no note) when
 * there is nothing to probe against: no selfhost creds, or the live path (whose real import IS the
 * oracle — defensive: runTestAndFinish is not reachable with testMode==='live' today).
 * Exported for direct unit tests (the resolveImplementOutcome precedent).
 */
export async function runImportProbe(task: Task, ctx: OrchestratorCtx): Promise<string | undefined> {
  if (task.testMode === 'live') return undefined;
  if (!difyTargets().selfhost) return undefined;
  if (!task.project || !task.workflowSlug) return undefined; // nothing produced yet — defensive
  const ops = resolveLiveOps(ctx);
  const wfRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
  // Unique per TASK and stable across its retries: Dify commits the app row BEFORE validating the
  // variables block, so a failed import can still leave an app behind (r3, review 3.1 — verified
  // live: eight orphans in one field workspace). A stable name lets THIS retry's reconcile sweep a
  // leak the previous retry's cleanup missed.
  const probeName = `[probe] ${task.taskId}`;
  try {
    const res = await ops.importForTest(ctx.projectsDir, task.project, task.workflowSlug, wfRel, probeName);
    if (res.ok && res.appId) {
      // Best-effort cleanup — a failed delete leaves one stray probe app, never fails the build.
      const deleted = await ops.deleteApp(ctx.projectsDir, res.appId).catch(() => false);
      // Spec 066 S4: the SHARED verdict strings (report.ts `probeVerdict`) — plain, framed for JA, and
      // impossible to reword in only one of the two probes. The cleanup-failure variant names the
      // stray app, because THAT one is a real user action.
      return probeVerdict.ok(deleted ? undefined : probeName);
    }
    if (res.ok && res.status === 'pending') {
      // HTTP 202: version-mismatch park (app NOT created; needs /confirm) — inconclusive, not a
      // DSL rejection. Exit code 0 + no app id would otherwise mislabel it FAILED (r3, review 3.3).
      return probeVerdict.parked();
    }
    // FAILED — sweep the possible orphan (see probeName note), then surface the VERBATIM (redacted)
    // Dify error: it is exactly what a ④ "Request changes" fix-turn needs (D3) — e.g. HTTP 400
    // "missing name" named the 2026-07-08 incident precisely.
    const rec = await ops.reconcileAppIdByName(ctx.projectsDir, probeName).catch(() => ({ appId: null, ambiguous: false }));
    if (rec.appId) await ops.deleteApp(ctx.projectsDir, rec.appId).catch(() => false);
    const detail = redactSecrets(res.stderr ?? '').trim().split('\n').slice(-3).join(' ⏎ ');
    return probeVerdict.rejected(detail);
  } catch (e) {
    return probeVerdict.skipped(redactSecrets(errMsg(e)));
  }
}

async function runTestAndFinish(
  task: Task,
  ctx: OrchestratorCtx,
  acceptedLintFailure: boolean,
  // 048 D2: ③'s codes from the SAME request's verify (windowless hop only) — see ReportOpts.reuseLint.
  reuseLint?: LintCodes
): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  // Spec 049 D2: probe BEFORE the report so the verdict lands in report.json. Set-or-cleared each
  // static ④ run (a /reply retry re-probes the changed file); persisted on the Task so the
  // Import/Skip re-report carries it too (the preflightNote precedent).
  task.probeNote = await runImportProbe(task, ctx);

  const res = await runReport(projectsDir, task, log, { acceptedLintFailure, reuseLint });
  if (isCancelled(task.taskId)) return; // a /cancel raced the (childless) ④ step

  if (!res.ok) {
    task.status = 'error';
    task.error = res.reasons.join(' | ');
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    await logEvent(taskDir(projectsDir, task.taskId), { kind: 'error', phase: 'test', detail: task.error }); // S1b
    return; // the dispatch `finally` frees the turn lock (§I)
  }

  // Spec 036 D4 (Option A): a CLEAN static test parks at the Import gate only for a HUMAN — `each_step`
  // or a null/corrupt confirmMode (fail-safe to human). The autonomous set `{auto, spec_only}` does NOT
  // park: it falls through to `done` static and reaches Dify only via the D5 done-state live action
  // (keeps `auto` hands-free with creds present, AC #4). The trigger is now CAPABILITY (`targets.selfhost`,
  // difyTargets()), not the removed upfront `deploy` declaration.
  const targets = difyTargets();
  const isAutonomous = task.confirmMode === 'auto' || task.confirmMode === 'spec_only';
  if (targets.selfhost && res.lintClean && !isAutonomous) {
    // Deploy-stamp fix (D4 Rev-A / AC #9): a static "Continue to Test" leaves `task.deploy='none'`, but if
    // the human then clicks Import the push succeeds (import.ts reads creds, not task.deploy) while
    // report.ts — which branches entirely on task.deploy — would mislabel it `deploy=none` / `DEPLOYED ·
    // none`. Stamp `selfhost` HERE, before the Import/Skip re-report, so the real import labels selfhost.
    // `testMode` stays 'static' — it WAS a static test; only the deploy target moves.
    task.deploy = 'selfhost';
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
  await logEvent(taskDir(projectsDir, task.taskId), { kind: 'gate_reached', phase: 'test', detail: 'done' }); // S1b
}




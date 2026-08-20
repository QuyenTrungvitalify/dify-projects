// gate-foot.ts — spec 035/036: the done/cancelled gate-foot actions, as INDEPENDENT guards.
//
// Extracted pure (out of GateCard's inline predicates) so the Non-goal #4 regression has a unit-test home
// (spec 035 §S1 / Biggest-risk #2): Restore is cancelled-only and must NOT require an on-disk workflow —
// a from-scratch build cancelled PRE-scaffold still has `project`/`workflowSlug` null, and ANDing those
// onto Restore (as an earlier single-predicate form did) silently dropped its Restore button. Edit-again,
// by contrast, needs a real on-disk edit target, so it DOES require both `project` and `workflowSlug`.
// Spec 036 D5 adds a THIRD action — "Run test with workflow" — for a done AUTONOMOUS build with self-host
// reachable (its only live path; each_step/null already saw the implement-gate button, so excluded).
import type { WireGateAction, WireTask } from '../types';

/** spec 053: a `kind:'reply'` gate button normally ARMS the composer (onArmChange). The one exception is
 *  the error gate's sole `retry` action, which fires a one-click, text-less re-run of the failed phase
 *  instead. Pure so gate-foot.test.ts can pin that the carve-out is scoped to `id==='retry' && error` and
 *  never leaks to another gate's reply buttons (still_failing "Keep trying", awaiting_import "Request
 *  changes", …). Returns which behavior the reply button should take. */
export function replyButtonKind(
  action: Pick<WireGateAction, 'id' | 'kind'>,
  status: WireTask['status'],
): 'retry' | 'arm' {
  return action.id === 'retry' && status === 'error' ? 'retry' : 'arm';
}

/**
 * Spec 103 step 1 — may the ③ gate offer "take this fix back"?
 *
 * Pure, and extracted here for the same reason its neighbours were (spec 035 §S1): every clause below
 * is a regression waiting to happen, and each one has a reason a reader cannot infer from the code.
 *
 *  - `!resolved` — a gate card sitting in the scroll-back is HISTORY. Acting on it would restore files
 *    from a round that is several rounds old, using snapshots that describe a different one.
 *  - phase + status — undo is a ③-gate action. At ④ the human has just learned something from the
 *    report or the live run, and the right move is to fix forward; a rewind there would also strand a
 *    report describing a file that no longer exists. This also makes the dangerous case impossible by
 *    construction: an import only happens at ④, so no undo can contradict what is already in Dify.
 *  - `fixUndoable` — the snapshot PAIR exists. False for a Dify-seed build (`snapshotDiffBase` no-ops
 *    there), where only half the round could be taken back, which is worse than not offering it.
 *
 * The server re-checks all of it and answers 409; this decides whether to render, never whether it is
 * safe. Both must agree, so both are written from the same list.
 */
export function canUndoFix(
  task: Pick<WireTask, 'phase' | 'status' | 'fixUndoable'>,
  resolved: boolean
): boolean {
  return (
    !resolved &&
    task.fixUndoable === true &&
    task.phase === 'implement' &&
    task.status === 'awaiting_confirm'
  );
}

/** True for the `boundaryAutoAdvances`-autonomous set {auto, spec_only}; a null/corrupt confirmMode fails
 *  safe to NON-autonomous (treated as each_step → excluded from the done-state live action, D5). */
function isAutonomous(mode: WireTask['confirmMode'] | undefined): boolean {
  return mode === 'auto' || mode === 'spec_only';
}

/** `has.restore`/`has.editAgain`/`has.runTest`/`has.requestFix` = whether the parent wired that handler
 *  (GateCard passes `!!onRestore` / `!!onEditAgain` / `!!onRunTest` / `!!onRequestFix`). Returns which
 *  terminal-foot actions should render. Pure. */
export function terminalFootActions(
  task: Pick<WireTask, 'status' | 'project' | 'workflowSlug' | 'confirmMode' | 'liveTargets'>,
  has: { restore: boolean; editAgain: boolean; runTest: boolean; requestFix?: boolean }
): { restore: boolean; editAgain: boolean; runTest: boolean; requestFix: boolean } {
  return {
    // The post-import fix loop: a DONE build keeps a "Request a fix" button, because the human's real
    // acceptance test — importing into Dify and running it — happens after this card says 完了. It arms
    // the composer's change-mode, so the fix is typed into THIS conversation (server: POST /reply, which
    // resumes the implement session). `done` only: a CANCELLED build's re-entry is Restore, and its
    // implement session may never have existed. Requires an on-disk target, exactly like Edit-again.
    requestFix:
      task.status === 'done' && !!task.project && !!task.workflowSlug && !!has.requestFix,
    restore: task.status === 'cancelled' && has.restore,
    editAgain:
      (task.status === 'cancelled' || task.status === 'done') &&
      !!task.project &&
      !!task.workflowSlug &&
      has.editAgain,
    // spec 036 D5 + discoverability change: a done AUTONOMOUS build with an on-disk workflow can offer the
    // "Run test with workflow" foot REGARDLESS of whether self-host is configured — so the user discovers
    // the feature exists. Self-host reachability is NO LONGER a display gate; it is checked on click
    // (store.liveTest → a localized "configure self-host + key" message) and re-checked server-side (409).
    // Still excluded for each_step/null (they saw the implement-gate live button).
    runTest:
      task.status === 'done' &&
      !!task.project &&
      !!task.workflowSlug &&
      isAutonomous(task.confirmMode) &&
      has.runTest,
  };
}

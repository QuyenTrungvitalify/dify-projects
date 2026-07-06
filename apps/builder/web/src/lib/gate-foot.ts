// gate-foot.ts — spec 035/036: the done/cancelled gate-foot actions, as INDEPENDENT guards.
//
// Extracted pure (out of GateCard's inline predicates) so the Non-goal #4 regression has a unit-test home
// (spec 035 §S1 / Biggest-risk #2): Restore is cancelled-only and must NOT require an on-disk workflow —
// a from-scratch build cancelled PRE-scaffold still has `project`/`workflowSlug` null, and ANDing those
// onto Restore (as an earlier single-predicate form did) silently dropped its Restore button. Edit-again,
// by contrast, needs a real on-disk edit target, so it DOES require both `project` and `workflowSlug`.
// Spec 036 D5 adds a THIRD action — "Run test with workflow" — for a done AUTONOMOUS build with self-host
// reachable (its only live path; each_step/null already saw the implement-gate button, so excluded).
import type { WireTask } from '../types';

/** True for the `boundaryAutoAdvances`-autonomous set {auto, spec_only}; a null/corrupt confirmMode fails
 *  safe to NON-autonomous (treated as each_step → excluded from the done-state live action, D5). */
function isAutonomous(mode: WireTask['confirmMode'] | undefined): boolean {
  return mode === 'auto' || mode === 'spec_only';
}

/** `has.restore`/`has.editAgain`/`has.runTest` = whether the parent wired that handler (GateCard passes
 *  `!!onRestore` / `!!onEditAgain` / `!!onRunTest`). Returns which terminal-foot actions should render. Pure. */
export function terminalFootActions(
  task: Pick<WireTask, 'status' | 'project' | 'workflowSlug' | 'confirmMode' | 'liveTargets'>,
  has: { restore: boolean; editAgain: boolean; runTest: boolean }
): { restore: boolean; editAgain: boolean; runTest: boolean } {
  return {
    restore: task.status === 'cancelled' && has.restore,
    editAgain:
      (task.status === 'cancelled' || task.status === 'done') &&
      !!task.project &&
      !!task.workflowSlug &&
      has.editAgain,
    // spec 036 D5: a done AUTONOMOUS build with an on-disk workflow + self-host reachable NOW can run a
    // live test from the foot. Excluded for each_step/null (they saw the implement-gate live button) and
    // when no self-host target is configured. The server re-checks this same predicate (never trusts us).
    runTest:
      task.status === 'done' &&
      !!task.project &&
      !!task.workflowSlug &&
      !!task.liveTargets?.selfhost &&
      isAutonomous(task.confirmMode) &&
      has.runTest,
  };
}

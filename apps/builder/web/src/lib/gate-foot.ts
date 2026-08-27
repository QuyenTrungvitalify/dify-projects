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

/**
 * How a `kind:'reply'` gate action is drawn. Three answers, and between them they enforce one rule:
 * **no gate button may point at the composer.**
 *
 *  `'retry'` — a single click that re-runs the phase with no text. `retry` (out of error) and `keep`
 *  ("Keep trying" at the still-failing Implement gate) both mean "go again, I have nothing to add", and
 *  the route accepts an empty body for exactly these — the shared list is `TEXTLESS_REPLY_IDS` in the
 *  server's lib/gate.ts. `keep` used to answer `'arm'`, which made its label a promise the mechanism
 *  broke: 「再試行を続ける」 opened an empty box you then HAD to type into, because /reply answered 400
 *  without text. `retry` stays scoped to an errored build, where it is the only action there is.
 *
 *  `'hidden'` — `changes`. It sent nothing: it focused the composer and highlighted the ✎ pill already
 *  on screen, under the same label (`modeChange` and `ACTION_JA['Request changes']` are both 修正を依頼).
 *  A signpost pointing at the thing beside it. The pill is the door.
 *
 *  `'arm'` — nothing reaches it today, and that is the point rather than an oversight: it is what a NEW
 *  reply id would fall back to, and it will read wrong the moment such a button lands inside the
 *  composer row, which is where gate actions now live. Decide then whether the new action is a click or
 *  a sentence; do not let it default into being a label on a box.
 *
 * Hiding is a RENDER decision only: `gate.actions` still carries `changes` on the wire, because the
 * promote `/reply` route validates against it and the spec panel's own three-button row looks it up.
 */
export function replyButtonKind(
  action: Pick<WireGateAction, 'id' | 'kind'>,
  status: WireTask['status'],
): 'retry' | 'arm' | 'hidden' {
  if (action.id === 'retry') return status === 'error' ? 'retry' : 'arm';
  if (action.id === 'keep') return 'retry';
  return action.id === 'changes' ? 'hidden' : 'arm';
}

/**
 * Which of a gate's actions are drawn as BUTTONS, in the composer row where the gate's decisions live.
 *
 * The rule the whole surface is built on: the conversation thread holds no button that changes state.
 * A gate card is evidence — what happened, and links to read it — and every decision that moves the
 * build sits in one place, the row you are already typing in. So this list is what the composer draws,
 * and what it drops is dropped because something ELSE owns it:
 *
 *   · `kind:'cancel'` → the header pill. Ending a build is not a step of the build, and 「破棄」 a
 *     thumb's width from 「進む」 is how a fat finger ends an hour of work.
 *   · `cleanup_apps`  → the card's small-link row, beside "take this fix back". It changes state (it
 *     deletes apps in Dify) but it does not move the build, and a housekeeping button standing at the
 *     same weight as the phase's decision reads as one of the ways forward.
 *   · `changes`       → the composer's own ✎ pill, which is right there under the same label.
 *
 * Order is the server's, so the primary stays first — the leftmost button, the one still readable when
 * a narrow row scrolls the group.
 */
export function visibleGateActions(
  task: Pick<WireTask, 'gate' | 'status'>
): WireGateAction[] {
  return (task.gate?.actions ?? []).filter((a) => {
    if (a.kind === 'cancel') return false;
    if (a.id === 'cleanup_apps') return false;
    if (a.kind === 'reply') return replyButtonKind(a, task.status) !== 'hidden';
    return true;
  });
}

/** Does this gate offer to end the build? Drives the header pill, so that its 「破棄」 appears exactly
 *  where the backend actually offers one — never on the promote share gates, which are confirm-only on
 *  purpose so that declining to share cannot mark a finished promotion `cancelled`. */
export function gateOffersCancel(task: Pick<WireTask, 'gate'> | null | undefined): boolean {
  return (task?.gate?.actions ?? []).some((a) => a.kind === 'cancel');
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

/** `has.restore`/`has.editAgain`/`has.runTest` = whether the parent wired that handler
 *  (GateCard passes `!!onRestore` / `!!onEditAgain` / `!!onRunTest`). Returns which terminal-foot
 *  actions should render. Pure.
 *
 *  A `requestFix` action used to live here — a "Request a fix" button on the done card, arming the
 *  composer for the post-import fix loop. It is gone, and the loop is not: on a done build the composer
 *  already renders the ✎ pill (`terminalFixable`) under the SAME label, 修正を依頼. The button pointed at
 *  a button on the same screen, and the two read identically while behaving differently — one armed,
 *  one sent. One door per act. */
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

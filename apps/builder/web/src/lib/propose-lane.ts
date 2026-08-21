// propose-lane.ts — whether the composer offers "show me the plan first" (spec 103 Lane B).
//
// Extracted pure out of App.tsx for the same reason `composer-route.ts` and `gate-foot.ts` were: the
// decision degrades SILENTLY in both directions. Offer the lane where the server will refuse it and
// the caret does nothing; hide it where it was legal and a paid review gate quietly stops existing.
// Neither shows up as an error, and neither had a unit-test home while it lived inline.
//
// The server re-derives all of this in `POST /reply` (`wantsPropose`) and is the authority; this only
// decides whether to render the caret.
import type { WireTask } from '../types';

/** The task fields the decision reads — a narrow view, so a test needs no whole task. */
export type ProposeLaneTask = Pick<
  WireTask,
  'project' | 'workflowSlug' | 'artifacts' | 'specRevise' | 'confirmMode'
>;

/**
 * True iff the composer should offer the plan-first lane.
 *
 *  - a workflow must EXIST: at ① and ② the spec is still being written, so there is nothing to plan a
 *    change TO. `artifacts.implement` is set by the ③ verify, which makes it the honest "there is
 *    something to fix" signal.
 *
 *    The key is `implement`, NOT `yaml`: `artifacts` is keyed by PHASE ID (runPhase writes
 *    `artifacts[sessKey]`), so `artifacts.yaml` is always undefined and gating on it silently disabled
 *    the entire feature. `artifactContents.yaml` is a different object — that one holds file CONTENT.
 *
 *  - one proposal at a time: a second would diff against a spec being replaced.
 *
 *  - NOT under `auto` (spec 105). A proposal is a gate that waits for a human, and `auto` is the user
 *    saying there is no human waiting. The two cannot both be honoured, and the honest resolution is
 *    to stop offering the lane rather than to offer it and then not wait: `maybeAutoAdvance` hard-stops
 *    on the proposal gate, so an `auto` build that opened one would sit there — having paid for the ②
 *    turn — until someone came back and clicked. A button that cannot do what it says is worse than an
 *    absent one, and the cost of that lesson was already paid once by the confirm-mode chip, which
 *    could be switched to `auto` mid-proposal and change nothing at all.
 */
export function canPropose(task: ProposeLaneTask | null | undefined): boolean {
  if (!task) return false;
  return (
    !!task.project &&
    !!task.workflowSlug &&
    !!task.artifacts?.implement &&
    !task.specRevise &&
    task.confirmMode !== 'auto'
  );
}

/**
 * The Confirm-mode values the chip may offer for THIS task — the other half of the same rule.
 *
 * Hiding the plan-first lane under `auto` is not enough on its own: the chip is live-patchable at a
 * parked gate, so a human could open a proposal under `each_step` and then switch to `auto` while it
 * sits there. Nothing would happen — the proposal gate hard-stops autonomous advance — leaving a mode
 * that reads as "don't stop" on a build that is stopped, with no way to tell why. The server refuses
 * that PATCH; this keeps the UI from proposing it in the first place.
 *
 * Note the asymmetry with {@link canPropose}: that one reads `confirmMode`, this one reads
 * `specRevise`. Whichever the human picked FIRST stands, and the other option withdraws.
 */
export function confirmModeOptions<T extends { v: string }>(
  all: readonly T[],
  task: Pick<WireTask, 'specRevise'> | null | undefined
): T[] {
  if (!task?.specRevise) return [...all];
  return all.filter((o) => o.v !== 'auto');
}

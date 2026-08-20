/**
 * gate.ts — gate-action computation for spec 009 Lát 3 (the crux).
 *
 * PURE (no I/O): the orchestrator owns the lint exit codes (Lát 1's post-turn verify) + the
 * cap-5 bookkeeping and passes the resolved `outcome` in. `computeGate` only maps
 * (phase, outcome, deploy) → the inline-button set the UI renders and the routes validate
 * `/confirm` against.
 *
 * Each action has the schema `{id, label, kind, route}` (spec §Revision Cleanups + §D):
 *   - kind:"confirm" → the primary advance (POST /confirm)
 *   - kind:"reply"   → focus the composer for a within-phase change (POST /reply)
 *   - kind:"cancel"  → abandon (POST /cancel)
 */
import type { Deploy, Gate, GateAction, Phase, Task } from '../state/task.js';
import type { DifyTargets } from './dify-io.js';

/**
 * A FINISHED build stays fixable — `done` is not the end of the conversation.
 *
 * The human's real acceptance test happens AFTER the build says done: they import the workflow into
 * Dify, run it, and only then find what needs changing. Until now that discovery had nowhere to go —
 * `/reply` refuses a terminal task, so the only route was a NEW edit-existing build (fresh session,
 * empty thread, all four phases re-run) for what is usually a three-line fix.
 *
 * A `done` build reopens iff it can actually be revised IN PLACE:
 *   - an ①②③④ build (a promote/consult has no implement phase to resume),
 *   - parked at ④ (every done build is — import.ts/live-test.ts pin `phase='test'` before finishing),
 *   - with its workflow on disk (project + slug resolved), and
 *   - with an `implement` session to `--resume`. Without one, replyWithin's ④ branch falls through to
 *     re-running the REPORT on an unchanged main.yml — a silent no-op (the 032 bug 041 fixed). In
 *     practice every build that reaches ④ has run ③ as a turn, so this is a fail-safe, not a filter.
 *
 * PURE. The `/reply` route reads it as the authoritative guard; the FE's terminal gate-foot renders its
 * button from the same facts minus `sessionIds` (not on the wire — the impossible case 409s, honestly).
 */
export function canRequestFix(
  task: Pick<Task, 'kind' | 'status' | 'phase' | 'project' | 'workflowSlug' | 'sessionIds'>
): boolean {
  return (
    task.status === 'done' &&
    task.kind !== 'promote' &&
    task.kind !== 'consult' &&
    task.phase === 'test' &&
    !!task.project &&
    !!task.workflowSlug &&
    !!task.sessionIds?.implement
  );
}

/** Verify outcome the orchestrator resolves before gating. `awaiting_import` is the Lát-5 ④ state:
 *  selfhost lint is clean but the import hasn't run yet → present the Import button (AC #16). */
export type GateOutcome =
  | 'success'
  | 'error'
  | 'still_failing'
  | 'awaiting_import'
  // Spec 032 live-test ④ verdicts (produced by runLiveTest, never by the static path):
  | 'test_result' // ran + verified → human confirms/rejects the result (auto hard-stops on fail, B4)
  | 'infra_degraded' // couldn't run for an infra reason → degrade-to-static confirm (D1c)
  // Spec 103 Lane B: a ② REVISE settled — a spec proposal is on disk and `SPEC.md` is untouched.
  // An OUTCOME, not a task field, for the same reason `still_failing` is one: `computeGate` is pure
  // and keyed on phase, so the only honest way to tell it "this ② was a revise" is through the verify.
  | 'spec_proposal'
  // Spec 103 Lane B: the revise found nothing to change. NOT a failure — `spec-revise.md` allows it —
  // so it must not park at a decision gate with an empty decision.
  | 'spec_noop';
export interface GateVerify {
  outcome: GateOutcome;
}

const CONFIRM = (id: string, label: string): GateAction => ({
  id,
  label,
  kind: 'confirm',
  route: '/confirm',
});
const REPLY = (id: string, label: string): GateAction => ({
  id,
  label,
  kind: 'reply',
  route: '/reply',
});
const CANCEL = (id: string, label: string): GateAction => ({
  id,
  label,
  kind: 'cancel',
  route: '/cancel',
});

/** Spec 010 F1: a low-emphasis "discard this build" present on EVERY parked gate so a build paused at
 *  a normal boundary is dismissable from the gate card (not only the still-failing Implement gate). It
 *  hits the same non-destructive POST /cancel as Abandon — `.runs/` + `projects/` stay on disk. Rendered
 *  set apart from the primary Continue (so it can't be fat-fingered). */
const DISCARD = (): GateAction => CANCEL('discard', 'Discard build');

/** The Retry-out-of-error gate — same for every phase (§I: never auto-advances out of error). */
const ERROR_GATE: Gate = { actions: [REPLY('retry', 'Retry phase')] };

/**
 * Compute the gate for a finished phase. Spec 036 D1/D4: `targets` (the reachable Dify live targets,
 * probed by the orchestrator via `difyTargets()`) drives the implement-gate live action — one
 * `test_live` confirm per populated slot (`selfhost` here; `cloud` is a reserved §8 seam). It replaces
 * 032's `liveAvailable` boolean: capability now, not an upfront deploy declaration. Defaults to `{}` so
 * the many 3-arg call sites (error/restore gates) keep compiling — those phases ignore `targets` anyway.
 * `_deploy` is retained positionally for those call sites but no longer read here.
 */
/**
 * Spec 052 — the `kind:'promote'` build's three parked gates (PURE, like {@link computeGate}). The
 * promote flow never enters the phase FSM, so these are computed directly by lib/promote.ts, not by
 * `computeGate`. The action ids are matched string-wise in `promoteConfirm`/`promoteReply`:
 *   - `blocked`        → the B1 eligibility gate failed. Terminal-ish: only Discard (fix the source, re-promote).
 *   - `distill_failed` → the distilled output failed the B2′ re-lint. Request-changes re-runs the turn; Discard.
 *   - `review`         → a clean distill whose slug was already taken, or a distill awaiting the human
 *                        eye. `finalizePromotion` is the ONLY write to templates/patterns/; Request-changes
 *                        re-runs the distill note-steered; Discard sweeps (nothing written). On a slug
 *                        collision at Approve, `reviewCollision` swaps in Overwrite / Save-as-new + Discard.
 *
 * Spec 081 adds the two post-finalize SHARE gates (both /confirm-only — no cancel action, so a
 * "no" never marks the finished promotion `cancelled`):
 *   - `share_offer`  → "push this pattern to the shared repo?" (origin exists + provenance shareable)
 *   - `share_review` → the preflight results (leak scan + near-dup) parked for the contributor's
 *                      explicit confirm — the first human gate; nothing leaves the machine before it.
 *   - `share_retry`  → a failed push re-parked with guidance (same flag as share_review).
 */
export type PromoteGateState =
  | 'blocked' | 'distill_failed' | 'review' | 'reviewCollision'
  | 'share_offer' | 'share_review' | 'share_retry' | 'share_blocked';
export function computePromoteGate(state: PromoteGateState): Gate {
  switch (state) {
    case 'share_offer':
      return {
        actions: [
          CONFIRM('share', 'Share to team shelf'),
          CONFIRM('share_skip', 'Keep local only'),
        ],
        flag: 'promote_share_offer',
      };
    case 'share_review':
      return {
        actions: [
          CONFIRM('share_confirm', 'Push to shared repo'),
          CONFIRM('share_skip', 'Keep local only'),
        ],
        flag: 'promote_share_review',
      };
    case 'share_retry':
      return {
        actions: [
          CONFIRM('share_confirm', 'Try push again'),
          CONFIRM('share_skip', 'Keep local only'),
        ],
        flag: 'promote_share_review',
      };
    case 'share_blocked':
      // spec 084 v1.4 — "Share = Push", BUT a real secret finding is a HARD fuse: no "push anyway" action,
      // only keep-local. The findings are on p.share for the task view. Reuses the share_review flag so the
      // wire contract is unchanged (the tray reads `share.findings` to render the block, not a new flag).
      return {
        actions: [CONFIRM('share_skip', 'Keep local only')],
        flag: 'promote_share_review',
      };
    case 'blocked':
      return { actions: [CANCEL('discard', 'Discard')], flag: 'promote_blocked' };
    case 'distill_failed':
      return {
        actions: [REPLY('changes', 'Request changes'), CANCEL('discard', 'Discard')],
        flag: 'promote_distill_failed',
      };
    case 'review':
      return {
        actions: [
          CONFIRM('approve', 'Approve & promote'),
          REPLY('changes', 'Request changes'),
          CANCEL('discard', 'Discard'),
        ],
        flag: 'promote_review',
      };
    case 'reviewCollision':
      // A pattern already exists at the target slug — never silently clobber (D6). Offer both explicit
      // choices; both stay under the same `promote_review` flag so the review card renders unchanged.
      return {
        actions: [
          CONFIRM('approve_overwrite', 'Overwrite existing'),
          CONFIRM('approve_rename', 'Save as a new pattern'),
          CANCEL('discard', 'Discard'),
        ],
        flag: 'promote_review',
      };
  }
}

export function computeGate(
  phase: Phase,
  verify: GateVerify,
  _deploy: Deploy,
  targets: DifyTargets = {},
  /** Spec 103 Lane B — a proposal is open. Only the error gate reads it (see below). */
  opts: { specRevise?: boolean } = {}
): Gate {
  if (verify.outcome === 'error') {
    // A ② REVISE that died (a usage limit, a network drop) strands the build at phase 'spec' with the
    // draft still open, and the plain error gate offers only Retry / Discard — retry costs another
    // turn, discard throws away the whole build. Neither is "forget the plan, I'm back where I was",
    // which is free and is what a human actually wants after a turn dies. Observed live on task
    // 1787220388060, where the revise turn hit a usage limit.
    if (opts.specRevise) {
      return { actions: [...ERROR_GATE.actions, CONFIRM('drop_spec', 'Never mind')] };
    }
    return { actions: [...ERROR_GATE.actions] };
  }

  switch (phase) {
    case 'analyze':
      return {
        actions: [
          CONFIRM('continue', 'Continue to Spec'),
          REPLY('changes', 'Request changes'),
          DISCARD(), // F1: dismiss a build parked at Analyze
        ],
      };
    case 'spec':
      // Spec 103 Lane B — a revise settled: the human decides on a PROPOSAL, not on a build.
      if (verify.outcome === 'spec_proposal') {
        return {
          actions: [
            CONFIRM('apply_spec', 'Go with this'),
            REPLY('changes', 'Change the plan'),
            // NOT a CANCEL/DISCARD: those end the BUILD. Dropping a proposal must leave the build
            // exactly where it was — `SPEC.md` was never opened, so there is nothing to undo either.
            CONFIRM('drop_spec', 'Never mind'),
          ],
          flag: 'spec_proposal', // maybeAutoAdvance HARD-STOPS on it — `auto` must never self-approve
        };
      }
      // The /confirm that closes Spec is where the scaffold fires (orchestrator Task 5).
      return {
        actions: [
          CONFIRM('continue', 'Implement this spec'),
          REPLY('changes', 'Edit spec'),
          DISCARD(), // F1: dismiss a build parked at Spec
        ],
      };
    case 'implement':
      if (verify.outcome === 'still_failing') {
        // cap-5 reached with lint≠0 — distinct variant; `auto` MUST hard-stop here (§D).
        return {
          actions: [
            CONFIRM('accept', 'Accept anyway'),
            REPLY('keep', 'Keep trying'),
            CANCEL('abandon', 'Abandon'),
          ],
          flag: 'still_failing',
        };
      }
      return {
        actions: [
          CONFIRM('continue', 'Continue to Test'),
          // Spec 036 D4: offer a live "Test with workflow" per reachable target (import → run for real).
          // `continue` (static) stays FIRST — the safe default. `targets.selfhost` is the only live target
          // this spec ships; `targets.cloud` is the reserved §8 seam ('Test with cloud' — NOT emitted here).
          ...(targets.selfhost ? [CONFIRM('test_live', 'Test with workflow')] : []),
          REPLY('changes', 'Request changes'),
          DISCARD(), // F1: dismiss a build parked at a clean Implement
        ],
      };
    case 'test':
      if (verify.outcome === 'still_failing') {
        // ④ re-lint failed and the human did NOT already accept at ③ (spec 014 D2 / C2). Never silently
        // `done`: park for an explicit Accept (finish, tagged `accepted_lint_failure`) or Discard. `auto`
        // HARD-STOPS on the `still_failing` flag — autonomy never ships a lint-failing workflow (AC #25).
        return {
          actions: [
            CONFIRM('accept', 'Accept anyway'),
            REPLY('changes', 'Request changes'), // spec 041: fix the lint-failing workflow (→ re-run Implement)
            DISCARD(),
          ],
          flag: 'still_failing',
        };
      }
      if (verify.outcome === 'awaiting_import') {
        // selfhost ④: lint passed, the workflow is written, but the import to Dify hasn't run. Pause
        // behind an explicit Import button (AC #16). Deploy is ALWAYS a human decision: `auto`/`spec_only`
        // PARK here too (spec 014 D1) — maybeAutoAdvance hard-stops on the `awaiting_import` flag and does
        // NOT auto-confirm the import. 'import' → backend push, 'skip_import' → finish `done` without
        // pushing. A CANCEL/Discard here marks the build `cancelled`, leaving the linted workflow on disk.
        return {
          actions: [
            CONFIRM('import', 'Import to Dify'),
            // Label reads as COMPLETION, not "skip a step": this action finishes the build `done`
            // (the yml is on disk). Users who only want the file were leaving the build parked at
            // this gate because "Skip import" didn't read as "I'm finished". Action id is unchanged.
            CONFIRM('skip_import', 'Finish without importing'),
            REPLY('changes', 'Request changes'), // spec 041: edit the workflow before importing (→ re-run Implement)
            DISCARD(), // F1: dismiss a build parked at the selfhost Import gate (the linted .yml stays on disk)
          ],
          flag: 'awaiting_import',
        };
      }
      if (verify.outcome === 'test_result') {
        // Spec 032 §5 — the live-test verdict gate: the workflow ran + was verified; the human confirms
        // or iterates. `auto` HARD-STOPS here (flag `test_result`) — it only reaches this gate on a
        // fail/subjective result (a clean auto pass finishes in runLiveTest without parking). Actions:
        // accept→done · changes→/reply fix · test_live→re-import & re-run the fix · discard.
        return {
          actions: [
            CONFIRM('accept', 'Accept result'),
            REPLY('changes', 'Request changes'),
            CONFIRM('test_live', 'Re-test'),
            CONFIRM('cleanup_apps', 'Delete test apps'), // S6 — FE shows it only when testApps>0
            DISCARD(),
          ],
          flag: 'test_result',
        };
      }
      if (verify.outcome === 'infra_degraded') {
        // Spec 032 D1c — live couldn't run for an INFRA reason (Dify down / 0 model / API error), NOT a
        // workflow fault. The static lint result stands (PASS); offer to retry live or accept the static
        // result. `auto` HARD-STOPS (flag `infra_degraded`) rather than silently finishing.
        return {
          actions: [
            CONFIRM('retry_live', 'Retry live'),
            CONFIRM('accept_static', 'Accept static'),
            REPLY('changes', 'Request changes'), // spec 041: fix the workflow even though live couldn't run (→ re-run Implement)
            CONFIRM('cleanup_apps', 'Delete test apps'), // S6 — FE shows it only when testApps>0
            DISCARD(),
          ],
          flag: 'infra_degraded',
        };
      }
      // ④ success with deploy=none|cloud (or a completed selfhost import) is terminal — no actions.
      return { actions: [] };
  }
}

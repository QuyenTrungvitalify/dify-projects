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
import type { Deploy, Gate, GateAction, Phase } from '../state/task.js';

/** Verify outcome the orchestrator resolves before gating. `awaiting_import` is the Lát-5 ④ state:
 *  selfhost lint is clean but the import hasn't run yet → present the Import button (AC #16). */
export type GateOutcome =
  | 'success'
  | 'error'
  | 'still_failing'
  | 'awaiting_import'
  // Spec 032 live-test ④ verdicts (produced by runLiveTest, never by the static path):
  | 'test_result' // ran + verified → human confirms/rejects the result (auto hard-stops on fail, B4)
  | 'infra_degraded'; // couldn't run for an infra reason → degrade-to-static confirm (D1c)
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
 * Compute the gate for a finished phase. `deploy` drives the Lát-5 ④ `selfhost` Import button:
 * a clean selfhost ④ pauses at `awaiting_import` with an Import action (AC #16); `none`/`cloud`
 * ④-success is terminal with no actions.
 */
export function computeGate(phase: Phase, verify: GateVerify, _deploy: Deploy, liveAvailable = false): Gate {
  if (verify.outcome === 'error') return { actions: [...ERROR_GATE.actions] };

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
          // Spec 032 D1(a): when live is available (deploy=selfhost + creds), offer a second confirm to
          // run the workflow for real. `continue` stays FIRST (the safe static default); auto+live picks
          // `test_live` in maybeAutoAdvance by testMode, not by order.
          ...(liveAvailable ? [CONFIRM('test_live', 'Test với workflow')] : []),
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
            CONFIRM('skip_import', 'Skip import'),
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
            DISCARD(),
          ],
          flag: 'infra_degraded',
        };
      }
      // ④ success with deploy=none|cloud (or a completed selfhost import) is terminal — no actions.
      return { actions: [] };
  }
}

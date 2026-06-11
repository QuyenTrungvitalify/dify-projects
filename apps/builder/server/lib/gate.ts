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
export type GateOutcome = 'success' | 'error' | 'still_failing' | 'awaiting_import';
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

/** The Retry-out-of-error gate — same for every phase (§I: never auto-advances out of error). */
const ERROR_GATE: Gate = { actions: [REPLY('retry', 'Retry phase')] };

/**
 * Compute the gate for a finished phase. `deploy` drives the Lát-5 ④ `selfhost` Import button:
 * a clean selfhost ④ pauses at `awaiting_import` with an Import action (AC #16); `none`/`cloud`
 * ④-success is terminal with no actions.
 */
export function computeGate(phase: Phase, verify: GateVerify, _deploy: Deploy): Gate {
  if (verify.outcome === 'error') return { actions: [...ERROR_GATE.actions] };

  switch (phase) {
    case 'analyze':
      return {
        actions: [
          CONFIRM('continue', 'Continue to Spec'),
          REPLY('changes', 'Request changes'),
        ],
      };
    case 'spec':
      // The /confirm that closes Spec is where the scaffold fires (orchestrator Task 5).
      return {
        actions: [
          CONFIRM('continue', 'Implement this spec'),
          REPLY('changes', 'Edit spec'),
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
          REPLY('changes', 'Request changes'),
        ],
      };
    case 'test':
      if (verify.outcome === 'awaiting_import') {
        // selfhost ④: lint passed, the workflow is written, but the import to Dify hasn't run.
        // Pause behind an explicit Import button (AC #16); `/confirm import` runs the backend push.
        // `auto` auto-confirms this exactly like any other confirm gate (the duplicate-app footgun
        // for auto+selfhost+edit-existing is surfaced as a report warning, not blocked here).
        // Both are `confirm` (route /confirm): 'import' → backend push, 'skip_import' → finish `done`
        // without pushing. `auto`/`spec_only` auto-confirm the FIRST confirm action ('import'). A
        // CANCEL here would instead mark the whole build `cancelled`, discarding the linted workflow.
        return {
          actions: [
            CONFIRM('import', 'Import to Dify'),
            CONFIRM('skip_import', 'Skip import'),
          ],
          flag: 'awaiting_import',
        };
      }
      // ④ success with deploy=none|cloud (or a completed selfhost import) is terminal — no actions.
      return { actions: [] };
  }
}

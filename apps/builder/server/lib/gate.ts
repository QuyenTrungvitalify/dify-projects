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
import type { Gate, GateAction, Phase } from '../state/task.js';

/** Verify outcome the orchestrator resolves before gating (drives clean vs still-failing vs error). */
export type GateOutcome = 'success' | 'error' | 'still_failing';
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
 * Compute the gate for a finished phase. `deploy` is reserved for the Lát-5 ④ `selfhost`
 * Import button; here (`deploy=none`) ④-success is terminal with no actions.
 */
export function computeGate(phase: Phase, verify: GateVerify, _deploy: 'none'): Gate {
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
      // ④ success with deploy=none is terminal — no actions (the selfhost Import button is Lát 5).
      return { actions: [] };
  }
}

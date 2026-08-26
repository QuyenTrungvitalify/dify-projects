/**
 * A promote build's `/reply` is validated against its own gate, so the gate's reply action is not a
 * button — it is the permission slip.
 *
 * `POST /api/tasks/:id/reply` refuses a promote build whose gate carries no `kind:'reply'` action
 * (spec 052: the `promote_blocked` gate has none, and a crafted POST must not spawn a distill turn on
 * an ineligible source). Two gates DO carry one — `review` and `distill_failed` — and they are the only
 * reply actions promote has anywhere. Delete them and every message typed into a promote build 409s:
 * the composer there has no ✎ pill to fall back on (`askableGate` excludes `kind:'promote'`), so its
 * single send button becomes the only door, and that door closes too.
 *
 * This file exists because that failure is SILENT to the suite: `test/promote.test.ts` calls
 * `promoteReply` directly, and `promote.ts`'s own guard reads `gate.flag`, not the action list. Both
 * stay green while the route refuses everything.
 *
 * The buttons themselves are no longer drawn on the card (`replyButtonKind` → 'hidden'). That is a
 * render decision and it belongs in the FE; this contract is why the ACTION must stay on the wire.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computePromoteGate } from '../server/lib/gate.js';

describe('052 · a promote gate that accepts a reply must say so in its actions', () => {
  for (const state of ['review', 'distill_failed'] as const) {
    test(`${state} carries a reply action — the route reads this list, not a flag`, () => {
      const g = computePromoteGate(state);
      assert.ok(
        g.actions.some((a) => a.kind === 'reply'),
        'without it POST /reply 409s every message on this build, and promote has no other reply action'
      );
    });
  }

  test('promote_blocked deliberately carries none — that is the guard working', () => {
    // B1: ineligible source → no turn was run and nothing was written. A reply here would spawn a
    // distill turn on it. The absence is the point, which is why the check above is per-gate.
    assert.equal(computePromoteGate('blocked').actions.some((a) => a.kind === 'reply'), false);
  });
});

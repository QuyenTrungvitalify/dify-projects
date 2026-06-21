/**
 * restoreTargetPhase — the /restore rewind target. A cancelled build reopens at the PREVIOUS phase's
 * gate (undo the Continue that advanced too far); that phase provably completed + was gated, so
 * re-parking there is always valid. `analyze` is first → null (caller reopens as a retryable error).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { restoreTargetPhase, PHASE_ORDER } from '../server/state/task.js';
import type { Phase } from '../server/state/task.js';

describe('restoreTargetPhase', () => {
  test('rewinds one boundary back', () => {
    assert.equal(restoreTargetPhase('spec'), 'analyze');
    assert.equal(restoreTargetPhase('implement'), 'spec'); // the common case: cancelled mid-implement
    assert.equal(restoreTargetPhase('test'), 'implement');
  });

  test('analyze has no prior gate → null', () => {
    assert.equal(restoreTargetPhase('analyze'), null);
  });

  test('every non-first phase rewinds to the immediately preceding phase', () => {
    for (let i = 1; i < PHASE_ORDER.length; i++) {
      assert.equal(restoreTargetPhase(PHASE_ORDER[i] as Phase), PHASE_ORDER[i - 1]);
    }
  });
});

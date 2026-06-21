/**
 * T4 — boundaryAutoAdvances (the Confirm-mode auto-advance predicate). The fail-safe direction is
 * the load-bearing property: anything that is not a recognized auto-advancing mode must PAUSE, so a
 * stale/corrupt persisted `confirmMode` can never silently kick off an autonomous run (§D / AC #25).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boundaryAutoAdvances } from '../server/lib/orchestrator.js';
import type { Phase } from '../server/state/task.js';

const PHASES: Phase[] = ['analyze', 'spec', 'implement', 'test'];

describe('boundaryAutoAdvances', () => {
  test('auto → advances at every boundary', () => {
    for (const p of PHASES) assert.equal(boundaryAutoAdvances('auto', p), true);
  });

  test('spec_only → pauses ONLY at the spec boundary', () => {
    assert.equal(boundaryAutoAdvances('spec_only', 'spec'), false);
    for (const p of ['analyze', 'implement', 'test'] as Phase[]) {
      assert.equal(boundaryAutoAdvances('spec_only', p), true);
    }
  });

  test('each_step → never auto-advances', () => {
    for (const p of PHASES) assert.equal(boundaryAutoAdvances('each_step', p), false);
  });

  test('unknown / corrupt mode → never auto-advances (fail-safe toward pausing)', () => {
    for (const p of PHASES) {
      // values that can reach this from a reconciled task.json with a stale/null field
      assert.equal(boundaryAutoAdvances(null as never, p), false);
      assert.equal(boundaryAutoAdvances(undefined as never, p), false);
      assert.equal(boundaryAutoAdvances('AUTO' as never, p), false);
      assert.equal(boundaryAutoAdvances('weird' as never, p), false);
    }
  });
});

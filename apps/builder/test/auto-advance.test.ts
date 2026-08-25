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

  test('spec 105 — on a build that starts at ③, the one stop slides down to ③', () => {
    // `spec_only` promises exactly ONE stop. A build editing an already-specced workflow has no ② to
    // make it at, so the mode used to collapse into `auto`: the user picked 「仕様だけ確認」 and got an
    // unattended run all the way through ④, on a workflow that already existed and already worked.
    assert.equal(boundaryAutoAdvances('spec_only', 'implement', 'implement'), false, 'the one stop');
    for (const p of ['analyze', 'spec', 'test'] as Phase[]) {
      assert.equal(boundaryAutoAdvances('spec_only', p, 'implement'), true, 'and only the one');
    }
    // The other two modes mean the same thing whatever the build skipped.
    for (const p of PHASES) {
      assert.equal(boundaryAutoAdvances('auto', p, 'implement'), true);
      assert.equal(boundaryAutoAdvances('each_step', p, 'implement'), false);
    }
    // An ordinary build is untouched, whether the field is absent or explicitly ①.
    assert.equal(boundaryAutoAdvances('spec_only', 'spec', undefined), false);
    assert.equal(boundaryAutoAdvances('spec_only', 'implement', undefined), true);
    assert.equal(boundaryAutoAdvances('spec_only', 'implement', 'analyze' as never), true);
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

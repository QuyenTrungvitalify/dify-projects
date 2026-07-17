/**
 * Spec 062 AC #3 — the ANTI-DRIFT pin. The dossier duplicates the spec-059 cost classifier server-side
 * (lib/cost-cause.ts) because summary.md is generated offline and can't call the FE `web/src/lib/dev.ts`.
 * This test feeds the SAME vectors as `web/src/lib/dev.test.ts` and asserts identical results, so a
 * change to the 059 rules on one copy that isn't mirrored on the other fails the build. If you touch
 * either classifier, update BOTH test files in lock-step.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cachePct, classify, shares, diagnose } from '../server/lib/cost-cause.js';

describe('cachePct (mirror of dev.test.ts)', () => {
  test('cacheRead / (cacheRead + input), rounded', () => {
    assert.equal(cachePct({ cacheReadTokens: 30000, inputTokens: 10000 }), 75);
    assert.equal(cachePct({ cacheReadTokens: 322092, inputTokens: 3993 }), 99);
    assert.equal(cachePct({ cacheReadTokens: 0, inputTokens: 5000 }), 0);
  });
  test('null when nothing to divide', () => {
    assert.equal(cachePct({}), null);
    assert.equal(cachePct(undefined), null);
    assert.equal(cachePct({ numTurns: 3 }), null);
  });
  test('treats a missing side as 0', () => {
    assert.equal(cachePct({ cacheReadTokens: 100 }), 100);
    assert.equal(cachePct({ inputTokens: 100 }), 0);
  });
});

describe('classify (mirror of dev.test.ts — per-phase cause)', () => {
  test('rule order: cold-start ▸ tool-loop ▸ generation ▸ inconclusive', () => {
    assert.equal(classify({ numTurns: 20, cacheReadTokens: 5000, inputTokens: 95000 }), 'cold-start');
    assert.equal(classify({ numTurns: 19, cacheReadTokens: 329745, inputTokens: 988 }), 'tool-loop');
    assert.equal(classify({ numTurns: 3, outputTokens: 22000, cacheReadTokens: 400000, inputTokens: 100 }), 'generation');
    assert.equal(classify({ numTurns: 2, outputTokens: 400, cacheReadTokens: 100000, inputTokens: 100 }), 'inconclusive');
    assert.equal(classify(undefined), 'inconclusive');
  });
  test('every row of this run classifies tool-loop (cache ~99%, turns ≥ 8)', () => {
    assert.equal(classify({ numTurns: 15, cacheReadTokens: 234847, inputTokens: 4136 }), 'tool-loop');
    assert.equal(classify({ numTurns: 19, cacheReadTokens: 329745, inputTokens: 988 }), 'tool-loop');
    assert.equal(classify({ numTurns: 13, cacheReadTokens: 161851, inputTokens: 3819 }), 'tool-loop');
  });
});

describe('shares + diagnose (mirror of dev.test.ts)', () => {
  test('balanced light build (31/36/33%) → balanced, top ② spec, all tool-loop', () => {
    const d = diagnose({
      analyze: { durationMs: 110698, numTurns: 17, inputTokens: 4140, outputTokens: 5666, cacheReadTokens: 305896 },
      spec: { durationMs: 128110, numTurns: 16, inputTokens: 3891, outputTokens: 6243, cacheReadTokens: 213090 },
      implement: { durationMs: 118789, numTurns: 20, inputTokens: 4339, outputTokens: 6421, cacheReadTokens: 431284 },
    });
    assert.equal(d?.balanced, true);
    assert.equal(d?.phase, 'spec');
    assert.equal(d?.sharePct, 36);
    assert.equal(d?.allSameCause, 'tool-loop');
    assert.equal(d?.lever, 'gather ≥3 runs before targeting a phase');
  });

  test('one phase clearly dominates (≥40%) → NOT balanced, points at it', () => {
    const d = diagnose({
      analyze: { durationMs: 30000, numTurns: 6, inputTokens: 4000, outputTokens: 5000, cacheReadTokens: 300000 },
      spec: { durationMs: 20000, numTurns: 5, inputTokens: 4000, outputTokens: 5000, cacheReadTokens: 300000 },
      implement: { durationMs: 120000, numTurns: 20, inputTokens: 4000, outputTokens: 6000, cacheReadTokens: 400000 },
    });
    assert.equal(d?.balanced, false);
    assert.equal(d?.phase, 'implement');
    assert.notEqual(d?.lever, 'gather ≥3 runs before targeting a phase');
  });

  test('low cache% on the slowest phase → cold-start (wins over turn rule)', () => {
    const d = diagnose({
      implement: { durationMs: 200000, numTurns: 20, inputTokens: 90000, outputTokens: 8000, cacheReadTokens: 5000 },
    });
    assert.equal(d?.cause, 'cold-start');
    assert.equal(d?.detail, 'cache 5%');
    assert.equal(d?.balanced, false);
  });

  test('shares(): each phase % of total durationMs; empty when no durations', () => {
    assert.deepEqual(
      shares({ analyze: { durationMs: 110698 }, spec: { durationMs: 128110 }, implement: { durationMs: 118789 } }),
      { analyze: 31, spec: 36, implement: 33 }
    );
    assert.deepEqual(shares({ implement: { numTurns: 5 } }), {});
    assert.deepEqual(shares(undefined), {});
  });

  test('few turns + big output + good cache → generation', () => {
    const d = diagnose({
      implement: { durationMs: 90000, numTurns: 3, inputTokens: 4000, outputTokens: 22000, cacheReadTokens: 400000 },
    });
    assert.equal(d?.cause, 'generation');
    assert.equal(d?.detail, '22.0k out tok');
  });

  test('no cost at all → null', () => {
    assert.equal(diagnose(undefined), null);
    assert.equal(diagnose({}), null);
  });

  test('falls back to biggest-output when no durations recorded', () => {
    const d = diagnose({
      analyze: { numTurns: 2, outputTokens: 400, cacheReadTokens: 100000, inputTokens: 100 },
      implement: { numTurns: 12, outputTokens: 9000, cacheReadTokens: 100000, inputTokens: 100 },
    });
    assert.equal(d?.phase, 'implement');
    assert.equal(d?.sharePct, null);
    assert.equal(d?.cause, 'tool-loop');
  });
});

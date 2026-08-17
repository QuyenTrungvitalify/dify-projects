/* spec 059 — dev-panel pure helpers. `cachePct` = cacheRead/(cacheRead+input) with a null guard so a
   phase with no token data renders `—` not a misleading 0%; `fmt` rounds or `—`. (`devMode` reads the
   URL/localStorage at import — jsdom provides both here; it is exercised implicitly, not asserted.) */
import { describe, it, expect } from 'vitest';
import { cachePct, fmt, diagnose, classify, shares, askCostLine, shortModel } from './dev';

describe('cachePct (spec 059)', () => {
  it('cacheRead / (cacheRead + input), rounded', () => {
    expect(cachePct({ cacheReadTokens: 30000, inputTokens: 10000 })).toBe(75);
    expect(cachePct({ cacheReadTokens: 322092, inputTokens: 3993 })).toBe(99);
    expect(cachePct({ cacheReadTokens: 0, inputTokens: 5000 })).toBe(0);
  });
  it('null when nothing to divide (no misleading 0%)', () => {
    expect(cachePct({})).toBeNull();
    expect(cachePct(undefined)).toBeNull();
    expect(cachePct({ numTurns: 3 })).toBeNull();
  });
  it('treats a missing side as 0', () => {
    expect(cachePct({ cacheReadTokens: 100 })).toBe(100); // input unknown → 100/(100+0)
    expect(cachePct({ inputTokens: 100 })).toBe(0); // cacheRead unknown → 0/(0+100)
  });
});

describe('classify (spec 059 — per-phase cause, the table column)', () => {
  it('rule order: cold-start ▸ tool-loop ▸ generation ▸ inconclusive', () => {
    // low cache wins even with many turns
    expect(classify({ numTurns: 20, cacheReadTokens: 5000, inputTokens: 95000 })).toBe('cold-start');
    // healthy cache + many turns → tool-loop
    expect(classify({ numTurns: 19, cacheReadTokens: 329745, inputTokens: 988 })).toBe('tool-loop');
    // healthy cache + few turns + big output → generation
    expect(classify({ numTurns: 3, outputTokens: 22000, cacheReadTokens: 400000, inputTokens: 100 })).toBe('generation');
    // healthy cache + few turns + small output → inconclusive
    expect(classify({ numTurns: 2, outputTokens: 400, cacheReadTokens: 100000, inputTokens: 100 })).toBe('inconclusive');
    expect(classify(undefined)).toBe('inconclusive');
  });
  it('every row of this run classifies tool-loop (cache ~99%, turns ≥ 8)', () => {
    expect(classify({ numTurns: 15, cacheReadTokens: 234847, inputTokens: 4136 })).toBe('tool-loop');
    expect(classify({ numTurns: 19, cacheReadTokens: 329745, inputTokens: 988 })).toBe('tool-loop');
    expect(classify({ numTurns: 13, cacheReadTokens: 161851, inputTokens: 3819 })).toBe('tool-loop');
  });
});

describe('diagnose (spec 059 S3 — the cause-analysis)', () => {
  it('balanced light build (30/35/33%) → balanced, top ② spec, all tool-loop', () => {
    // Real cost of run 1784128896068 — no phase dominates; spec is slowest by TIME (128s) yet has the
    // FEWEST turns (16), so singling it out with a "fewer turns" lever would over-claim → balanced.
    const d = diagnose({
      analyze: { durationMs: 110698, numTurns: 17, inputTokens: 4140, outputTokens: 5666, cacheReadTokens: 305896 },
      spec: { durationMs: 128110, numTurns: 16, inputTokens: 3891, outputTokens: 6243, cacheReadTokens: 213090 },
      implement: { durationMs: 118789, numTurns: 20, inputTokens: 4339, outputTokens: 6421, cacheReadTokens: 431284 },
    });
    expect(d?.balanced).toBe(true);
    expect(d?.phase).toBe('spec'); // still the slowest by time
    expect(d?.sharePct).toBe(36); // 128110 / 357597 = 35.8% → 36 (matches the panel HINT)
    expect(d?.allSameCause).toBe('tool-loop');
    expect(d?.lever).toBe('gather ≥3 runs before targeting a phase');
  });

  it('one phase clearly dominates (≥40% share) → NOT balanced, points at it', () => {
    const d = diagnose({
      analyze: { durationMs: 30000, numTurns: 6, inputTokens: 4000, outputTokens: 5000, cacheReadTokens: 300000 },
      spec: { durationMs: 20000, numTurns: 5, inputTokens: 4000, outputTokens: 5000, cacheReadTokens: 300000 },
      implement: { durationMs: 120000, numTurns: 20, inputTokens: 4000, outputTokens: 6000, cacheReadTokens: 400000 },
    });
    expect(d?.balanced).toBe(false); // implement is ~71%
    expect(d?.phase).toBe('implement');
    expect(d?.lever).not.toBe('gather ≥3 runs before targeting a phase');
  });

  it('low cache% on the slowest phase → cold-start (wins over the turn rule)', () => {
    const d = diagnose({
      implement: { durationMs: 200000, numTurns: 20, inputTokens: 90000, outputTokens: 8000, cacheReadTokens: 5000 },
    });
    expect(d?.cause).toBe('cold-start');
    expect(d?.detail).toBe('cache 5%'); // 5000/95000 ≈ 5%
    expect(d?.balanced).toBe(false); // single phase → nothing to compare
  });

  it('shares(): each phase % of total durationMs; empty when no durations', () => {
    expect(shares({
      analyze: { durationMs: 110698 }, spec: { durationMs: 128110 }, implement: { durationMs: 118789 },
    })).toEqual({ analyze: 31, spec: 36, implement: 33 });
    expect(shares({ implement: { numTurns: 5 } })).toEqual({}); // no durationMs → unknowable
    expect(shares(undefined)).toEqual({});
  });

  it('few turns + big output + good cache → generation', () => {
    const d = diagnose({
      implement: { durationMs: 90000, numTurns: 3, inputTokens: 4000, outputTokens: 22000, cacheReadTokens: 400000 },
    });
    expect(d?.cause).toBe('generation');
    expect(d?.detail).toBe('22.0k out tok');
  });

  it('no cost at all → null', () => {
    expect(diagnose(undefined)).toBeNull();
    expect(diagnose({})).toBeNull();
  });

  it('falls back to biggest-output when no durations recorded', () => {
    const d = diagnose({
      analyze: { numTurns: 2, outputTokens: 400, cacheReadTokens: 100000, inputTokens: 100 },
      implement: { numTurns: 12, outputTokens: 9000, cacheReadTokens: 100000, inputTokens: 100 },
    });
    expect(d?.phase).toBe('implement');
    expect(d?.sharePct).toBeNull(); // no durationMs → share unknown
    expect(d?.cause).toBe('tool-loop'); // 12 turns
  });
});

describe('fmt (spec 059)', () => {
  it('rounds finite numbers', () => {
    expect(fmt(5138)).toBe('5138');
    expect(fmt(12.7)).toBe('13');
    expect(fmt(0)).toBe('0');
  });
  it('— for missing / non-finite', () => {
    expect(fmt(undefined)).toBe('—');
    expect(fmt(NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('—');
  });
});

/* The per-answer dev tip. It is a READ-OUT, so the bar is: never invent a number, never render a line
   made of dashes, and never make the reader parse a 6-digit token count at a glance. */
describe('askCostLine — the dev tip under an answer', () => {
  it('reads model, tokens, cache, turns, duration and price in one line', () => {
    expect(
      askCostLine({
        model: 'claude-opus-4-5-20260101',
        inputTokens: 4000,
        outputTokens: 842,
        cacheReadTokens: 36000,
        cacheCreationTokens: 1200,
        numTurns: 3,
        durationMs: 47200,
        totalCostUsd: 0.2134,
      }),
    ).toBe('opus-4-5 · in 4.0k · cache 36.0k read (90%) · 1.2k written · out 842 · 3 turns · 47.2s · $0.213');
  });

  it('renders only what the turn actually reported', () => {
    expect(askCostLine({ outputTokens: 120 })).toBe('out 120');
    // ONE turn is one turn. The plural read as a typo on the most common line of all.
    expect(askCostLine({ numTurns: 1 })).toBe('1 turn');
    expect(askCostLine({ numTurns: 4 })).toBe('4 turns');
    // Fresh vs cached input stay apart: on a real ask these were 2 and 36k, and showing only the 2
    // said the answer was nearly free while the price said $0.158.
    expect(askCostLine({ inputTokens: 2, cacheReadTokens: 36_000 })).toBe('in 2 · cache 36.0k read (100%)');
    // Cache WRITE is billed at 1.25x — the priciest part of a prompt. Leaving it out made the tip unable
    // to account for its own price line (measured: $0.053 of the $0.099 it printed).
    expect(askCostLine({ inputTokens: 2, cacheReadTokens: 15_600, cacheCreationTokens: 2_450, outputTokens: 393 }))
      .toBe('in 2 · cache 15.6k read (100%) · 2.5k written · out 393');
    expect(askCostLine({ model: 'claude-haiku-4-5-20251001' })).toBe('haiku-4-5');
  });

  // A turn that was killed has no result event, so `costFromResult` returns null and no `cost` rides on
  // `ask:done`. Nothing to show is shown as nothing — a tip of em-dashes tells the reader less than none.
  it('a fresh session is marked, so the cheap row can be connected to the reset that caused it', () => {
    expect(askCostLine({ outputTokens: 120 }, true)).toBe('out 120 · fresh session ↺');
    expect(askCostLine({ outputTokens: 120 }, false)).toBe('out 120');
    // …but a marker with no measurement behind it is still no line at all
    expect(askCostLine(undefined, true)).toBeNull();
    expect(askCostLine({}, true)).toBeNull();
  });

  it('is null when there is nothing to say', () => {
    expect(askCostLine(undefined)).toBeNull();
    expect(askCostLine({})).toBeNull();
    expect(askCostLine({ at: 1786680000000 })).toBeNull(); // a timestamp is not a measurement
  });

  it('shortens a model id to the family a reader scans for', () => {
    expect(shortModel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5');
    expect(shortModel('us.anthropic.claude-opus-4-8')).toBe('opus-4-8');
    expect(shortModel(undefined)).toBeNull();
  });
});

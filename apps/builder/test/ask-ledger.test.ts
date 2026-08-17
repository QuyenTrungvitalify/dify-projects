/**
 * The ask ledger — the artifact that makes "is the optimisation still working?" answerable by READING.
 *
 * Spec 098's evidence was one measurement on one machine on one day. The size fence in the suite keeps a
 * FIXTURE honest; nothing kept REAL USE honest, and a seed grows back one `add(...)` at a time. The
 * ledger renders what each real answer recorded — the prompt it was sent, and what the turn cost — so a
 * regression shows up in an exported bundle instead of in a quota.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildAskLedger, SEED_FENCE_BYTES } from '../server/lib/ask-ledger.js';
import type { ConsultChatLine } from '../server/lib/ask.js';

/** One recorded exchange, shaped exactly as `recordAsk` writes it. */
function pair(q: string, promptBytes: number, usd: number, extra: Partial<ConsultChatLine['cost']> = {}): ConsultChatLine[] {
  return [
    { role: 'user', text: q, at: 1 },
    {
      role: 'assistant', text: 'an answer', at: 2, promptBytes,
      cost: { totalCostUsd: usd, model: 'claude-opus-5', inputTokens: 2, cacheReadTokens: 15_600,
              cacheCreationTokens: 8100, outputTokens: 508, numTurns: 1, durationMs: 41_400, ...extra },
    },
  ] as ConsultChatLine[];
}

describe('ask ledger', () => {
  test('renders one row per exchange, with the prompt size leading', () => {
    const md = buildAskLedger([...pair('how many nodes?', 5400, 0.103), ...pair('which URL?', 5600, 0.09)])!;
    assert.match(md, /# Ask ledger — 2 questions/);
    assert.match(md, /5\.3 KB/);
    assert.match(md, /opus-5/);
    assert.match(md, /how many nodes\?/, 'the question is quoted so a row can be recognised');
    assert.match(md, /\$0\.103/);
  });

  test('a prompt over the fence is flagged on its row AND in the verdict', () => {
    const md = buildAskLedger([...pair('small', 5000, 0.1), ...pair('huge', 143_000, 0.9)])!;
    assert.match(md, /139\.6 KB ⚠/, 'the offending row is marked');
    assert.match(md, /\*\*1 over it\*\* ⚠/, 'and counted in the verdict, not left for the reader to spot');
    assert.ok(SEED_FENCE_BYTES === 16 * 1024);
  });

  test('all-within-fence reads as a pass', () => {
    const md = buildAskLedger([...pair('a', 5000, 0.1), ...pair('b', 6000, 0.1)])!;
    assert.match(md, /2 of 2 within the 16\.0 KB fence ✅/);
    assert.ok(!md.includes('⚠'), 'no warning glyph anywhere when nothing is wrong');
  });

  // The failure spec 098 fixed was a CURVE: ask #1 cost 74.6k tokens, ask #16 cost 840k. A ledger that
  // shows only a total would have called that healthy.
  test('a climbing cost curve is named, a flat one is reassured', () => {
    const climbing = buildAskLedger([
      ...pair('a', 5000, 0.05), ...pair('b', 5000, 0.20), ...pair('c', 5000, 0.60),
    ])!;
    assert.match(climbing, /A climbing curve is exactly the failure/);

    const flat = buildAskLedger([
      ...pair('a', 5000, 0.11), ...pair('b', 5000, 0.10), ...pair('c', 5000, 0.09),
    ])!;
    assert.match(flat, /Flat or falling/);
  });

  test('an old transcript says it has no sizes rather than showing dashes as data', () => {
    const md = buildAskLedger([
      { role: 'user', text: 'q', at: 1 },
      { role: 'assistant', text: 'a', at: 2 },
    ] as ConsultChatLine[])!;
    assert.match(md, /predates the ledger/);
    assert.ok(!md.includes('median'), 'no statistic is invented from nothing');
  });

  test('nothing recorded ⇒ no ledger at all (not an empty table implying "free")', () => {
    assert.equal(buildAskLedger([]), null);
    assert.equal(buildAskLedger([{ role: 'user', text: 'q', at: 1 }] as ConsultChatLine[]), null);
  });
});

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
function pair(q: string, promptBytes: number, usd: number, extra: Partial<ConsultChatLine['cost']> = {},
              contextBytes: number = Math.min(promptBytes, 5_000)): ConsultChatLine[] {
  return [
    { role: 'user', text: q, at: 1 },
    {
      role: 'assistant', text: 'an answer', at: 2, promptBytes, contextBytes,
      cost: { totalCostUsd: usd, model: 'claude-opus-5', inputTokens: 2, cacheReadTokens: 15_600,
              cacheCreationTokens: 8100, outputTokens: 508, numTurns: 1, durationMs: 41_400, ...extra },
    },
  ] as ConsultChatLine[];
}

describe('ask ledger', () => {
  test('renders one row per exchange, with the prompt size leading', () => {
    const md = buildAskLedger([...pair('how many nodes?', 5400, 0.103), ...pair('which URL?', 5600, 0.09)])!;
    assert.match(md, /# Ask ledger — 2 questions/);
    assert.ok(!md.includes('spec 098'), 'a reader months from now cannot open a deleted spec — state the fact instead');
    assert.match(md, /5\.3 KB/);
    assert.match(md, /opus-5/);
    assert.match(md, /how many nodes\?/, 'the question is quoted so a row can be recognised');
    assert.match(md, /\$0\.103/);
  });

  test('the ARTIFACT context is what the fence judges — a long requirement is not a regression', () => {
    // The case a real QA run produced: 21 KB prompt, of which 11 KB is the user's own requirement.
    // Fencing the whole prompt called that a regression; it was the optimisation working perfectly.
    const md = buildAskLedger(pair('a real build', 21_000, 0.5, {}, 4_200))!;
    assert.match(md, /1 of 1 within the 16\.0 KB fence ✅/, 'judged on the 4.2 KB it controls');
    assert.ok(!md.includes('⚠'), 'and NOT condemned for the 21 KB it does not');
    assert.match(md, /neither of which this app may shorten/, 'the difference is explained, not hidden');
  });

  test('an artifact context over the fence is flagged on its row AND in the verdict', () => {
    const md = buildAskLedger([...pair('small', 6000, 0.1, {}, 5_000),
                               ...pair('huge', 150_000, 0.9, {}, 143_000)])!;
    assert.match(md, /139\.6 KB ⚠/, 'the offending row is marked');
    assert.match(md, /\*\*1 over it\*\* ⚠/, 'and counted in the verdict, not left for the reader to spot');
    assert.ok(SEED_FENCE_BYTES === 16 * 1024);
  });

  test('all-within-fence reads as a pass', () => {
    const md = buildAskLedger([...pair('a', 5000, 0.1), ...pair('b', 6000, 0.1)])!;
    assert.match(md, /2 of 2 within the 16\.0 KB fence ✅/);
    assert.ok(!md.includes('⚠'), 'no warning glyph anywhere when nothing is wrong');
  });

  /* The second thing the QA run exposed: an $8.86 one-line question, 883.7k tokens written to cache.
     A ledger that only fences the seed would have said "✅" and left the reader none the wiser. */
  test('a huge cache WRITE is named as the real cost driver, not left under a green tick', () => {
    const md = buildAskLedger(pair('cheap question', 21_000, 8.861, { cacheCreationTokens: 883_700 }, 4_200))!;
    assert.match(md, /within the 16\.0 KB fence ✅/, 'the seed verdict still stands');
    assert.match(md, /Where the money went/, '…but it is not the whole story, and the ledger says so');
    assert.match(md, /883\.7k/);
    assert.match(md, /resetting the ask session is the lever/);
  });

  test('an ordinary cache write is not dramatised', () => {
    const md = buildAskLedger(pair('q', 6000, 0.1, { cacheCreationTokens: 8_000 }))!;
    assert.ok(!md.includes('Where the money went'));
  });

  // The failure spec 098 fixed was a CURVE: ask #1 cost 74.6k tokens, ask #16 cost 840k. A ledger that
  // shows only a total would have called that healthy.
  test('a climbing cost curve is named, a flat one is reassured', () => {
    const climbing = buildAskLedger([
      ...pair('a', 5000, 0.05), ...pair('b', 5000, 0.20), ...pair('c', 5000, 0.60),
    ])!;
    assert.match(climbing, /A climbing curve is the failure this ledger exists to catch/);

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

  /* The ledger diagnosed the bill; it must also show the fix operating, or the next reader cannot tell
     whether the cheap rows are cheap by luck. */
  test('a reset row is marked ↺ and the verdict points at the row before it', () => {
    const expensive = pair('the last one on the old session', 21_000, 8.861, { cacheCreationTokens: 883_700 }, 4_200);
    const fresh = pair('the first one after the reset', 21_000, 0.05, { cacheReadTokens: 15_600 }, 4_200);
    (fresh[1] as { sessionReset?: true }).sessionReset = true;
    const md = buildAskLedger([...expensive, ...fresh])!;
    assert.match(md, /\| 2 ↺ \|/, 'the row that started fresh is marked');
    assert.match(md, /\*\*Session resets\*\* — 1 question \(marked ↺\)/);
    assert.match(md, /compare the cost of a ↺ row with the one before it/);
  });

  test('no resets ⇒ no reset section (nothing to explain)', () => {
    assert.ok(!buildAskLedger(pair('q', 6000, 0.1))!.includes('Session resets'));
  });
});

/**
 * Spec 059 — `costFromResult` (lib/cost.ts): the pure, presence-guarded reader that turns a `claude`
 * turn's terminal `result` stream-json event into a `PhaseCost`. AC3: a full event → fully-populated
 * cost; `null`/`undefined` → null; an event missing `usage` → duration/turns only; a shape-drifted
 * event → NO throw (degrade to partial/null). Deterministic — the reader stamps no clock (the
 * orchestrator adds `at`), so these deepEqual assertions carry no time field.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { costFromResult } from '../server/lib/cost.js';
import type { ClaudeStreamEvent } from '../server/lib/claude-session.js';

// A realistic terminal result event (fields per Claude Code stream-json `type:"result"`).
const ev = (o: Record<string, unknown>): ClaudeStreamEvent => ({ type: 'result', ...o }) as ClaudeStreamEvent;

describe('costFromResult (spec 059)', () => {
  test('a full result event → fully-populated PhaseCost (no `at`)', () => {
    const c = costFromResult(
      ev({
        duration_ms: 84000,
        duration_api_ms: 80000,
        num_turns: 12,
        total_cost_usd: 0.42,
        is_error: false,
        result: 'done',
        usage: {
          input_tokens: 12000,
          output_tokens: 8000,
          cache_read_input_tokens: 30000,
          cache_creation_input_tokens: 5000,
        },
      })
    );
    assert.deepEqual(c, {
      durationMs: 84000,
      apiDurationMs: 80000,
      numTurns: 12,
      totalCostUsd: 0.42,
      inputTokens: 12000,
      outputTokens: 8000,
      cacheReadTokens: 30000,
      cacheCreationTokens: 5000,
    });
  });

  test('null / undefined input → null (a dead turn records no entry)', () => {
    assert.equal(costFromResult(null), null);
    assert.equal(costFromResult(undefined), null);
  });

  test('event missing usage → duration/turns only, no token fields', () => {
    const c = costFromResult(ev({ duration_ms: 5000, num_turns: 3 }));
    assert.deepEqual(c, { durationMs: 5000, numTurns: 3 });
    assert.ok(c && !('inputTokens' in c), 'no phantom zero token fields');
  });

  test('partial usage → only the present token fields survive', () => {
    assert.deepEqual(costFromResult(ev({ usage: { output_tokens: 100 } })), { outputTokens: 100 });
  });

  test('shape-drifted event (wrong types / non-object usage / unknown keys) → no throw', () => {
    assert.doesNotThrow(() =>
      costFromResult(ev({ duration_ms: 'nope', usage: 'not-an-object', weird: {} }))
    );
    // nothing numeric recognized → null, not an empty husk
    assert.equal(costFromResult(ev({ duration_ms: 'nope', usage: null })), null);
    // NaN/Infinity are not finite → dropped
    assert.equal(costFromResult(ev({ num_turns: NaN, usage: { input_tokens: Infinity } })), null);
  });
});

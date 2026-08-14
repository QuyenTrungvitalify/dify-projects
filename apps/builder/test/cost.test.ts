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

  test('spec 062 #1: captures the model id from result.modelUsage (else a bare model)', () => {
    // recent claude stream-json result events carry modelUsage keyed by model id
    assert.equal(
      costFromResult(ev({ num_turns: 5, modelUsage: { 'claude-opus-4-8': { input_tokens: 10 } } }))?.model,
      'claude-opus-4-8'
    );
    // fallback: a bare `model` field
    assert.equal(costFromResult(ev({ num_turns: 5, model: 'claude-sonnet-5' }))?.model, 'claude-sonnet-5');
    // no model info → the field is simply absent (still returns the numeric cost)
    const c = costFromResult(ev({ num_turns: 5 }));
    assert.equal(c?.numTurns, 5);
    assert.ok(c && !('model' in c), 'no phantom model field');
    // a model with NO numeric fields still records nothing (059 contract: no numeric ⇒ null)
    assert.equal(costFromResult(ev({ model: 'claude-x' })), null);
  });

  /**
   * A turn can involve MORE than one model, and the first key is not the one that answered.
   *
   * Captured verbatim from the first turn of a new chat spawned with `--model opus`: the CLI does its own
   * housekeeping (the session title) on haiku, so `modelUsage` carried haiku FIRST and opus second. Taking
   * keys[0] recorded haiku for an answer Opus wrote — a lie in the audit trail a campaign reads, and a
   * user-visible contradiction of the model chip on the dev tip.
   */
  test('picks the model that WROTE, not the first key (a real two-model turn)', () => {
    const real = ev({
      num_turns: 1,
      modelUsage: {
        'claude-haiku-4-5-20251001': { inputTokens: 739, outputTokens: 14, costUSD: 0.000809 },
        'claude-opus-5': { inputTokens: 2, outputTokens: 494, cacheReadInputTokens: 18696, costUSD: 0.077678 },
      },
    });
    assert.equal(costFromResult(real)?.model, 'claude-opus-5');

    // order must not matter — the same map with the answering model first still resolves to it
    const flipped = ev({
      num_turns: 1,
      modelUsage: {
        'claude-opus-5': { outputTokens: 494 },
        'claude-haiku-4-5-20251001': { outputTokens: 14 },
      },
    });
    assert.equal(costFromResult(flipped)?.model, 'claude-opus-5');

    // no output counters anywhere → fall back to who READ the most, then to the first key
    assert.equal(
      costFromResult(ev({ num_turns: 1, modelUsage: { a: { inputTokens: 5 }, b: { inputTokens: 900 } } }))?.model,
      'b'
    );
    assert.equal(
      costFromResult(ev({ num_turns: 1, modelUsage: { first: {}, second: {} } }))?.model,
      'first',
      'nothing countable ⇒ the pre-existing behaviour, not an empty field'
    );
    // snake_case is accepted too — the CLI uses it in the top-level `usage` block
    assert.equal(
      costFromResult(ev({ num_turns: 1, modelUsage: { x: { output_tokens: 3 }, y: { output_tokens: 80 } } }))?.model,
      'y'
    );
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

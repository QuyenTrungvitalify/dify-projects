/**
 * Spec 048 D1 / AC 1b — the env OVERRIDE half: BUILDER_*_TIMEOUT_MS set BEFORE the module loads
 * changes the consts, and a hung turn driven with the overridden budget times out fast with the
 * EXACT pre-048 note text (045's JA frames key off it). Separate file from timeout-knobs.test.ts
 * because the consts read the env once at module load (per-process module cache).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.BUILDER_TURN_TIMEOUT_MS = '1000';
process.env.BUILDER_ASK_TIMEOUT_MS = '2000';

describe('spec 048 D1 — env overrides honored at module load', () => {
  test('the consts reflect the env values', async () => {
    const { TURN_TIMEOUT_MS } = await import('../server/lib/orchestrator.js');
    const { ASK_TIMEOUT_MS } = await import('../server/lib/ask.js');
    assert.equal(TURN_TIMEOUT_MS, 1000);
    assert.equal(ASK_TIMEOUT_MS, 2000);
  });

  test('a hung turn on the overridden budget times out ~1s with the byte-unchanged note', async () => {
    const { TURN_TIMEOUT_MS } = await import('../server/lib/orchestrator.js');
    const { runTurn } = await import('../server/lib/turn-runner.js');
    type CS = import('../server/lib/claude-session.js').ClaudeSession;
    // the turn-failure-triage fake-session harness: spawns ok, never emits → the timeout fires
    const hung = {
      onEvent: null as unknown,
      onExit: null as unknown,
      capturedSessionId: null,
      async spawn() { return true; },
      forceKill() {},
      stderrTail() { return ''; },
    };
    const t0 = Date.now();
    const res = await runTurn(hung as unknown as CS, 'prompt', undefined, { timeoutMs: TURN_TIMEOUT_MS });
    assert.ok(Date.now() - t0 < 5000, 'timed out on the 1s budget, not the 10 min default');
    assert.equal(res.isError, true);
    assert.equal(res.note, 'phase timed out after 1s — retry or simplify'); // pre-048 text, untouched
  });
});

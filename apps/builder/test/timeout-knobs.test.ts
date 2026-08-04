/**
 * Spec 048 D1 / AC 1a — the DEFAULTS: with no BUILDER_*_TIMEOUT_MS env set, the three knobs equal
 * their pre-048 hardcoded values. The consts read the env ONCE at module load, so this file deletes
 * the vars BEFORE the dynamic import; the env-set half of AC 1 lives in timeout-knobs-env.test.ts
 * (node --test runs each file in its own process — the two can't share a module cache).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.BUILDER_TURN_TIMEOUT_MS;
delete process.env.BUILDER_ASK_TIMEOUT_MS;

describe('spec 048 D1 — timeout defaults unchanged when env is unset', () => {
  test('TURN_TIMEOUT_MS defaults to 15 min (spec 085), ASK_TIMEOUT_MS to 3 min', async () => {
    const { TURN_TIMEOUT_MS } = await import('../server/lib/orchestrator.js');
    const { ASK_TIMEOUT_MS } = await import('../server/lib/ask.js');
    assert.equal(TURN_TIMEOUT_MS, 15 * 60 * 1000);
    assert.equal(ASK_TIMEOUT_MS, 3 * 60 * 1000);
  });

  test('.env.example documents all three knobs with their defaults', async () => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const env = await readFile(join(import.meta.dirname, '..', '.env.example'), 'utf8');
    assert.ok(env.includes('BUILDER_TURN_TIMEOUT_MS=900000'), 'turn knob + default documented');
    assert.ok(env.includes('BUILDER_ASK_TIMEOUT_MS=180000'), 'ask knob + default documented');
    assert.ok(env.includes('BUILDER_LIVE_RUN_TIMEOUT_MS=120000'), 'live-run knob + default documented');
  });
});

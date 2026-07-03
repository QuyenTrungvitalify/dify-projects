/**
 * Spec 032 S1 — the pure Dify live-test helpers (unit-tested with injected data; no real Dify):
 *   • pickLlmModel   — D4/Q1(A) policy: default-if-enabled → cheapest (*-nano > *-mini) → first → null.
 *   • parseModels    — flattens the `models` JSON (providers → models) + the system default.
 *   • parseRunResult — status/outputs/error/total_tokens from a blocking run; ok ⇔ succeeded.
 *   • appKeyFromStdout / lastJsonLine — the `--json-out` last-line parse.
 *   • B3 secret registry — registerSecret makes redactSecrets scrub a MINTED app-key (not in env);
 *     unregisterSecret stops it. A leaked app-key would breach spec 015 / §7, so it is tabled here.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastJsonLine,
  parseModels,
  pickLlmModel,
  appKeyFromStdout,
  parseRunResult,
  redactSecrets,
  registerSecret,
  unregisterSecret,
  type LlmModel,
} from '../server/lib/dify-io.js';

describe('lastJsonLine', () => {
  test('returns the LAST parseable {…} line; non-JSON lines skipped', () => {
    assert.deepEqual(lastJsonLine('starting\n{"a":1}\ndone'), { a: 1 });
    assert.deepEqual(lastJsonLine('{"a":1}\n{"b":2}'), { b: 2 });
  });
  test('no JSON / empty → null', () => {
    assert.equal(lastJsonLine('no json here'), null);
    assert.equal(lastJsonLine(''), null);
  });
});

describe('parseModels', () => {
  const stdout = JSON.stringify({
    enabled: [
      { provider: 'langgenius/openai/openai', models: [{ model: 'gpt-5' }, { model: 'gpt-5-mini' }] },
      { provider: 'langgenius/openai/openai', models: [{ name: 'gpt-5-nano' }] }, // tolerate `name`
    ],
    default: { model: 'gpt-4', provider: 'langgenius/openai/openai' },
  });

  test('flattens providers→models (both `model` and `name` keys) + reads the default', () => {
    const { enabled, systemDefault } = parseModels(stdout);
    assert.deepEqual(
      enabled.map((m) => m.name),
      ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']
    );
    assert.equal(enabled[0].provider, 'langgenius/openai/openai');
    assert.deepEqual(systemDefault, { provider: 'langgenius/openai/openai', name: 'gpt-4' });
  });

  test('missing default → null; garbage → empty', () => {
    assert.equal(parseModels(JSON.stringify({ enabled: [], default: null })).systemDefault, null);
    assert.deepEqual(parseModels('not json'), { enabled: [], systemDefault: null });
  });

  test('nested-object default provider is unwrapped (F3)', () => {
    const s = JSON.stringify({ enabled: [], default: { model: 'gpt-x', provider: { provider: 'langgenius/openai' } } });
    assert.deepEqual(parseModels(s).systemDefault, { provider: 'langgenius/openai', name: 'gpt-x' });
  });

  test('non-active / deprecated models are dropped; status-absent is kept (verified real shape)', () => {
    const s = JSON.stringify({
      enabled: [
        {
          provider: 'p',
          models: [
            { model: 'good', status: 'active' },
            { model: 'no-cred', status: 'no-configure' },
            { model: 'old', status: 'active', deprecated: true },
            { model: 'legacy' }, // no status → kept
          ],
        },
      ],
      default: null,
    });
    assert.deepEqual(
      parseModels(s).enabled.map((m) => m.name),
      ['good', 'legacy']
    );
  });
});

describe('pickLlmModel (D4 / Q1 A)', () => {
  const m = (name: string, provider = 'p'): LlmModel => ({ provider, name });

  test('system-default IS enabled → use it', () => {
    const enabled = [m('gpt-5'), m('gpt-5-mini')];
    assert.deepEqual(pickLlmModel(enabled, m('gpt-5')), m('gpt-5'));
  });

  test('the real observed case: default gpt-4 NOT enabled → cheapest enabled (prefers *-nano then *-mini)', () => {
    const enabled = [m('gpt-5'), m('gpt-5-mini'), m('gpt-5-nano')];
    // spec §Verified: system default = gpt-4 which the provider does not expose → fall back.
    assert.deepEqual(pickLlmModel(enabled, m('gpt-4')), m('gpt-5-nano'));
  });

  test('no nano/mini → first enabled (stable)', () => {
    const enabled = [m('gpt-5'), m('claude-opus')];
    assert.deepEqual(pickLlmModel(enabled, null), m('gpt-5'));
  });

  test('mini beats a plain model when no nano present', () => {
    assert.deepEqual(pickLlmModel([m('gpt-5'), m('gpt-5-mini')], null), m('gpt-5-mini'));
  });

  test('provider disambiguates a same-named default; empty → null', () => {
    const enabled = [m('x', 'provB')];
    assert.deepEqual(pickLlmModel(enabled, { provider: 'provA', name: 'x' }), m('x', 'provB')); // provA not enabled → fallback picks the only enabled
    assert.equal(pickLlmModel([], m('anything')), null);
  });
});

describe('parseRunResult', () => {
  test('succeeded run → ok, outputs, tokens', () => {
    const stdout = JSON.stringify({
      data: { status: 'succeeded', outputs: { summary: '・a\n・b' }, error: null, total_tokens: 196 },
    });
    assert.deepEqual(parseRunResult(stdout), {
      ok: true,
      status: 'succeeded',
      outputs: { summary: '・a\n・b' },
      error: null,
      totalTokens: 196,
    });
  });

  test('failed run → not ok, error surfaced', () => {
    const r = parseRunResult(JSON.stringify({ data: { status: 'failed', error: 'Model not exist' } }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 'failed');
    assert.equal(r.error, 'Model not exist');
  });

  test('unparseable → ok:false with an error', () => {
    const r = parseRunResult('boom');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'unparseable run output');
  });

  test('chat-messages shape (answer + metadata.usage) → ok, answer as output, tokens', () => {
    const stdout = JSON.stringify({ answer: 'Xin chào!', metadata: { usage: { total_tokens: 33 } }, conversation_id: 'c1' });
    const r = parseRunResult(stdout);
    assert.equal(r.ok, true);
    assert.equal(r.status, 'succeeded');
    assert.deepEqual(r.outputs, { answer: 'Xin chào!' });
    assert.equal(r.totalTokens, 33);
  });

  test('empty chat answer → not ok', () => {
    assert.equal(parseRunResult(JSON.stringify({ answer: '' })).ok, false);
  });
});

describe('appKeyFromStdout', () => {
  test('reads {token}; missing/blank → null', () => {
    assert.equal(appKeyFromStdout('{"token":"app-abc123"}'), 'app-abc123');
    assert.equal(appKeyFromStdout('{"foo":1}'), null);
    assert.equal(appKeyFromStdout(''), null);
  });
});

describe('B3 secret registry — redactSecrets scrubs a MINTED app-key (not in env)', () => {
  test('registered key is scrubbed (plain + encoded); unregister stops it', () => {
    const key = 'app-Zm9vYmFy1234'; // not a DIFY_* env var — only the registry knows it
    // Before registering, redactSecrets (env-only) leaves it be.
    assert.equal(redactSecrets(`key=${key}`).includes(key), true);
    registerSecret(key);
    try {
      const enc = encodeURIComponent(key);
      const b64 = Buffer.from(key, 'utf8').toString('base64');
      const out = redactSecrets(`plain=${key} enc=${enc} b64=${b64}`);
      assert.equal(out.includes(key), false, 'plain app-key scrubbed');
      assert.equal(out.includes(enc), false, 'url-encoded app-key scrubbed');
      assert.equal(out.includes(b64), false, 'base64 app-key scrubbed');
    } finally {
      unregisterSecret(key);
    }
    // After unregister, no longer scrubbed (bounded lifetime — no unbounded growth).
    assert.equal(redactSecrets(`key=${key}`).includes(key), true);
  });

  test('a too-short secret (<4) is ignored (over-redaction guard)', () => {
    registerSecret('ab');
    try {
      assert.equal(redactSecrets('value ab here'), 'value ab here');
    } finally {
      unregisterSecret('ab');
    }
  });
});

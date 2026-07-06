/**
 * Spec 032 S3-wiring-a — locks the `testMode` contract + the INERTNESS invariant: live must be explicit.
 * Spec 036 D3 INVERTS the create-time choice: `deploy`/`testMode` are NO LONGER read from the composer —
 * createTask ALWAYS defaults `deploy:'none'` / `testMode:'static'` (they are gate-stamped from reachable
 * creds later). So a stray `test_mode:live` on the wire can NEVER reach Dify at create-time. The
 * `normalizeTestMode` helper is retained (it validates a value if a gate-time setter ever calls it).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeTestMode, createTask } from '../server/state/task.js';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'testmode-'));

describe('normalizeTestMode', () => {
  test('only the literal "live" (case/space-insensitive) → live; everything else → static', () => {
    assert.equal(normalizeTestMode('live'), 'live');
    assert.equal(normalizeTestMode(' LIVE '), 'live');
    assert.equal(normalizeTestMode('static'), 'static');
    assert.equal(normalizeTestMode(undefined), 'static');
    assert.equal(normalizeTestMode(''), 'static');
    assert.equal(normalizeTestMode('yes'), 'static'); // not a truthy alias — live must be explicit
  });
});

describe('createTask ignores deploy/test_mode (spec 036 D3 — gate-stamped, not start-bound)', () => {
  test('deploy defaults to none even when input.deploy=selfhost (no longer read)', async () => {
    const t = await createTask(tmp(), { requirement: 'r', deploy: 'selfhost' });
    assert.equal(t.deploy, 'none', 'createTask no longer reads input.deploy — it is stamped at the gate');
  });

  test('test_mode:live is IGNORED at create-time (can never reach Dify), even with deploy:selfhost', async () => {
    const t = await createTask(tmp(), { requirement: 'r', deploy: 'selfhost', testMode: 'live' });
    assert.equal(t.testMode, 'static', 'createTask no longer reads input.test_mode — always static at create');
    assert.equal(t.deploy, 'none');
  });

  test('absent deploy/test_mode → none/static (the defaults)', async () => {
    const t = await createTask(tmp(), { requirement: 'r' });
    assert.equal(t.deploy, 'none');
    assert.equal(t.testMode, 'static');
  });
});

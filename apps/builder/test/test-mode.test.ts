/**
 * Spec 032 S3-wiring-a — locks the `testMode` contract + the INERTNESS invariant (the whole
 * "feature is off until activation" guarantee rests on these): live is opt-in, selfhost-only, and a
 * default of static. A future refactor that accidentally lets a non-selfhost build go `live`, or flips
 * the default, would break here before it could activate the live path.
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

describe('createTask testMode (selfhost-only, static default)', () => {
  test('selfhost + test_mode:live → live', async () => {
    const t = await createTask(tmp(), { requirement: 'r', deploy: 'selfhost', testMode: 'live' });
    assert.equal(t.testMode, 'live');
  });

  test('live is FORCED to static off selfhost (none / cloud) — can never reach Dify', async () => {
    for (const deploy of ['none', 'cloud']) {
      const t = await createTask(tmp(), { requirement: 'r', deploy, testMode: 'live' });
      assert.equal(t.testMode, 'static', `deploy=${deploy} forces static`);
    }
  });

  test('absent test_mode → static (opt-in), even on selfhost', async () => {
    const t = await createTask(tmp(), { requirement: 'r', deploy: 'selfhost' });
    assert.equal(t.testMode, 'static');
  });
});

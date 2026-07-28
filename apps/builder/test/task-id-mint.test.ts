/**
 * mintTaskId monotonicity — the invariant the §5 anti-race argument rests on (Q6 / AC #21): two
 * POSTs in the same millisecond must never mint the same taskId, because the turn lock keys on
 * taskId — a shared id would let the race-loser `acquireTurn` the very slot the winner holds.
 * mintTaskId is module-private, so it is pinned through `createTask` with Date.now frozen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask } from '../server/state/task.js';

test('same-millisecond createTask calls mint DISTINCT, strictly increasing taskIds', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mint-'));
  const frozen = 1_750_000_000_000;
  t.mock.method(Date, 'now', () => frozen);

  const a = await createTask(dir, { requirement: 'r' });
  const b = await createTask(dir, { requirement: 'r' });
  const c = await createTask(dir, { requirement: 'r' });

  assert.equal(Date.now(), frozen, 'the wall clock never advanced — all three share one millisecond');
  assert.equal(new Set([a.taskId, b.taskId, c.taskId]).size, 3, 'no shared id in a single ms');
  assert.ok(BigInt(b.taskId) > BigInt(a.taskId), 'strictly increasing (the monotonic bump)');
  assert.ok(BigInt(c.taskId) > BigInt(b.taskId), 'strictly increasing across repeated collisions');
  assert.match(a.taskId, /^\d{13}$/, 'still the 13-digit ms-string shape task.json promises');
});

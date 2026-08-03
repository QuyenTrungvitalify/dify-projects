/**
 * T2 — the turn-level run-lock. The single-`turnHolder` invariant is what keeps the post-turn
 * confinement baseline-delta valid (1 writer at a time), and the cancel flag MUST outlive the
 * release so a killed turn's orchestrator still sees `isCancelled` after its await unwinds.
 *
 * The lock is module-global singleton state, so these run sequentially (node:test default) and each
 * case releases what it acquires.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireTurn,
  releaseTurn,
  buildTurnBusy,
  buildHolderId,
  liveKind,
  markCancelled,
  isCancelled,
  evictCancelled,
  cancelledCount,
  reconcileOnBoot,
} from '../server/lib/lock.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {}, debug() {} } as unknown as SessionLogger;

describe('acquire / release single-holder invariant', () => {
  test('only one turn holds the slot; a 2nd acquire fails until release', () => {
    assert.equal(acquireTurn('A'), true);
    assert.equal(buildTurnBusy(), true);
    assert.equal(buildHolderId(), 'A');
    assert.equal(acquireTurn('B'), false); // busy → loser 409s

    releaseTurn('B'); // release-iff-matches: B is not the holder → no-op
    assert.equal(buildTurnBusy(), true);
    assert.equal(buildHolderId(), 'A');

    releaseTurn('A');
    assert.equal(buildTurnBusy(), false);
    assert.equal(buildHolderId(), null);

    assert.equal(acquireTurn('B'), true); // free now
    releaseTurn('B');
  });
});

describe('spec 033 D9 — acquireTurn kind tag + liveKind()', () => {
  test('defaults to "phase" when the 2nd param is omitted (every pre-033 call site)', () => {
    assert.equal(acquireTurn('E'), true);
    assert.equal(liveKind('E'), 'phase');
    releaseTurn('E');
    assert.equal(liveKind('E'), null);
  });

  test('acquireTurn(id, "ask") tags the holder; liveKind() reflects it; null once released', () => {
    assert.equal(acquireTurn('F', 'ask'), true);
    assert.equal(liveKind('F'), 'ask');
    assert.equal(liveKind('G'), null, 'a different, non-holder id sees null');
    releaseTurn('F');
    assert.equal(liveKind('F'), null);
  });
});

describe('cancel flag outlives the lock', () => {
  test('markCancelled survives releaseTurn; a fresh acquire of the same id clears it', () => {
    assert.equal(acquireTurn('C'), true);
    markCancelled('C');
    assert.equal(isCancelled('C'), true);
    releaseTurn('C');
    assert.equal(isCancelled('C'), true); // the killed turn's orchestrator must still see it

    assert.equal(acquireTurn('C'), true); // re-acquire = fresh slate
    assert.equal(isCancelled('C'), false);
    releaseTurn('C');
  });
});

describe('bounded cancelledTasks — evict on terminal, not on release (spec 014 D7)', () => {
  test('the flag survives releaseTurn but evictCancelled drops it (so the Set stays bounded)', () => {
    const before = cancelledCount();
    assert.equal(acquireTurn('D'), true);
    markCancelled('D');
    assert.equal(isCancelled('D'), true);

    releaseTurn('D');
    assert.equal(isCancelled('D'), true, 'MUST survive the turn-lock release (post-await checks need it)');
    assert.equal(cancelledCount(), before + 1, 'still tracked after release');

    evictCancelled('D'); // terminal settle
    assert.equal(isCancelled('D'), false, 'evicted on terminal');
    assert.equal(cancelledCount(), before, 'Set bounded back to baseline');
  });
});

describe('reconcileOnBoot', () => {
  const writeTask = (root: string, id: string, obj: unknown): void => {
    const dir = join(root, 'apps/builder/.runs', id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'task.json'), JSON.stringify(obj));
  };
  const readStatus = (root: string, id: string): string =>
    JSON.parse(readFileSync(join(root, 'apps/builder/.runs', id, 'task.json'), 'utf8')).status;

  test('running → error; awaiting_confirm preserved; corrupt task.json skipped (no throw)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runs-'));
    writeTask(root, '1000000000001', { taskId: '1000000000001', status: 'running' });
    writeTask(root, '1000000000002', { taskId: '1000000000002', status: 'awaiting_confirm' });
    // corrupt: not valid JSON
    const corruptDir = join(root, 'apps/builder/.runs', '1000000000003');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(join(corruptDir, 'task.json'), '{ not json');

    await reconcileOnBoot(root, log); // must not throw on the corrupt entry

    assert.equal(readStatus(root, '1000000000001'), 'error');
    assert.equal(readStatus(root, '1000000000002'), 'awaiting_confirm');
  });

  test('missing .runs root → no-op (no throw)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'runs-empty-'));
    await reconcileOnBoot(root, log);
  });
});

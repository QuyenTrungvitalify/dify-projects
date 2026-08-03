/**
 * Spec 082 S1 — the TWO-LANE turn lock. Pins the three load-bearing rules:
 *   1. chat ∥ build across DIFFERENT tasks (the whole point of 082),
 *   2. per-task exclusivity (a task holds at most ONE lane — every same-task safety argument
 *      from 033/FIX-M rests on this),
 *   3. per-lane single slot (build∥build and chat∥chat stay serialized).
 * Plus: scoped release, two live sessions tracked independently (the /cancel targeting surface),
 * and the lane-aware helpers (buildHolderId/chatHolderId/taskTurnRunning).
 *
 * The lock is module-global singleton state, so these run sequentially (node:test default) and each
 * case releases what it acquires.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireTurn,
  releaseTurn,
  buildTurnBusy,
  chatTurnBusy,
  buildHolderId,
  chatHolderId,
  taskTurnRunning,
  liveKind,
  liveSession,
  setSession,
  clearSession,
  requestAskCancel,
  isAskCancelRequested,
} from '../server/lib/lock.js';
import type { ClaudeSession } from '../server/lib/claude-session.js';

const fakeSession = (id: string): ClaudeSession => ({ id }) as unknown as ClaudeSession;

describe('082 rule 1 — chat ∥ build across different tasks', () => {
  test('a build turn and a chat turn coexist; each lane reports its own holder', () => {
    assert.equal(acquireTurn('X', 'phase'), true);
    assert.equal(acquireTurn('Y', 'ask'), true, 'chat lane acquires WHILE the build lane is held');

    assert.equal(buildTurnBusy(), true);
    assert.equal(chatTurnBusy(), true);
    assert.equal(buildHolderId(), 'X');
    assert.equal(chatHolderId(), 'Y');
    assert.equal(liveKind('X'), 'phase');
    assert.equal(liveKind('Y'), 'ask');
    assert.equal(taskTurnRunning('X'), true);
    assert.equal(taskTurnRunning('Y'), true);
    assert.equal(taskTurnRunning('Z'), false);

    releaseTurn('X');
    releaseTurn('Y');
  });
});

describe('082 rule 2 — per-task exclusivity (one lane per task)', () => {
  test('a task holding the build lane cannot also take the chat lane, and vice versa', () => {
    assert.equal(acquireTurn('X', 'phase'), true);
    assert.equal(acquireTurn('X', 'ask'), false, 'same task, other lane → refused');
    releaseTurn('X');

    assert.equal(acquireTurn('X', 'ask'), true);
    assert.equal(acquireTurn('X', 'phase'), false, 'mirror direction → refused');
    releaseTurn('X');
  });
});

describe('082 rule 3 — each lane stays single-slot', () => {
  test('build∥build and chat∥chat still 409', () => {
    assert.equal(acquireTurn('X', 'phase'), true);
    assert.equal(acquireTurn('Y', 'phase'), false, 'build lane is single-slot');
    assert.equal(acquireTurn('Y', 'ask'), true);
    assert.equal(acquireTurn('Z', 'ask'), false, 'chat lane is single-slot');
    releaseTurn('X');
    releaseTurn('Y');
  });
});

describe('scoped release — releaseTurn clears only the lane its task holds', () => {
  test('releasing the build side leaves the chat side untouched (and vice versa)', () => {
    acquireTurn('X', 'phase');
    acquireTurn('Y', 'ask');

    releaseTurn('X');
    assert.equal(buildTurnBusy(), false);
    assert.equal(chatTurnBusy(), true, 'chat holder survives a build release');
    assert.equal(chatHolderId(), 'Y');

    assert.equal(acquireTurn('Z', 'phase'), true, 'freed build lane is immediately reusable');
    releaseTurn('Z');
    releaseTurn('Y');
    assert.equal(chatTurnBusy(), false);
  });
});

describe('two live sessions tracked independently (the /cancel targeting surface)', () => {
  test('setSession/liveSession/clearSession key by task, never cross lanes', () => {
    acquireTurn('X', 'phase');
    acquireTurn('Y', 'ask');
    const sx = fakeSession('sx');
    const sy = fakeSession('sy');
    setSession('X', sx);
    setSession('Y', sy);

    assert.equal(liveSession('X'), sx, 'the build child');
    assert.equal(liveSession('Y'), sy, 'the chat child — distinct object');

    clearSession('X');
    assert.equal(liveSession('X'), null);
    assert.equal(liveSession('Y'), sy, 'clearing the build side leaves the chat child attached');

    releaseTurn('X');
    releaseTurn('Y');
    assert.equal(liveSession('Y'), null, 'released → no live child');
  });

  test('requestAskCancel flags only its own task and dies with the turn', () => {
    acquireTurn('X', 'phase');
    acquireTurn('Y', 'ask');
    requestAskCancel('Y');
    assert.equal(isAskCancelRequested('Y'), true);
    assert.equal(isAskCancelRequested('X'), false, 'the build turn is not flagged');
    releaseTurn('Y');
    assert.equal(isAskCancelRequested('Y'), false, 'dies with the turn — never leaks across turns');
    releaseTurn('X');
  });
});

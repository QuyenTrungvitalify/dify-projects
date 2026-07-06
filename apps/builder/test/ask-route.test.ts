/**
 * Spec 033 — route-level guards that return BEFORE any turn is dispatched (so these stay fast/hermetic,
 * no real `claude` spawn involved): `POST /api/tasks/:id/ask`'s validation (D4's backend-side phase/
 * status enforcement, independent of the FE's own routing predicate) and `POST /api/tasks/:id/cancel`'s
 * D9 scoping (an Ask's abort force-kills the child but never converges `status`/`gate`).
 *
 * The "acquire + dispatch a real Ask turn" path is covered at the function level in ask.test.ts — not
 * repeated here via HTTP, since a real dispatch would try to spawn an actual `claude` process. Spec 034
 * widens /ask to also accept `done`/`cancelled` (D3) and `phase==='test'` (D5) → `askTestWithin`; those
 * acceptance cases are asserted here by pre-holding the global turn lock so the route 409s on the LOCK
 * (turnBusyError) AFTER passing validation, again without ever spawning.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes from '../server/routes/tasks.js';
import { createTask, saveTask, loadTask } from '../server/state/task.js';
import { acquireTurn, releaseTurn, setSession, liveKind } from '../server/lib/lock.js';

async function build(dir: string) {
  const app = Fastify();
  await app.register(tasksRoutes, { projectsDir: dir, settingsPath: '' });
  return app;
}

describe('POST /api/tasks/:id/ask — validation (spec 033 §1)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ask-route-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('blank text → 400, no task ever loaded/locked', async () => {
    const app = await build(dir);
    const res = await app.inject({ method: 'POST', url: '/api/tasks/nope/ask', payload: { text: '   ' } });
    assert.equal(res.statusCode, 400);
    await app.close();
  });

  test('unknown task id → 404', async () => {
    const app = await build(dir);
    const res = await app.inject({ method: 'POST', url: '/api/tasks/1700000000000/ask', payload: { text: 'hi' } });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  test('spec 034: done / cancelled / ④-test now PASS /ask validation (reach the turn lock, not rejected)', async () => {
    // 033 rejected these at validation; 034 D3/D5 widens /ask to accept them (→ askTestWithin). Proven
    // WITHOUT a real dispatch by pre-holding the single global turn slot elsewhere: a POST that PASSED
    // validation then 409s on the LOCK (turnBusyError — carries a `holder`), which is distinguishable from
    // a validation 409 (no `holder`). So no askTestWithin ever spawns here (stays fast/hermetic).
    const done = await createTask(dir, { requirement: 'r' });
    done.status = 'done';
    await saveTask(dir, done);
    const cancelled = await createTask(dir, { requirement: 'r' });
    cancelled.status = 'cancelled';
    await saveTask(dir, cancelled);
    const gate4 = await createTask(dir, { requirement: 'r' });
    gate4.status = 'awaiting_confirm';
    gate4.phase = 'test';
    await saveTask(dir, gate4);

    const app = await build(dir);
    assert.ok(acquireTurn('other-task', 'phase')); // occupy the single global slot — no real dispatch runs
    try {
      for (const task of [done, cancelled, gate4]) {
        const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/ask`, payload: { text: 'hi' } });
        assert.equal(res.statusCode, 409, `${task.status}/${task.phase}: still 409, but on the LOCK`);
        assert.ok('holder' in res.json(), `${task.status}/${task.phase}: PASSED validation → the 409 is turnBusyError (has holder), not a validation reject`);
      }
    } finally {
      releaseTurn('other-task');
    }
    await app.close();
  });

  test('error → 409 at validation: /ask does NOT accept status===error (unlike /reply — no live parked gate)', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'error';
    await saveTask(dir, task);
    const app = await build(dir);
    const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/ask`, payload: { text: 'hi' } });
    assert.equal(res.statusCode, 409);
    assert.equal('holder' in res.json(), false, 'a validation 409 has no holder (never reached the lock)');
    await app.close();
  });

  test('a turn already running elsewhere → 409 (the single global lock)', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'awaiting_confirm';
    task.phase = 'spec';
    await saveTask(dir, task);
    const app = await build(dir);
    assert.ok(acquireTurn('some-other-task', 'phase'));
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/ask`, payload: { text: 'hi' } });
      assert.equal(res.statusCode, 409);
    } finally {
      releaseTurn('some-other-task');
    }
    await app.close();
  });
});

// FIX-M audit, 2nd site: /reply's pre-lock saveAttachments writes into apps/builder/.runs/<id>/uploads/
// — a root a live Ask on the SAME task snapshots. A /reply racing a live Ask must be rejected BEFORE that
// write (else the Ask's byte-compare deletes the reply's files + false-anomalies). Guard: turnHolderId()===id.
describe('POST /api/tasks/:id/reply — turn-lock guard closes the FIX-M gap (spec 033)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'reply-guard-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('a /reply while THIS task holds the turn lock (a live Ask) → 409 before any file write', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'awaiting_confirm';
    task.phase = 'spec';
    await saveTask(dir, task);
    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId, 'ask')); // a live Ask holds the lock; status stays awaiting_confirm
    try {
      const res = await app.inject({
        method: 'POST', url: `/api/tasks/${task.taskId}/reply`,
        payload: { text: 'change it', files: [{ name: 'x.txt', mime: 'text/plain', dataUrl: 'data:text/plain;base64,YQ==' }] },
      });
      assert.equal(res.statusCode, 409, 'rejected before saveAttachments (no write into the Ask snapshot root)');
      // the uploads dir must NOT have been created by this rejected /reply.
      assert.equal(existsSync(join(dir, `apps/builder/.runs/${task.taskId}/uploads`)), false);
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });

  test("a turn on a DIFFERENT task does not trip THIS reply's same-id guard (it 409s on the lock instead, no early guard-reject)", async () => {
    // Proves the guard is scoped to turnHolderId()===id, not "any turn": a different task's turn lets
    // this reply PAST the guard; it then 409s on acquireTurn (the general collision), which is the
    // pre-existing behavior. Either way the response is 409 — but critically the guard didn't fire early,
    // and (since acquireTurn is checked AFTER saveAttachments in the no-files case here) no cross-root write occurred.
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'awaiting_confirm';
    task.phase = 'spec';
    await saveTask(dir, task);
    const app = await build(dir);
    assert.ok(acquireTurn('a-different-task', 'phase'));
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/reply`, payload: { text: 'tweak' } });
      assert.equal(res.statusCode, 409); // general turn-collision, not the same-id guard
    } finally {
      releaseTurn('a-different-task');
    }
    await app.close();
  });
});

describe('POST /api/tasks/:id/cancel — D9 scoping (an Ask abort never converges status/gate)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cancel-route-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('liveKind===ask → force-kills the child, leaves status/gate untouched, does NOT mark cancelled', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'awaiting_confirm';
    task.phase = 'spec';
    task.gate = { actions: [{ id: 'changes', label: 'Edit spec', kind: 'reply', route: '/reply' }] };
    await saveTask(dir, task);

    let killed = false;
    const stubSession = { forceKill: () => { killed = true; } };

    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId, 'ask'));
    setSession(task.taskId, stubSession as unknown as import('../server/lib/claude-session.js').ClaudeSession);
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/cancel` });
      assert.equal(res.statusCode, 200);
      assert.equal(killed, true, 'the ask child was force-killed');
      const body = res.json();
      assert.equal(body.status, 'awaiting_confirm', 'status is untouched — the gate stays parked');
      assert.ok(body.gate, 'gate is untouched (not cleared)');
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });

  test('liveKind===phase (a normal turn) still converges to cancelled as today', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'running';
    task.phase = 'spec';
    await saveTask(dir, task);

    let killed = false;
    const stubSession = { forceKill: () => { killed = true; } };

    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId)); // default kind: 'phase'
    setSession(task.taskId, stubSession as unknown as import('../server/lib/claude-session.js').ClaudeSession);
    assert.equal(liveKind(task.taskId), 'phase');
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/cancel` });
      assert.equal(res.statusCode, 200);
      assert.equal(killed, true);
      const body = res.json();
      assert.equal(body.status, 'cancelled', 'a phase turn cancel still converges status (byte-unchanged)');
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });
});

// Spec 034: a cancelled build is now askable, so a live Ask can hold the turn lock while its in-memory
// snapshot is still status='cancelled'. A /restore racing that Ask would set awaiting_confirm + save, only
// for the Ask's own turn-end saveTask to clobber it back to cancelled on disk. /restore must reject first.
describe('POST /api/tasks/:id/restore — turn-lock guard (spec 034: never clobber a live Ask)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'restore-guard-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('a /restore while THIS task holds the turn lock (a live Ask) → 409, disk status stays cancelled', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'cancelled';
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'implement';
    await saveTask(dir, task);
    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId, 'ask')); // a live Ask on the cancelled build holds the lock
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/restore` });
      assert.equal(res.statusCode, 409, 'rejected before any write — the Ask would otherwise clobber it back');
      const reloaded = await loadTask(dir, task.taskId);
      assert.equal(reloaded.status, 'cancelled', 'disk status untouched (no write happened)');
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });

  test("a DIFFERENT task's turn does not block this restore (same-id guard only) → 200, restored", async () => {
    const task = await createTask(dir, { requirement: 'r' });
    task.status = 'cancelled';
    task.project = 'p';
    task.workflowSlug = 'wf';
    task.phase = 'implement';
    await saveTask(dir, task);
    const app = await build(dir);
    assert.ok(acquireTurn('a-different-task', 'phase'));
    try {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${task.taskId}/restore` });
      assert.equal(res.statusCode, 200, 'a different task holding the lock does not block this restore');
      assert.equal(res.json().status, 'awaiting_confirm');
    } finally {
      releaseTurn('a-different-task');
    }
    await app.close();
  });
});

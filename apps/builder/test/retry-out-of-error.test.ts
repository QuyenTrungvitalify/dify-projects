/**
 * Spec 053 — POST /api/tasks/:id/reply's empty-text carve-out for Retry-out-of-error, at the ROUTE level
 * (validation only — no real `claude` spawn). The one-click "Retry phase" button fires a text-less
 * `/reply`; the empty-text `400` (formerly an unconditional top-of-handler guard) is relaxed to
 * `!text && status !== 'error'` and moved below `loadTask` so it can see the status.
 *
 * Harness trick (from ask-route.test.ts): a request that PASSES validation then 409s on the LOCK —
 * `turnBusyError()` carries a `holder`. A request rejected at VALIDATION returns 400, or a 409 with NO
 * `holder` (the promote "no change action" guard). So "empty text reached the dispatch" is provable
 * WITHOUT spawning: pre-hold the single global turn slot, then assert `{ statusCode: 409, holder set }`.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes from '../server/routes/tasks.js';
import { createTask, saveTask, type Task } from '../server/state/task.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';

async function build(dir: string) {
  const app = Fastify();
  await app.register(tasksRoutes, { projectsDir: dir, settingsPath: '' });
  return app;
}

/** POST an empty (or given) reply and return { statusCode, body }. */
async function postReply(app: Awaited<ReturnType<typeof build>>, id: string, text = '') {
  const res = await app.inject({ method: 'POST', url: `/api/tasks/${id}/reply`, payload: { text } });
  return { code: res.statusCode, body: JSON.parse(res.body || '{}') as { error?: string; holder?: string | null } };
}

/** True when the 409 came from the turn LOCK (turnBusyError carries `holder`) — i.e. validation PASSED
 *  and the request reached the dispatch, rather than being rejected upstream. */
const reachedDispatch = (r: { code: number; body: { holder?: string | null } }): boolean =>
  r.code === 409 && r.body.holder !== undefined;

describe('POST /reply — empty-text carve-out for Retry-out-of-error (spec 053)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'retry-oe-'));
  });
  afterEach(async () => {
    releaseTurn('holder-task'); // drop the pre-held slot even if a test threw
    await rm(dir, { recursive: true, force: true });
  });

  const parked = async (over: Partial<Task>): Promise<Task> => {
    const t = await createTask(dir, { requirement: 'r' });
    Object.assign(t, over);
    await saveTask(dir, t);
    return t;
  };

  test("error task + EMPTY text → passes validation, reaches the dispatch (empty is allowed on error)", async () => {
    const t = await parked({ status: 'error' });
    const app = await build(dir);
    assert.ok(acquireTurn('holder-task', 'phase')); // occupy the slot so no real turn spawns
    const r = await postReply(app, t.taskId, '');
    assert.ok(reachedDispatch(r), `expected a lock-409 (holder set), got ${r.code} ${JSON.stringify(r.body)}`);
    await app.close();
  });

  test("awaiting_confirm task + EMPTY text → 400 'text is required' (unchanged — empty has no meaning here)", async () => {
    const t = await parked({ status: 'awaiting_confirm' });
    const app = await build(dir);
    const r = await postReply(app, t.taskId, '');
    assert.equal(r.code, 400);
    assert.equal(r.body.error, 'text is required');
    await app.close();
  });

  test("error task + NON-empty text → reaches the dispatch (steered retry, byte-unchanged)", async () => {
    const t = await parked({ status: 'error' });
    const app = await build(dir);
    assert.ok(acquireTurn('holder-task', 'phase'));
    const r = await postReply(app, t.taskId, 'simplify the spec');
    assert.ok(reachedDispatch(r), `expected a lock-409, got ${r.code} ${JSON.stringify(r.body)}`);
    await app.close();
  });

  // ── promote-task edge (D6): once empty text is allowed past the top guard, an errored promote build
  //    (gate undefined) must 409 GRACEFULLY at the promote-gate check — never 400, never a 500/throw. ──
  test("PROMOTE task in error (gate undefined) + EMPTY text → clean 409 'no change action' (not 400, not 500)", async () => {
    const t = await parked({ status: 'error', kind: 'promote', gate: undefined });
    const app = await build(dir);
    const r = await postReply(app, t.taskId, '');
    assert.equal(r.code, 409);
    assert.equal(r.body.error, 'this promote gate has no change action');
    assert.equal(r.body.holder, undefined); // a VALIDATION 409 (before the lock), not a turnBusy 409
    await app.close();
  });

  test("PROMOTE task in awaiting_confirm + EMPTY text → 400 (empty-text guard fires before the promote check)", async () => {
    const t = await parked({ status: 'awaiting_confirm', kind: 'promote', gate: undefined });
    const app = await build(dir);
    const r = await postReply(app, t.taskId, '');
    assert.equal(r.code, 400);
    assert.equal(r.body.error, 'text is required');
    await app.close();
  });

  test("unknown task id + EMPTY text → 404 (loadTask fails before the empty-text check)", async () => {
    const app = await build(dir);
    const r = await postReply(app, '1700000000000', '');
    assert.equal(r.code, 404);
    await app.close();
  });
});

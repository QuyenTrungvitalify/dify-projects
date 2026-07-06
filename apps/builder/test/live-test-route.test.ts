/**
 * Spec 036 S5 — route-level guards for `POST /api/tasks/:id/live-test` (the done-state live action, D5).
 * These return BEFORE any turn is dispatched, so they stay fast/hermetic (no real `claude`/sync.py spawn):
 * the server re-checks the SAME predicate the FE gate-foot evaluates — done + on-disk workflow +
 * self-host reachable + AUTONOMOUS (each_step/null excluded) — and 409s otherwise, NEVER trusting the FE.
 *
 * The happy path (validation PASSES → runLiveTest dispatched) is proven WITHOUT a real dispatch by
 * pre-holding the single global turn slot elsewhere: a POST that passed validation then 409s on the LOCK
 * (turnBusyError carries a `holder`), distinguishable from a validation 409 (no `holder`) — same trick as
 * ask-route.test.ts. So no runLiveTest ever spawns here.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes from '../server/routes/tasks.js';
import { createTask, saveTask, type ConfirmMode, type Task } from '../server/state/task.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';

async function build(dir: string) {
  const app = Fastify();
  await app.register(tasksRoutes, { projectsDir: dir, settingsPath: '' });
  return app;
}

/** Set/clear the self-host console env for the body, then restore it (node --test = one process). */
async function withCreds(present: boolean, fn: () => Promise<void>): Promise<void> {
  const prev = { u: process.env.DIFY_CONSOLE_URL, t: process.env.DIFY_CONSOLE_TOKEN };
  if (present) {
    process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
    process.env.DIFY_CONSOLE_TOKEN = 'tok-test';
  } else {
    delete process.env.DIFY_CONSOLE_URL;
    delete process.env.DIFY_CONSOLE_TOKEN;
  }
  try {
    await fn();
  } finally {
    if (prev.u === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = prev.u;
    if (prev.t === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = prev.t;
  }
}

/** A done build seeded with a workflow slug + the given confirm-mode (persisted so the route loads it). */
async function doneBuild(dir: string, confirmMode: ConfirmMode | null): Promise<Task> {
  const t = await createTask(dir, { requirement: 'r', slug: 'wf', project: 'proj' });
  t.status = 'done';
  t.confirmMode = (confirmMode as ConfirmMode) ?? (null as unknown as ConfirmMode); // simulate a corrupt/null field
  await saveTask(dir, t);
  return t;
}

describe('POST /api/tasks/:id/live-test — done-state gate (spec 036 S5)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'live-route-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('unknown task id → 404', async () => {
    const app = await build(dir);
    const res = await app.inject({ method: 'POST', url: '/api/tasks/1700000000000/live-test' });
    assert.equal(res.statusCode, 404);
    await app.close();
  });

  test('NOT done (awaiting_confirm) → 409 validation (no holder), even with auto+creds', async () => {
    const t = await createTask(dir, { requirement: 'r', slug: 'wf', project: 'proj', confirmMode: 'auto' });
    t.status = 'awaiting_confirm';
    await saveTask(dir, t);
    const app = await build(dir);
    await withCreds(true, async () => {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.taskId}/live-test` });
      assert.equal(res.statusCode, 409);
      assert.ok(!('holder' in res.json()), 'a validation 409 carries no holder');
    });
    await app.close();
  });

  test('done + auto but NO creds → 409 (self-host not reachable)', async () => {
    const t = await doneBuild(dir, 'auto');
    const app = await build(dir);
    await withCreds(false, async () => {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.taskId}/live-test` });
      assert.equal(res.statusCode, 409);
      assert.ok(!('holder' in res.json()));
    });
    await app.close();
  });

  test('done + auto + creds but NO workflowSlug → 409 (no on-disk workflow)', async () => {
    const t = await createTask(dir, { requirement: 'r', confirmMode: 'auto' }); // no slug
    t.status = 'done';
    await saveTask(dir, t);
    const app = await build(dir);
    await withCreds(true, async () => {
      const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.taskId}/live-test` });
      assert.equal(res.statusCode, 409);
      assert.ok(!('holder' in res.json()));
    });
    await app.close();
  });

  test('done + creds but each_step / null confirmMode → 409 (excluded — not autonomous, D5)', async () => {
    const app = await build(dir);
    await withCreds(true, async () => {
      for (const mode of ['each_step', null] as (ConfirmMode | null)[]) {
        const t = await doneBuild(dir, mode);
        const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.taskId}/live-test` });
        assert.equal(res.statusCode, 409, `mode=${mode}`);
        assert.ok(!('holder' in res.json()), `mode=${mode}: validation 409 (no holder)`);
      }
    });
    await app.close();
  });

  for (const mode of ['auto', 'spec_only'] as ConfirmMode[]) {
    test(`done + ${mode} + creds PASSES validation → 409 on the LOCK (has holder), never dispatches`, async () => {
      const t = await doneBuild(dir, mode);
      const app = await build(dir);
      await withCreds(true, async () => {
        assert.ok(acquireTurn('other-task', 'phase')); // occupy the single global slot — no real dispatch runs
        try {
          const res = await app.inject({ method: 'POST', url: `/api/tasks/${t.taskId}/live-test` });
          assert.equal(res.statusCode, 409);
          assert.ok('holder' in res.json(), `${mode}: PASSED validation → the 409 is turnBusyError (has holder)`);
        } finally {
          releaseTurn('other-task');
        }
      });
      await app.close();
    });
  }
});

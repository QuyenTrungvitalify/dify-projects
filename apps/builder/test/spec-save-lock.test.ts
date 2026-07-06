/**
 * Spec 033 §1 mandatory fix — `PUT /api/tasks/:id/spec` (the manual "Save SPEC.md" button) had NO
 * turn-lock check, unlike `/reply`/`/confirm`/`PATCH /api/tasks/:id`. A race with ANY live turn (a
 * phase turn OR an Ask) risked silent last-writer-wins data loss, and specifically undermined Ask's
 * layer-2 byte-compare (a legitimate Save landing inside the Ask snapshot window would be misattributed
 * to the Ask and wrongly restored-over). This pins the identical `turnHolderId() === id` → 409 guard
 * `PATCH /api/tasks/:id` already has.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';
import { createTask } from '../server/state/task.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';

async function build(dir: string) {
  const app = Fastify();
  await app.register(uiRoutes, { projectsDir: dir, now: () => 0 });
  return app;
}

describe('PUT /api/tasks/:id/spec — turn-lock guard (spec 033 §1)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-lock-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('409s while ANY turn — including an Ask — is running for this task', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# original\n');

    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId, 'ask')); // an Ask holds the turn lock for this task
    try {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/tasks/${task.taskId}/spec`,
        payload: { content: 'edited while an Ask is live' },
      });
      assert.equal(res.statusCode, 409);
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });

  test('a normal phase-turn holder also 409s the same way', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# original\n');

    const app = await build(dir);
    assert.ok(acquireTurn(task.taskId)); // default kind: 'phase'
    try {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/tasks/${task.taskId}/spec`,
        payload: { content: 'edited mid-turn' },
      });
      assert.equal(res.statusCode, 409);
    } finally {
      releaseTurn(task.taskId);
    }
    await app.close();
  });

  test('saves fine once the lock is free', async () => {
    const task = await createTask(dir, { requirement: 'r' });
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# original\n');

    const app = await build(dir);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/tasks/${task.taskId}/spec`,
      payload: { content: 'a real edit' },
    });
    assert.equal(res.statusCode, 200);
    await app.close();
  });

  test("a DIFFERENT task's turn lock does not block this task's save", async () => {
    const task = await createTask(dir, { requirement: 'r' });
    const runDir = join(dir, `apps/builder/.runs/${task.taskId}`);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, 'SPEC.md'), '# original\n');

    const app = await build(dir);
    assert.ok(acquireTurn('some-other-task-id', 'ask'));
    try {
      const res = await app.inject({
        method: 'PUT',
        url: `/api/tasks/${task.taskId}/spec`,
        payload: { content: 'unaffected by a sibling task turn' },
      });
      assert.equal(res.statusCode, 200);
    } finally {
      releaseTurn('some-other-task-id');
    }
    await app.close();
  });
});

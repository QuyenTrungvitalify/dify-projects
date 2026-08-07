/**
 * GET /api/tasks/:id/uploads/:idx — serve back a file the user attached, so the chat history can show
 * it (before this route the composer's data-URL was the ONLY copy the browser ever had, and it died
 * with the message). Route-level via Fastify `inject` against a real temp run dir.
 *
 * The security-relevant assertions are the last three: the index addresses OUR recorded list (never a
 * caller path), a non-taskId id is rejected before any fs access, and a task.json whose attachment path
 * points OUTSIDE its own uploads/ dir is refused rather than read.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';

const TASK_ID = '1784212050777';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function mkFixture(attachments: string[]): { projectsDir: string; cleanup: () => void } {
  const projectsDir = mkdtempSync(join(tmpdir(), 'uploads-'));
  const runDir = join(projectsDir, 'apps/builder/.runs', TASK_ID);
  mkdirSync(join(runDir, 'uploads'), { recursive: true });
  writeFileSync(join(runDir, 'uploads', '0_shot.png'), PNG);
  writeFileSync(join(runDir, 'uploads', '1_notes.txt'), 'plain notes');
  writeFileSync(join(projectsDir, 'secret.txt'), 'NOT YOURS');
  writeFileSync(
    join(runDir, 'task.json'),
    JSON.stringify({
      taskId: TASK_ID,
      requirement: 'r',
      phase: 'spec',
      status: 'awaiting_confirm',
      confirmMode: 'each_step',
      attachments,
    }),
  );
  return { projectsDir, cleanup: () => rmSync(projectsDir, { recursive: true, force: true }) };
}

const REAL = [
  `apps/builder/.runs/${TASK_ID}/uploads/0_shot.png`,
  `apps/builder/.runs/${TASK_ID}/uploads/1_notes.txt`,
];

async function build(projectsDir: string) {
  const app = Fastify();
  await app.register(uiRoutes, { projectsDir, now: () => 0 });
  return app;
}

describe('GET /api/tasks/:id/uploads/:idx', () => {
  test('serves the image bytes with its real MIME (so the history <img> renders)', async () => {
    const fx = mkFixture(REAL);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/0` });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(res.headers['content-type'], 'image/png');
      assert.match(String(res.headers['content-disposition']), /inline; filename="0_shot\.png"/);
      assert.deepEqual(res.rawPayload, PNG);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('a non-image is served as octet-stream (no html-sniffing surface on user bytes)', async () => {
    const fx = mkFixture(REAL);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/1` });
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'application/octet-stream');
      assert.equal(res.rawPayload.toString(), 'plain notes');
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('an out-of-range index → 404; a non-numeric one → 400; an unknown task → 404', async () => {
    const fx = mkFixture(REAL);
    const app = await build(fx.projectsDir);
    try {
      assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/7` })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/x` })).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/-1` })).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: '/api/tasks/9999999999999/uploads/0' })).statusCode, 404);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('a crafted task id is rejected by isTaskId before any fs access', async () => {
    const fx = mkFixture(REAL);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/tasks/..%2f..%2fetc/uploads/0' });
      assert.equal(res.statusCode, 400);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('an attachment path pointing OUTSIDE the task uploads dir is refused, not read', async () => {
    // Only reachable via a hand-edited/corrupt task.json — the confinement check is what makes that
    // a 404 instead of an arbitrary-file read.
    const fx = mkFixture([`apps/builder/.runs/${TASK_ID}/uploads/../../../../secret.txt`]);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/uploads/0` });
      assert.equal(res.statusCode, 404);
      assert.doesNotMatch(res.body, /NOT YOURS/);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });
});

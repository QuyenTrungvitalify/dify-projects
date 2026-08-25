/**
 * GET /api/tasks/:id/workflow-path — the absolute path of a task's workflow YAML, as text.
 *
 * Backs the panel's "copy path" button. Reveal-in-Finder hands you the file in a GUI; this hands you the
 * string you paste into a terminal. Deliberately a separate READ-ONLY route rather than a flag on the
 * reveal POST: wanting the path is not wanting a window, and the first assertion here is that asking for
 * it spawns nothing (the reveal route's whole body is an `execFile`).
 *
 * Route-level via Fastify `inject` against a real temp projects dir — the path is computed server-side
 * from the task, so a unit test on `workflowPathFor` alone would not prove the route applies the same
 * confinement and the same on-disk precondition that reveal does.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';

const TASK_ID = '1784212050777';

/** A scaffolded task: project + slug set, and the YAML actually written. `onDisk: false` is the
 *  pre-Implement state — the task knows where the file WILL be, and nothing is there yet. */
function mkFixture(over: Record<string, unknown> = {}, onDisk = true): { projectsDir: string; cleanup: () => void } {
  const projectsDir = mkdtempSync(join(tmpdir(), 'wfpath-'));
  const runDir = join(projectsDir, 'apps/builder/.runs', TASK_ID);
  mkdirSync(runDir, { recursive: true });
  const task = {
    taskId: TASK_ID, requirement: 'r', phase: 'implement', status: 'awaiting_confirm',
    confirmMode: 'each_step', project: 'proj_a', workflowSlug: 'wf_1', workflowFile: 'main.yml',
    ...over,
  };
  if (onDisk && task.project && task.workflowSlug) {
    const wfDir = join(projectsDir, 'projects', String(task.project), String(task.workflowSlug), 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, String(task.workflowFile)), 'app:\n  mode: workflow\n');
  }
  writeFileSync(join(runDir, 'task.json'), JSON.stringify(task));
  return { projectsDir, cleanup: () => rmSync(projectsDir, { recursive: true, force: true }) };
}

async function build(projectsDir: string) {
  const app = Fastify();
  await app.register(uiRoutes, { projectsDir, now: () => 0 });
  return app;
}

describe('GET /api/tasks/:id/workflow-path', () => {
  test('returns the absolute path of the scaffolded workflow file', async () => {
    const fx = mkFixture();
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/workflow-path` });
      assert.equal(res.statusCode, 200, res.body);
      const { path } = res.json() as { path: string };
      // Absolute, and pointing at the file itself — not its folder, and not a repo-relative fragment.
      // A relative path is the failure that matters here: it looks right in the UI and is useless when
      // pasted anywhere but the repo root.
      assert.equal(path, join(fx.projectsDir, 'projects/proj_a/wf_1/workflows/main.yml'));
      assert.ok(path.startsWith('/'), 'must be absolute — the point of the button is pasting it elsewhere');
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('404 while the file is not on disk yet — the UI hides the button rather than offering a dead path', async () => {
    const fx = mkFixture({}, false);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/workflow-path` });
      assert.equal(res.statusCode, 404, res.body);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('404 pre-scaffold, when the task has no project/slug to build a path from', async () => {
    const fx = mkFixture({ project: null, workflowSlug: null }, false);
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: `/api/tasks/${TASK_ID}/workflow-path` });
      assert.equal(res.statusCode, 404, res.body);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('404 for an unknown task', async () => {
    const fx = mkFixture();
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/tasks/1999999999999/workflow-path' });
      assert.equal(res.statusCode, 404, res.body);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('a traversal id is rejected as malformed, before any fs access', async () => {
    // `isTaskId` is a confinement predicate, not a formatting one — the id reaches `join`.
    const fx = mkFixture();
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/tasks/..%2F..%2Fetc/workflow-path' });
      assert.equal(res.statusCode, 400, res.body);
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('the client cannot name the path — a query/body path is ignored, not echoed', async () => {
    // The whole reason reveal computes server-side. If this route ever grew a caller-supplied path it
    // would become an arbitrary-file discloser, so pin that a passed-in one changes nothing.
    const fx = mkFixture();
    const app = await build(fx.projectsDir);
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/tasks/${TASK_ID}/workflow-path?path=/etc/passwd`,
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal((res.json() as { path: string }).path, join(fx.projectsDir, 'projects/proj_a/wf_1/workflows/main.yml'));
    } finally {
      await app.close();
      fx.cleanup();
    }
  });

  test('asking for the path opens no window (it is a GET, and reveal is the only spawner)', async () => {
    // The distinction this route exists for. `revealInFileManager` is the only `execFile` on this path;
    // if someone later "simplifies" by routing this through reveal, a Finder window would open on every
    // panel render. Static, because intercepting the spawn would mean stubbing node:child_process for
    // the whole module graph.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '../server/routes/ui.ts'), 'utf8');
    const i = src.indexOf("'/api/tasks/:id/workflow-path'");
    assert.notEqual(i, -1, 'route moved — update this guard');
    const body = src.slice(i, src.indexOf('\n  });', i));
    assert.ok(!body.includes('revealInFileManager'), 'the path route must not spawn the file manager');
  });
});

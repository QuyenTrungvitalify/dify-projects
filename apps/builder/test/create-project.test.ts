/**
 * Spec 031 S1 — POST /api/projects (create an empty project tier) + the name-validation helper.
 *
 * Route-level via Fastify `inject` with the 013-D2 `runPython` seam faked (no real init_project.py spawn):
 * asserts the argv contract (`--kind project --name … --slug …`), the D3 charset/required rejections
 * (NO spawn), the D4 duplicate 409 (with `existing`), and the 500 on a non-zero scaffold. The helper
 * unit (`checkProjectName`) is asserted directly for its name→slug / reject mapping.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import uiRoutes from '../server/routes/ui.js';
import { checkProjectName } from '../server/lib/project-create.js';
import type { ShellResult } from '../server/lib/shell.js';

describe('checkProjectName (spec 031 D2/D3)', () => {
  test('valid English name → ok with normalized slug (lowercase, space→_)', () => {
    assert.deepEqual(checkProjectName('Eiken Grammar'), { ok: true, slug: 'eiken_grammar' });
    assert.deepEqual(checkProjectName('  TOEIC  '), { ok: true, slug: 'toeic' });
  });
  test('empty / whitespace-only → name_required', () => {
    for (const raw of ['', '   ']) assert.deepEqual(checkProjectName(raw), { ok: false, error: 'name_required' });
  });
  test('non-English / disallowed chars → name_charset (rejected, not coerced)', () => {
    for (const raw of ['英検', 'grammar!', '日本語ツール', '_leading'])
      assert.deepEqual(checkProjectName(raw), { ok: false, error: 'name_charset' });
  });
});

describe('POST /api/projects (spec 031 §1)', () => {
  let dir: string;
  let calls: Array<{ cwd: string; args: string[] }>;
  let nextCode: number;

  const fakeRunPython = async (cwd: string, args: string[]): Promise<ShellResult> => {
    calls.push({ cwd, args });
    return { code: nextCode, stdout: '', stderr: nextCode === 0 ? '' : 'boom' };
  };

  async function build() {
    const app = Fastify();
    await app.register(uiRoutes, { projectsDir: dir, now: () => 0, runPython: fakeRunPython });
    return app;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'proj-create-'));
    calls = [];
    nextCode = 0;
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('valid name → 200 { project, name } and the --kind project argv', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Eiken Grammar' } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { project: 'eiken_grammar', name: 'Eiken Grammar' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cwd, dir);
    assert.deepEqual(calls[0].args, [
      'tools/dify_base/init_project.py', '--non-interactive', '--kind', 'project',
      '--name', 'Eiken Grammar', '--slug', 'eiken_grammar', '--primary-lang', 'en',
    ]);
    await app.close();
  });

  test('non-English name → 400 name_charset with NO spawn', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '英検' } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'name_charset');
    assert.equal(calls.length, 0); // never coerced, never scaffolded
    await app.close();
  });

  test('missing name → 400 name_required, no spawn', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, 'name_required');
    assert.equal(calls.length, 0);
    await app.close();
  });

  test('duplicate (folder exists) → 409 { existing }, no spawn', async () => {
    await mkdir(join(dir, 'projects', 'eiken_grammar'), { recursive: true });
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Eiken Grammar' } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().existing, 'eiken_grammar');
    assert.equal(calls.length, 0);
    await app.close();
  });

  test('scaffold exit≠0 → 500 with the stderr tail', async () => {
    nextCode = 1;
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'Eiken' } });
    assert.equal(res.statusCode, 500);
    assert.match(res.json().error, /scaffold failed/);
    await app.close();
  });
});

describe('DELETE /api/projects/:project (spec 084 follow-up — delete a whole project)', () => {
  let dir: string;
  async function build() {
    const app = Fastify();
    await app.register(uiRoutes, { projectsDir: dir, now: () => 0, runPython: async () => ({ code: 0, stdout: '', stderr: '' }) });
    return app;
  }
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'proj-del-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function seedProjectWithTask(project: string, taskId: string): Promise<void> {
    await mkdir(join(dir, 'projects', project, 'wf', 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', project, 'wf', 'workflows', 'main.yml'), 'app:\n  name: X\n', 'utf8');
    await mkdir(join(dir, `apps/builder/.runs/${taskId}`), { recursive: true });
    await writeFile(join(dir, `apps/builder/.runs/${taskId}/task.json`),
      JSON.stringify({ taskId, kind: 'build', project, workflowSlug: 'wf', status: 'done', phase: 'test' }), 'utf8');
  }

  test('removes the project folder AND cascades its build records', async () => {
    const app = await build();
    const taskId = '1700000000009';
    await seedProjectWithTask('junk', taskId);
    assert.ok(existsSync(join(dir, 'projects', 'junk')));
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${taskId}`)));

    const res = await app.inject({ method: 'DELETE', url: '/api/projects/junk' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { ok: true, tasksRemoved: 1 });
    assert.ok(!existsSync(join(dir, 'projects', 'junk')), 'project folder removed');
    assert.ok(!existsSync(join(dir, `apps/builder/.runs/${taskId}`)), 'build record cascaded (no orphan)');
    await app.close();
  });

  test('refuses _drafts (400) and a missing project (404)', async () => {
    const app = await build();
    const drafts = await app.inject({ method: 'DELETE', url: '/api/projects/_drafts' });
    assert.equal(drafts.statusCode, 400, 'the scratch home is never deletable');
    const missing = await app.inject({ method: 'DELETE', url: '/api/projects/nope' });
    assert.equal(missing.statusCode, 404);
    await app.close();
  });
});

describe('DELETE /api/projects/:project/workflows/:workflow (spec 084 follow-up — delete a workflow/junk build)', () => {
  let dir: string;
  async function build() {
    const app = Fastify();
    await app.register(uiRoutes, { projectsDir: dir, now: () => 0, runPython: async () => ({ code: 0, stdout: '', stderr: '' }) });
    return app;
  }
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wf-del-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function seedWorkflowWithTask(project: string, workflow: string, taskId: string): Promise<void> {
    await mkdir(join(dir, 'projects', project, workflow, 'workflows'), { recursive: true });
    await writeFile(join(dir, 'projects', project, workflow, 'workflows', 'main.yml'), 'app:\n  name: X\n', 'utf8');
    await mkdir(join(dir, `apps/builder/.runs/${taskId}`), { recursive: true });
    await writeFile(join(dir, `apps/builder/.runs/${taskId}/task.json`),
      JSON.stringify({ taskId, kind: 'build', project, workflowSlug: workflow, status: 'done', phase: 'test' }), 'utf8');
  }

  test('removes a _drafts workflow folder + cascades its build; keeps a sibling workflow', async () => {
    const app = await build();
    await seedWorkflowWithTask('_drafts', 'junk_flow', '1700000000021');
    await seedWorkflowWithTask('_drafts', 'keep_flow', '1700000000022');

    const res = await app.inject({ method: 'DELETE', url: '/api/projects/_drafts/workflows/junk_flow' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { ok: true, tasksRemoved: 1 });
    assert.ok(!existsSync(join(dir, 'projects', '_drafts', 'junk_flow')), 'junk workflow folder removed');
    assert.ok(!existsSync(join(dir, 'apps/builder/.runs/1700000000021')), 'its build cascaded');
    assert.ok(existsSync(join(dir, 'projects', '_drafts', 'keep_flow')), 'sibling workflow untouched');
    assert.ok(existsSync(join(dir, 'apps/builder/.runs/1700000000022')), "sibling's build untouched");
    await app.close();
  });

  test('a missing workflow → 404', async () => {
    const app = await build();
    const res = await app.inject({ method: 'DELETE', url: '/api/projects/_drafts/workflows/nope' });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

describe('POST /api/tasks/:id/export-drive (spec 062 follow-up — upload dossier to Drive)', () => {
  let dir: string;
  async function build() {
    const app = Fastify();
    await app.register(uiRoutes, { projectsDir: dir, now: () => 0, runPython: async () => ({ code: 0, stdout: '', stderr: '' }) });
    return app;
  }
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'export-drive-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  test('no team Drive configured (no .dify-share.json / local override) → 409 so the FE downloads instead', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/tasks/1700000000001/export-drive' });
    assert.equal(res.statusCode, 409, res.body);
    assert.match(res.json().error, /no team Drive/);
    await app.close();
  });

  test('an invalid task id → 400 (never reaches the bundle)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/tasks/not-a-task/export-drive' });
    assert.equal(res.statusCode, 400);
    await app.close();
  });
});

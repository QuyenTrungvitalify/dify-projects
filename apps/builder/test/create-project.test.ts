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
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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

/**
 * GET /api/dev/build-info — which code is actually running (BUILDER_DEV only).
 *
 * WHY IT EXISTS. "Am I testing the branch I think I am?" had no answer inside the app, and getting it
 * wrong is expensive in a way that leaves no trace: the launcher used to `git checkout main` before
 * building, which succeeds SILENTLY on a clean tree — so a branch under test was rebuilt as main and
 * tested as main, and every conclusion from that session was about other code.
 *
 * What these tests pin is the CONTRACT, not the values: the field is named `gitBranch` (the dev panel
 * reads exactly that key, and a rename would blank the chip without failing anything), and a directory
 * that is not a git repo yields nulls rather than throwing — the panel must degrade to "no chip", never
 * to a broken page.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import devRoutes from '../server/routes/dev.js';
import { collectBuildInfo } from '../server/lib/build-info.js';

describe('GET /api/dev/build-info', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'buildinfo-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  async function serve(projectsDir: string) {
    const app = Fastify();
    await app.register(devRoutes, { builderDir: join(projectsDir, 'apps/builder'), port: 4123, projectsDir });
    return app;
  }

  test('answers with the keys the dev panel reads — gitBranch above all', async () => {
    const app = await serve(process.cwd()); // the real repo: git is present
    const res = await app.inject({ method: 'GET', url: '/api/dev/build-info' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok('gitBranch' in body, 'the dev panel reads `gitBranch` by name — a rename blanks the chip silently');
    assert.ok('gitSha' in body);
    assert.ok('builderVersion' in body);
    // Value, not shape: in CI HEAD may be detached, so only assert it is a string or null — never undefined.
    assert.ok(typeof body.gitBranch === 'string' || body.gitBranch === null);
    await app.close();
  });

  test('a directory that is not a git repo → nulls, not a throw (the chip just stays away)', async () => {
    const info = await collectBuildInfo(dir, [], 1_700_000_000_000);
    assert.equal(info.gitBranch, null);
    assert.equal(info.gitSha, null);
    assert.equal(info.exportedAt, 1_700_000_000_000, 'the caller stamps the time — it is not read from a clock here');
  });

  test('the route reads the REPO root, not the builder dir — the branch belongs to the repo', async () => {
    // `projectsDir` is the repo; `builderDir` is apps/builder inside it. Passing the wrong one would
    // still "work" today (git walks up) and would break the moment the builder is vendored elsewhere.
    const app = await serve(process.cwd());
    const viaRoute = (await app.inject({ method: 'GET', url: '/api/dev/build-info' })).json();
    const direct = await collectBuildInfo(process.cwd(), [], 0);
    assert.equal(viaRoute.gitBranch, direct.gitBranch);
    await app.close();
  });
});

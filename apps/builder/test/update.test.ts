/**
 * POST /api/update — the user-facing update & restart (in-app update-and-run.command).
 *
 * Route-level via Fastify `inject` with the runStep/schedule/busy seams faked (no real git/npm/kill):
 * asserts the step order + cwd contract (branch probe → [checkout main] → git pull --ff-only origin
 * main at the repo root → setup-node.sh), that HEAD already on main SKIPS the checkout, that a
 * failing checkout stops with step:'checkout' + git's reason and never pulls, that a failed step
 * reports {ok:false, step, log} WITHOUT scheduling the restart, that a clean run schedules the
 * restart with (builderDir, port), and both 409 guards.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import updateRoutes from '../server/routes/update.js';
import type { RunStep } from '../server/lib/self-update.js';

const REPO = '/repo';
const BUILDER = '/repo/apps/builder';

describe('POST /api/update', () => {
  let calls: Array<{ cmd: string; args: string[]; cwd: string }>;
  let scheduled: Array<{ builderDir: string; port: number }>;
  let failAt: 'checkout' | 'pull' | 'setup' | null;
  let busyFlag: boolean;
  let head: string; // what `git rev-parse --abbrev-ref HEAD` prints

  const fakeRun: RunStep = async (cmd, args, cwd) => {
    calls.push({ cmd, args, cwd });
    if (args[0] === 'rev-parse') return { ok: true, out: `${head}\n` };
    const step = args[0] === 'checkout' ? 'checkout' : cmd === 'git' ? 'pull' : 'setup';
    return failAt === step ? { ok: false, out: `${step} exploded\nlast line` } : { ok: true, out: 'fine' };
  };

  async function build(runStep: RunStep = fakeRun) {
    const app = Fastify();
    await app.register(updateRoutes, {
      repoDir: REPO,
      builderDir: BUILDER,
      port: 4123,
      runStep,
      schedule: (builderDir, port) => { scheduled.push({ builderDir, port }); },
      busy: () => busyFlag,
    });
    return app;
  }

  beforeEach(() => {
    calls = [];
    scheduled = [];
    failAt = null;
    busyFlag = false;
    head = 'main';
  });

  test('already on main → NO checkout, straight to pull then setup → schedules the restart', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), { ok: true, restarting: true });
    assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      ['bash', 'scripts/setup-node.sh'],
    ]);
    assert.ok(calls.every((c) => c.cwd === REPO), 'every step runs at the repo root');
    assert.deepEqual(scheduled, [{ builderDir: BUILDER, port: 4123 }]);
    await app.close();
  });

  test('on another branch → checkout main first, then the normal update', async () => {
    head = 'feature/x';
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.deepEqual(res.json(), { ok: true, restarting: true });
    assert.deepEqual(calls.map((c) => [c.cmd, ...c.args]), [
      ['git', 'rev-parse', '--abbrev-ref', 'HEAD'],
      ['git', 'checkout', 'main'],
      ['git', 'pull', '--ff-only', 'origin', 'main'],
      ['bash', 'scripts/setup-node.sh'],
    ]);
    await app.close();
  });

  test('checkout main fails (local edits) → step:checkout + git reason, NO pull, NO restart', async () => {
    head = 'feature/x';
    failAt = 'checkout';
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.step, 'checkout');
    assert.match(body.log, /checkout exploded/);
    assert.equal(calls.length, 2, 'stops at the checkout — the pull never runs');
    assert.equal(scheduled.length, 0);
    await app.close();
  });

  test('local edits while already on main → update proceeds (git alone decides)', async () => {
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.deepEqual(res.json(), { ok: true, restarting: true });
    assert.ok(!calls.some((c) => c.args[0] === 'checkout'), 'no checkout, no dirty preflight');
    await app.close();
  });

  test('git pull fails → {ok:false, step:pull, log tail}, NO setup, NO restart', async () => {
    failAt = 'pull';
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.ok, false);
    assert.equal(body.step, 'pull');
    assert.match(body.log, /last line/);
    assert.equal(calls.length, 2, 'stops at the first failure — setup never runs');
    assert.equal(scheduled.length, 0, 'a failed pull never restarts the server');
    await app.close();
  });

  test('setup fails → {ok:false, step:setup}, NO restart (the old server keeps serving)', async () => {
    failAt = 'setup';
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(res.json().step, 'setup');
    assert.equal(scheduled.length, 0);
    await app.close();
  });

  test('a live turn → 409 turn_running, nothing runs', async () => {
    busyFlag = true;
    const app = await build();
    const res = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().reason, 'turn_running');
    assert.equal(calls.length, 0);
    await app.close();
  });

  test('a second POST while one is in flight → 409 update_running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slowRun: RunStep = async (cmd, args, cwd) => {
      calls.push({ cmd, args, cwd });
      await gate; // hold the first update mid-step
      return { ok: true, out: '' };
    };
    const app = await build(slowRun);
    const first = app.inject({ method: 'POST', url: '/api/update' });
    await new Promise((r) => setTimeout(r, 20)); // let the first request enter the step
    const second = await app.inject({ method: 'POST', url: '/api/update' });
    assert.equal(second.statusCode, 409);
    assert.equal(second.json().reason, 'update_running');
    release();
    assert.equal((await first).statusCode, 200);
    await app.close();
  });
});

/**
 * Spec 090 S1 — POST /api/tasks refuses a nonexistent edit-existing TARGET at the door (400, no
 * task minted, no turn burned). Regression body is the VERBATIM shape of the field failure
 * (bundle builder-unsaved-1785901684698: sidebar's synthetic "(unsaved)" row → phantom build →
 * deterministic ② death, reproduced as run 1785916628346).
 *
 * Trick for the allowed-path cases: the turn lock is pre-acquired, so a request that PASSES the
 * guard hits the busy-check and returns 409 — proving "guard let it through" without dispatching
 * any phase machinery (and proving the guard runs BEFORE the busy-check for the refused shape).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';

const LOCK_HOLDER = 'phantom-guard-test';

describe('POST /api/tasks — phantom edit-target guard (spec 090 S1)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'phantom-'));
    await mkdir(join(dir, 'projects', 'p1', 'wf'), { recursive: true }); // one REAL workflow
    app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '' };
    await app.register(tasksRoutes, opts);
    // Hold the turn lock: allowed requests 409 instead of dispatching (no phase machinery needed).
    assert.equal(acquireTurn(LOCK_HOLDER), true);
  });
  afterEach(async () => {
    releaseTurn(LOCK_HOLDER);
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const post = (body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/tasks', payload: { requirement: 'r', ...body } });

  test('the field-failure body verbatim → 400 BEFORE the busy-check, names the workflow', async () => {
    const res = await post({ workflow: '(unsaved)', project: '_drafts' });
    assert.equal(res.statusCode, 400, res.body); // NOT 409 — the guard runs before busy/mint
    assert.match(res.json().error, /"\(unsaved\)" does not exist/);
  });

  test('phantom target + attached YAML → the message routes the user to Import base', async () => {
    const res = await post({
      workflow: 'ghost',
      files: [{ name: 'exported.yml', mime: 'application/yaml', bytesBase64: 'eA==' }],
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /Import base/);
  });

  test('phantom target, no attachment → plain unselect guidance (no Import-base detour)', async () => {
    const res = await post({ workflow: 'ghost' });
    assert.equal(res.statusCode, 400);
    assert.match(res.json().error, /may have been removed/);
    assert.ok(!res.json().error.includes('Import base'));
  });

  test('EXISTING target → passes the guard (409 from the held lock, not 400)', async () => {
    const res = await post({ workflow: 'wf', project: 'p1' });
    assert.equal(res.statusCode, 409, res.body);
  });

  test("from-scratch (workflow 'none' / absent) → untouched (409 from the held lock)", async () => {
    for (const body of [{ workflow: 'none' }, {}]) {
      const res = await post(body);
      assert.equal(res.statusCode, 409, res.body);
    }
  });

  test('slug is NAMING, not targeting — a not-yet-existing slug passes (409, not 400)', async () => {
    const res = await post({ slug: 'brand_new_name', project: 'p1' });
    assert.equal(res.statusCode, 409, res.body);
  });
});

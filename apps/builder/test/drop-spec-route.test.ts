/**
 * Spec 105 — 「やめる」 has to work from the surface a human actually touches.
 *
 * `confirmAdvance` places `drop_spec` ABOVE its own `awaiting_confirm` guard on purpose: dropping a
 * proposal runs no turn, and the case it exists for is precisely a revise turn that DIED (observed
 * live on task 1787220388060, a usage limit). The route had a status guard of its own, and it fired
 * first — so the button rendered, and answered `task is error, not awaiting_confirm`.
 *
 * That left the build genuinely stuck: `PUT /spec` also refuses while `specRevise` is set, so the only
 * ways out were spending another turn (Retry) or discarding the whole build — the two costs the escape
 * hatch was added to avoid.
 *
 * These fire through `POST /api/tasks/:id/confirm`, not through `confirmAdvance`. The existing unit
 * tests call the orchestrator directly and stayed green throughout, which is the same failure this
 * branch already recorded once: a guard is only proven by the entry point that reaches it.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { computeGate } from '../server/lib/gate.js';
import { saveTask, loadTask, type Task } from '../server/state/task.js';
import { specNextRel } from '../server/lib/diff.js';
import { buildTurnBusy } from '../server/lib/lock.js';

/** The route dispatches the work in the background and holds the turn lock until it settles. */
async function settled(): Promise<void> {
  for (let i = 0; i < 200 && buildTurnBusy(); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(buildTurnBusy(), false, 'the dispatched work finished');
}

const TASK_ID = '1780000000222';

describe('POST /confirm — dropping a plan works from an errored gate (spec 105)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  /** A revise turn that died with the draft still open — exactly the observed shape. */
  async function erroredRevise(over: Partial<Task> = {}): Promise<Task> {
    const task = {
      taskId: TASK_ID, kind: 'build', project: '_drafts', workflowSlug: 'wf', workflowFile: 'main.yml',
      requirement: 'x', phase: 'spec', status: 'error', error: 'usage limit reached',
      specRevise: true,
      // Where the human was standing when they asked for a plan — what the drop restores.
      specReviseFrom: { phase: 'test', status: 'done', gate: undefined },
      sessionIds: {}, artifacts: {}, deploy: 'none', testMode: 'static',
      confirmMode: 'each_step', fastMode: false, seedPath: null, seedAppId: null,
      appId: null, appUrl: null, workflow: null, name: null,
      ...over,
    } as unknown as Task;
    task.gate = computeGate('spec', { outcome: 'error' }, task.deploy, {}, { specRevise: true });
    await writeFile(join(dir, specNextRel(task)), '# draft\n');
    await saveTask(dir, task);
    return task;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drop-spec-'));
    await mkdir(join(dir, 'projects', '_drafts', 'wf', 'workflows'), { recursive: true });
    await mkdir(join(dir, 'apps', 'builder', '.runs', TASK_ID), { recursive: true });
    await writeFile(join(dir, 'projects/_drafts/wf/SPEC.md'), '# Spec\n');
    app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '' };
    await app.register(tasksRoutes, opts);
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('the gate offers it, and clicking it actually works (it used to 409)', async () => {
    const task = await erroredRevise();
    assert.ok(task.gate?.actions.some((a) => a.id === 'drop_spec'), 'precondition: the button is there');

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/confirm`, payload: { actionId: 'drop_spec' } });

    assert.equal(res.statusCode, 200, 'the one confirm that must survive an errored phase');
    await settled();
    const after = await loadTask(dir, TASK_ID);
    assert.equal(after.specRevise, undefined, 'the proposal is gone');
    assert.equal(existsSync(join(dir, specNextRel(after))), false, 'and so is the draft');
    // Put back exactly where the human was standing, not at a recomputed gate.
    assert.equal(after.phase, 'test');
    assert.equal(after.status, 'done');
  });

  test('every OTHER confirm still refuses on an errored build', async () => {
    // The carve-out is for `drop_spec` alone: it runs no turn. Anything that would spend one must
    // still go through the Retry path, or the status guard would be decoration.
    await erroredRevise();

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/confirm`, payload: { actionId: 'apply_spec' } });

    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /not awaiting_confirm/);
    assert.equal((await loadTask(dir, TASK_ID)).specRevise, true, 'nothing was dropped');
  });

  test('an id off the wire cannot force it — the gate must be offering it', async () => {
    // No proposal open ⇒ `drop_spec` is not on the gate ⇒ the carve-out must not apply, or a forged
    // POST would slip past the status guard on any errored build at all.
    const task = await erroredRevise({ specRevise: undefined });
    task.gate = computeGate('spec', { outcome: 'error' }, task.deploy);
    await saveTask(dir, task);

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/confirm`, payload: { actionId: 'drop_spec' } });

    assert.equal(res.statusCode, 409);
    assert.match(res.json().error, /not awaiting_confirm/);
  });
});

/**
 * Spec 105 — undo must not discard work it did not make.
 *
 * Undo restores into `projects/<project>/<slug>/`, a path SEVERAL tasks legitimately share: an
 * edit-existing build, a finished build reopened for a fix, two builds started against the same
 * workflow. The turn lock is per-TASK, so holding it proves nothing about who wrote there last.
 *
 * Lane B met this collision for its draft and solved it by putting the taskId in the SOURCE path
 * (`.runs/<taskId>/SPEC.next.md`). That trick cannot help a shared DESTINATION — hence a comparison
 * instead: the workflow on disk must still be byte-for-byte what THIS task's last Implement left.
 *
 * Before this guard the failure was silent and total: build A clicked Undo and build B's round
 * vanished, with a 200 and a cheerful card.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import tasksRoutes, { type TasksRoutesOptions } from '../server/routes/tasks.js';
import { snapshotDiffBase, snapshotSpecBase } from '../server/lib/diff.js';
import { artifactHash } from '../server/lib/post-turn.js';
import { saveTask, type Task } from '../server/state/task.js';

const TASK_ID = '1780000000111';
const WF_REL = 'projects/_drafts/wf/workflows/main.yml';
const SPEC_REL = 'projects/_drafts/wf/SPEC.md';
const PRE_ROUND = 'workflow:\n  graph:\n    nodes: []\n';
const THIS_ROUND = 'workflow:\n  graph:\n    nodes: []\n# task A round\n';

describe('POST /api/tasks/:id/undo-fix — a shared workflow (spec 105)', () => {
  let dir: string;
  let app: Awaited<ReturnType<typeof Fastify>>;

  /** A task parked at the Implement gate with both pre-round snapshots taken, as a fix round leaves it. */
  async function armedTask(): Promise<Task> {
    const task = {
      taskId: TASK_ID, kind: 'build', project: '_drafts', workflowSlug: 'wf', workflowFile: 'main.yml',
      phase: 'implement', status: 'awaiting_confirm', requirement: 'x',
      sessionIds: {}, artifacts: {}, deploy: 'none', testMode: 'static',
      confirmMode: 'each_step', fastMode: false, seedPath: null, seedAppId: null,
      appId: null, appUrl: null, workflow: null, name: null,
    } as unknown as Task;
    await writeFile(join(dir, WF_REL), PRE_ROUND);
    await snapshotDiffBase(dir, task, { restart: true });
    await snapshotSpecBase(dir, task);
    // The round runs: the workflow moves, and the verify records the hash it left behind.
    await writeFile(join(dir, WF_REL), THIS_ROUND);
    task.artifactHash = await artifactHash(dir, WF_REL);
    task.fixUndoable = true;
    await saveTask(dir, task);
    return task;
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'undo-shared-'));
    await mkdir(join(dir, 'projects', '_drafts', 'wf', 'workflows'), { recursive: true });
    await writeFile(join(dir, SPEC_REL), '# Spec\n');
    app = Fastify();
    const opts: TasksRoutesOptions = { projectsDir: dir, settingsPath: '' };
    await app.register(tasksRoutes, opts);
  });
  afterEach(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('undo REFUSES when something else wrote the workflow, and touches nothing', async () => {
    await armedTask();
    // Another build finishes a round against the same workflow while this one sits parked.
    await writeFile(join(dir, WF_REL), 'workflow:\n  graph:\n    nodes: []\n# task B round\n');

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/undo-fix` });

    assert.equal(res.statusCode, 409, 'refuse rather than guess whose work this is');
    assert.match(res.json().error, /changed since this build last wrote it/);
    assert.match(await readFile(join(dir, WF_REL), 'utf8'), /task B round/, 'B’s work is intact');
  });

  test('undo still works when the workflow is exactly where this build left it', async () => {
    await armedTask(); // nobody else touched it

    const res = await app.inject({ method: 'POST', url: `/api/tasks/${TASK_ID}/undo-fix` });

    assert.equal(res.statusCode, 200);
    assert.equal(await readFile(join(dir, WF_REL), 'utf8'), PRE_ROUND, 'the round was taken back');
  });
});

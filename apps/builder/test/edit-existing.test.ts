/**
 * T?? — localEditSeed (GAP #14 fix): selecting an existing LOCAL workflow in the Workflow chip must
 * resolve into a real seed so Analyze summarizes it and the diff has a pre-edit base — instead of
 * silently building greenfield. Load-bearing cases: (1) the chosen workflow becomes task.workflowSlug
 * within its task.project (spec 030 — NOT a requirement-derived one), (2) the current workflow file is
 * snapshotted into an immutable .runs/<id>/seed.yml that becomes task.seedPath, (3) the snapshot is
 * idempotent (re-runs keep the TRUE pre-edit state), (4) a target with no workflow file degrades to
 * slug-only / empty seed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask } from '../server/state/task.js';
import { localEditSeed } from '../server/lib/orchestrator.js';

const noopLog = { info: () => {}, warn: () => {}, error: () => {} };
const ctxOf = (projectsDir: string) => ({ projectsDir, settingsPath: '', log: noopLog });

/** Make a temp projectsDir, optionally seeding projects/<project>/<workflow>/workflows/main.yml. */
function fixture(project: string | null, workflow: string | null, content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'edit-existing-'));
  if (project && workflow && content !== undefined) {
    const wf = join(dir, 'projects', project, workflow, 'workflows');
    mkdirSync(wf, { recursive: true });
    writeFileSync(join(wf, 'main.yml'), content);
  }
  return dir;
}

describe('localEditSeed (GAP #14 — spec 030 nested)', () => {
  test('targets the chosen {project, workflow} and snapshots the existing workflow as the seed', async () => {
    const dir = fixture('client_a', 'topic_summary', 'app:\n  name: original\n');
    const task = await createTask(dir, { requirement: 'add a translate step', workflow: 'topic_summary', project: 'client_a' });

    await localEditSeed(task, ctxOf(dir));

    // (1) workflowSlug + project = the target, not a requirement-derived slug
    assert.equal(task.workflowSlug, 'topic_summary');
    assert.equal(task.project, 'client_a');
    // (2) seedPath points at the immutable snapshot under .runs/<id>/
    assert.equal(task.seedPath, `apps/builder/.runs/${task.taskId}/seed.yml`);
    const snap = join(dir, task.seedPath!);
    assert.ok(existsSync(snap), 'snapshot file exists');
    assert.equal(readFileSync(snap, 'utf8'), 'app:\n  name: original\n', 'snapshot == pre-edit content');
  });

  test('snapshot is idempotent — a re-run keeps the TRUE pre-edit state', async () => {
    const dir = fixture('client_a', 'wf_x', 'v: 1\n');
    const task = await createTask(dir, { requirement: 'edit', workflow: 'wf_x', project: 'client_a' });

    await localEditSeed(task, ctxOf(dir));
    // Simulate Implement (or a manual change) overwriting the live workflow between /reply re-runs.
    writeFileSync(join(dir, 'projects/client_a/wf_x/workflows/main.yml'), 'v: 2 (post-edit)\n');
    await localEditSeed(task, ctxOf(dir)); // re-run must NOT re-snapshot the now-changed file

    assert.equal(readFileSync(join(dir, task.seedPath!), 'utf8'), 'v: 1\n', 'seed stays the pre-edit version');
  });

  test('target with no workflow file → slug set, seed left empty (from-scratch into the workflow)', async () => {
    const dir = fixture(null, null); // no seeded workflow file
    const task = await createTask(dir, { requirement: 'edit', workflow: 'missing_target', project: 'client_a' });

    await localEditSeed(task, ctxOf(dir));

    assert.equal(task.workflowSlug, 'missing_target', 'still targets the chosen workflow');
    assert.equal(task.project, 'client_a');
    assert.equal(task.seedPath, null, 'no seed when the target has no workflow file');
  });
});

/**
 * Spec 090 S4 — {{SPEC_PATH}}: ② is handed the RESOLVED SPEC.md path as a value, never a condition.
 * The old two-branch rule in spec.md survived token substitution as the ambiguous sentence
 * "if `<slug>` is empty", and on a slug-set-but-folder-missing task both observed agents resolved
 * it by looking at the DISK → wrote to `.runs/` → `artifact missing` (runs 1785901684698 +
 * 1785916628346). These pin the one invariant that kills the class: SPEC_PATH === artifactRel for
 * every task shape, so what the turn is told to write is BYTE-EQUAL to what verify will stat.
 * Pure unit over `PHASES[spec]` (the pattern-path.test.ts precedent) — no claude/python/Dify.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PHASES } from '../server/lib/phases.js';
import type { Task } from '../server/state/task.js';

const SPEC = PHASES.find((p) => p.id === 'spec')!;

const t = (over: Partial<Task>): Task =>
  ({
    taskId: '1785916628346',
    project: null,
    workflowSlug: null,
    workflow: null,
    workflowFile: 'main.yml',
    requirement: 'r',
    seedPath: null,
    seedAppId: null,
    deploy: 'none',
    testMode: 'static',
    appId: null,
    appUrl: null,
    confirmMode: 'auto',
    fastMode: false,
    phase: 'spec',
    status: 'running',
    name: null,
    sessionIds: {},
    artifacts: {},
    ...over,
  }) as Task;

describe('{{SPEC_PATH}} — resolved ② output path (spec 090 S4)', () => {
  test('pre-slug (from-scratch): SPEC_PATH is the run-dir path', () => {
    const v = SPEC.injectVars(t({}));
    assert.equal(v.SPEC_PATH, 'apps/builder/.runs/1785916628346/SPEC.md');
  });

  test('slug set (edit-existing / phantom alike): SPEC_PATH is the projects path', () => {
    // The phantom shape (folder missing on disk) gets the SAME value — the path is a fact about
    // the TASK, never about the disk. S3 (salvage) and S1 (route guard) own the disk side.
    const v = SPEC.injectVars(t({ project: '_drafts', workflowSlug: 'unsaved' }));
    assert.equal(v.SPEC_PATH, 'projects/_drafts/unsaved/SPEC.md');
  });

  test('SPEC_PATH === artifactRel for every shape — told-to-write ≡ verified', () => {
    for (const task of [
      t({}),
      t({ project: '_drafts', workflowSlug: 'unsaved' }),
      t({ project: 'p1', workflowSlug: 'wf', workflow: 'wf' }),
      t({ fastMode: true }), // fast pre-slug (draft.md turn) — same run-dir path
      t({ project: 'p1', workflowSlug: null }), // project without slug → still pre-slug (workflowDir needs BOTH)
    ]) {
      assert.equal(SPEC.injectVars(task).SPEC_PATH, SPEC.artifactRel(task));
    }
  });
});

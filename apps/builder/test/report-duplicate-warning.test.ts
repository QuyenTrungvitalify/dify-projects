/**
 * Spec 014 D7 — the edit-existing duplicate warning must reach a CLOUD or NONE build, not only the
 * selfhost push (`runImportAndFinish`). `editExistingDuplicateWarning` is the pure core `runReport`
 * folds into `report.json` notes (`opts.duplicateWarning ?? editExistingDuplicateWarning(task)`).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { editExistingDuplicateWarning } from '../server/lib/report.js';
import type { Task, Deploy } from '../server/state/task.js';

const mk = (over: Partial<Task>): Task =>
  ({
    taskId: '1', project: null, workflowSlug: null, workflow: null, workflowFile: 'main.yml', requirement: 'r',
    seedPath: null, seedAppId: null, deploy: 'none', confirmMode: 'each_step', phase: 'test',
    status: 'running', name: 'n', sessionIds: {}, artifacts: {}, ...over,
  }) as Task;

describe('editExistingDuplicateWarning (014 D7)', () => {
  test('cloud + edit-existing → warns', () => {
    const w = editExistingDuplicateWarning(mk({ workflow: 'my_flow', deploy: 'cloud' }));
    assert.match(w ?? '', /NEW app/);
    assert.match(w ?? '', /my_flow/);
  });

  test('none + edit-existing → warns (a later import would still duplicate)', () => {
    const w = editExistingDuplicateWarning(mk({ workflow: 'my_flow', deploy: 'none' }));
    assert.match(w ?? '', /duplicate/i);
  });

  test('from-scratch build (no workflow) → no warning, on any deploy', () => {
    for (const deploy of ['none', 'cloud', 'selfhost'] as Deploy[]) {
      assert.equal(editExistingDuplicateWarning(mk({ workflow: null, deploy })), null);
    }
  });

  test('selfhost is NOT auto-warned here (the importer adds the post-push warning with app-url context)', () => {
    assert.equal(editExistingDuplicateWarning(mk({ workflow: 'my_flow', deploy: 'selfhost' })), null);
  });
});

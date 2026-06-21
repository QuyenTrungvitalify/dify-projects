/**
 * Spec 015 D5 (S4) — isValidWorkflowFile: a workflowFile must be a safe `*.yml`/`*.yaml` basename. It
 * flows into `sync.py push --file workflows/<file>` at ④ (backend, outside the turn), so a `../` would
 * escape projects/<slug>/. Q5: every real workflow name passes; only traversal/non-yaml is rejected.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isValidWorkflowFile } from '../server/state/task.js';

describe('isValidWorkflowFile', () => {
  test('accepts real workflow basenames', () => {
    for (const ok of ['main.yml', 'main.yaml', 'chatflow.yml', 'app-name-slug.yml', 'my_workflow.yaml', 'a.yml', 'v0.6.0-flow.yml']) {
      assert.equal(isValidWorkflowFile(ok), true, ok);
    }
  });

  test('rejects path traversal + separators', () => {
    for (const bad of ['../../etc/passwd', '../x/main.yml', 'a/main.yml', '/abs/main.yml', '..\\main.yml', 'projects/x/main.yml']) {
      assert.equal(isValidWorkflowFile(bad), false, bad);
    }
  });

  test('rejects a non-yaml or empty name and a sneaky `..` within the charset', () => {
    for (const bad of ['main.txt', 'main', '.env', 'main.yml.txt', '', 'main..yml', '...yml']) {
      assert.equal(isValidWorkflowFile(bad), false, bad);
    }
  });
});

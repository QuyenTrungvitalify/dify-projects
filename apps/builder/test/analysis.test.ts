/**
 * Spec 019 O2 — analyze.json → task pattern/features + the pattern-coverage advisory. Feature truth is
 * the committed tools/dify_base/index.json (the same data find.py queries), so these run against the
 * real index. The advisory is ADVISORY: it never throws/fails a build, it only annotates the task.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patternFeatures, patternAdvisory, applyAnalysisToTask } from '../server/lib/analysis.js';
import type { Task } from '../server/state/task.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('patternFeatures (019 O2)', () => {
  test('reads a pattern feature-set from index.json (agent-with-tools provides agent, not iteration)', () => {
    const f = patternFeatures(REPO, 'agent-with-tools');
    assert.ok(f, 'agent-with-tools must be indexed');
    assert.ok(f!.has('agent'));
    assert.ok(!f!.has('iteration'));
  });
  test('accepts the name with or without .yml', () => {
    assert.ok(patternFeatures(REPO, 'agent-with-tools.yml')?.has('agent'));
  });
  test('custom / unindexed pattern → null (no ⊇ check)', () => {
    assert.equal(patternFeatures(REPO, 'custom'), null);
    assert.equal(patternFeatures(REPO, '__not_a_pattern__'), null);
    assert.equal(patternFeatures(REPO, ''), null);
  });
});

describe('patternAdvisory (019 O2)', () => {
  test('a needed feature the pattern lacks → advisory naming it', () => {
    const a = patternAdvisory(REPO, 'agent-with-tools', ['iteration']);
    assert.ok(a && /iteration/.test(a), `expected an advisory mentioning iteration, got: ${a}`);
  });
  test('all needed features covered → no advisory', () => {
    assert.equal(patternAdvisory(REPO, 'agent-with-tools', ['agent']), null);
  });
  test('no needed features / custom pattern → no advisory', () => {
    assert.equal(patternAdvisory(REPO, 'agent-with-tools', []), null);
    assert.equal(patternAdvisory(REPO, 'agent-with-tools', undefined), null);
    assert.equal(patternAdvisory(REPO, 'custom', ['iteration']), null);
  });
});

describe('applyAnalysisToTask (019 O2)', () => {
  test('folds pattern/features/find_query onto the task + sets the advisory on a gap', () => {
    const task = {} as Task;
    applyAnalysisToTask(
      task,
      JSON.stringify({ pattern: 'agent-with-tools', features: ['iteration'], find_query: 'find.py --has iteration' }),
      REPO
    );
    assert.equal(task.analysisPattern, 'agent-with-tools');
    assert.deepEqual(task.analysisFeatures, ['iteration']);
    assert.equal(task.analysisFindQuery, 'find.py --has iteration');
    assert.ok(task.patternAdvisory && /iteration/.test(task.patternAdvisory));
  });

  test('covered features → no advisory set', () => {
    const task = {} as Task;
    applyAnalysisToTask(task, JSON.stringify({ pattern: 'agent-with-tools', features: ['agent'] }), REPO);
    assert.equal(task.analysisPattern, 'agent-with-tools');
    assert.equal(task.patternAdvisory, undefined);
  });

  test('back-compat: a minimal/old analyze.json (no pattern/features) leaves fields unset', () => {
    const task = {} as Task;
    applyAnalysisToTask(task, JSON.stringify({ seed: null }), REPO);
    assert.equal(task.analysisPattern, undefined);
    assert.equal(task.analysisFeatures, undefined);
    assert.equal(task.patternAdvisory, undefined);
  });

  test('custom pattern with needed features → recorded, but no advisory', () => {
    const task = {} as Task;
    applyAnalysisToTask(task, JSON.stringify({ pattern: 'custom', features: ['iteration'] }), REPO);
    assert.equal(task.analysisPattern, 'custom');
    assert.equal(task.patternAdvisory, undefined);
  });

  test('invalid JSON throws (caller keeps its "analyze.json invalid JSON" error path)', () => {
    assert.throws(() => applyAnalysisToTask({} as Task, '{not json', REPO));
  });
});

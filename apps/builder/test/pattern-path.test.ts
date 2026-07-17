/**
 * Spec 065 — `{{PATTERN_PATH}}`: hand ③ the path of the pattern ① already chose, instead of making the
 * turn hunt the filesystem for it (measured on run 1784185934247: 18 of 32 tool calls, 8 of them
 * failing, spent locating a file the backend already knew).
 *
 * Pure unit over the one public seam (`PHASES[implement].injectVars`) — no claude/python/Dify. Guards
 * the branches that decide whether implement.md reads a file or starts searching:
 *   - a named pattern → a real repo-relative path (the whole point);
 *   - `custom` / absent / blank → '' (implement.md keeps today's find.py fallback — no regression);
 *   - `.yml` normalization (analyze.json may carry either form — mirrors analysis.ts);
 *   - the "every known token is always substituted" contract holds for the NEW token too, on every
 *     turn phase (a missing key would leave a literal `{{PATTERN_PATH}}` in a rendered prompt).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';

const implVars = (t: Task): Record<string, string> =>
  PHASES.find((p) => p.id === 'implement')!.injectVars(t);

async function mkTask(patch: Partial<Task> = {}): Promise<Task> {
  const dir = mkdtempSync(join(tmpdir(), 'patternpath-'));
  const t = await createTask(dir, { requirement: 'summarize a page', confirmMode: 'each_step' });
  return Object.assign(t, { project: 'p', workflowSlug: 'w' }, patch) as Task;
}

describe('spec 065 — {{PATTERN_PATH}} injection', () => {
  test('a named pattern resolves to its repo-relative path', async () => {
    const t = await mkTask({ analysisPattern: 'scheduled-fetch-notify' });
    assert.equal(implVars(t).PATTERN_PATH, 'templates/patterns/scheduled-fetch-notify.yml');
  });

  test('an already-suffixed pattern is not double-suffixed', async () => {
    const t = await mkTask({ analysisPattern: 'per-row-notify.yml' });
    assert.equal(implVars(t).PATTERN_PATH, 'templates/patterns/per-row-notify.yml');
  });

  test("`custom` yields '' — implement.md keeps the find.py fallback", async () => {
    const t = await mkTask({ analysisPattern: 'custom' });
    assert.equal(implVars(t).PATTERN_PATH, '');
  });

  test("an absent pattern yields '' (pre-065 task.json / fast build)", async () => {
    const t = await mkTask({ analysisPattern: undefined });
    assert.equal(implVars(t).PATTERN_PATH, '');
  });

  test("a blank/whitespace pattern yields '' rather than a path to nowhere", async () => {
    const t = await mkTask({ analysisPattern: '   ' });
    assert.equal(implVars(t).PATTERN_PATH, '');
  });

  // `analysisPattern` is model-authored (analyze.json) from a turn that reads an untrusted seed, and
  // implement.md tells ③ to open PATTERN_PATH *without searching* — so a traversal would be handed
  // straight to the turn. Every rejected shape must degrade to '' (the find.py branch), never a path.
  for (const evil of [
    '../../../../etc/passwd',
    '../../.env',
    'a/../../b',
    'templates/patterns/x.yml',
    '/etc/passwd',
    '..',
    'x.yml; rm -rf /',
    'x$(whoami).yml',
    'pat tern.yml',
  ]) {
    test(`rejects untrusted pattern name: ${JSON.stringify(evil)}`, async () => {
      const t = await mkTask({ analysisPattern: evil });
      assert.equal(implVars(t).PATTERN_PATH, '', 'must not build a path out of untrusted input');
    });
  }

  // Guards a bug this test caught: the allowlist once accepted `.yaml` while the suffix step only knew
  // `.yml`, so `x.yaml` became `x.yaml.yml` — a path to nowhere handed to a turn told not to search.
  test("a .yaml name yields '' rather than a double-suffixed path to nowhere", async () => {
    const t = await mkTask({ analysisPattern: 'per_row_notify.yaml' });
    assert.equal(implVars(t).PATTERN_PATH, '');
  });

  test('every real pattern on disk survives the allowlist', async () => {
    for (const real of [
      'scheduled-fetch-notify', 'per-row-notify-excel', 'multi-step-llm', 'rag-qa',
      'file-to-llm', 'agent-with-tools', 'file-iteration', 'meta-workflow-builder',
    ]) {
      const t = await mkTask({ analysisPattern: real });
      assert.equal(implVars(t).PATTERN_PATH, `templates/patterns/${real}.yml`, real);
    }
  });

  test('always-substituted contract: every turn phase carries the key', async () => {
    const t = await mkTask({ analysisPattern: 'rag-qa' });
    for (const p of PHASES.filter((x) => x.kind === 'turn')) {
      assert.ok(
        'PATTERN_PATH' in p.injectVars(t),
        `${p.id} must carry PATTERN_PATH or the rendered prompt keeps a literal {{PATTERN_PATH}}`,
      );
    }
  });
});

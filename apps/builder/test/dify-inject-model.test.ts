/**
 * Spec 057 S4 — deployWithModel parses the `inject-model` JSON (sync.py's last stdout line):
 *   • `entry_types` → DeployResult.entryTypes (['start'] | ['trigger-schedule'] | …).
 *   • ABSENT `entry_types` (an older sync.py) → entryTypes undefined — callers assume a start
 *     entry (the llm_count graceful-degrade precedent, spec 043).
 * Driven with a `.venv/bin/python` shim that prints a canned JSON line (the report-plugin-todo
 * shim precedent) — no real sync.py / Dify involved.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployWithModel } from '../server/lib/dify-io.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A projectsDir whose `.venv/bin/python` shim prints `json` (the inject-model last-line output). */
function shimDir(json: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'inject-model-'));
  dirs.push(dir);
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), `#!/usr/bin/env bash\necho '${JSON.stringify(json)}'\n`, { mode: 0o755 });
  return dir;
}

const MODEL = { provider: 'p', name: 'gpt-mini' };

describe('deployWithModel — inject-model JSON parse (spec 057 S4)', () => {
  test('entry_types is parsed into entryTypes (trigger-entry workflow)', async () => {
    const dir = shimDir({
      node_count: 0, llm_count: 0, patched: [], out: 'o.yml', inputs: [], mode: 'workflow',
      entry_types: ['trigger-schedule'],
    });
    const dep = await deployWithModel(dir, 'src.yml', 'o.yml', MODEL, []);
    assert.equal(dep.ok, true);
    assert.deepEqual(dep.entryTypes, ['trigger-schedule']);
    assert.equal(dep.llmCount, 0);
    assert.equal(dep.mode, 'workflow');
  });

  test('a start workflow carries entry_types:["start"] verbatim', async () => {
    const dir = shimDir({
      node_count: 1, llm_count: 1, patched: ['n1'], out: 'o.yml', inputs: [], mode: 'workflow',
      entry_types: ['start'],
    });
    const dep = await deployWithModel(dir, 'src.yml', 'o.yml', MODEL, ['gpt-mini']);
    assert.deepEqual(dep.entryTypes, ['start']);
  });

  test('ABSENT entry_types (older sync.py) → undefined — graceful degrade, callers assume start', async () => {
    const dir = shimDir({
      node_count: 1, llm_count: 1, patched: ['n1'], out: 'o.yml', inputs: [], mode: 'workflow',
    });
    const dep = await deployWithModel(dir, 'src.yml', 'o.yml', MODEL, []);
    assert.equal(dep.ok, true);
    assert.equal(dep.entryTypes, undefined);
    // the llm_count precedent fields still parse alongside
    assert.equal(dep.llmCount, 1);
    assert.deepEqual(dep.patched, ['n1']);
  });
});

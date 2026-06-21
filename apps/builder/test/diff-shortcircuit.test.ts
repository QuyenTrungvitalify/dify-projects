/**
 * Spec 017 D7 — `writeDiffArtifact` short-circuits the python `difflib` spawn when the produced
 * workflow is byte-unchanged since the last diff write (a no-op /reply re-Implement). The diff base
 * is fixed per task, so the produced file's content hash alone decides whether to recompute.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDiffArtifact } from '../server/lib/diff.js';
import { createTask } from '../server/state/task.js';

const SLUG = 'wf_diff_sc';
let dir: string;

/** A `.venv/bin/python` shim: the `-c difflib` probe prints a fixed unified diff (so produceDiff runs). */
const SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then printf '%s\\n' '--- a' '+++ b' '@@'; exit 0; fi
exit 0
`;

function seedWorkflow(content: string): void {
  const wf = join(dir, 'projects', SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'diff-sc-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeDiffArtifact short-circuit (017 D7)', () => {
  test('unchanged workflow → reuses diff.json (no recompute); changed workflow → recomputes', async () => {
    seedWorkflow('version: 0.6.0\n# A\n');
    const task = await createTask(dir, { requirement: 'x', slug: SLUG, deploy: 'none' });

    const rel = await writeDiffArtifact(dir, task);
    const abs = join(dir, rel);
    assert.ok(existsSync(abs), 'first compute wrote diff.json');
    assert.ok(existsSync(join(dir, `apps/builder/.runs/${task.taskId}/diff.hash`)), 'sidecar hash written');

    // Mark diff.json with a sentinel; an unchanged second call must NOT overwrite it (short-circuit).
    writeFileSync(abs, JSON.stringify({ sentinel: true }));
    await writeDiffArtifact(dir, task);
    assert.deepEqual(JSON.parse(readFileSync(abs, 'utf8')), { sentinel: true }, 'unchanged → reused, not recomputed');

    // Change main.yml → the hash differs → recompute → the sentinel is replaced by a real payload.
    seedWorkflow('version: 0.6.0\n# B (changed)\n');
    await writeDiffArtifact(dir, task);
    const after = JSON.parse(readFileSync(abs, 'utf8'));
    assert.equal(after.sentinel, undefined, 'changed → recomputed');
    assert.ok('path' in after && 'diff' in after, 'recompute wrote a {path,diff} payload');
  });
});

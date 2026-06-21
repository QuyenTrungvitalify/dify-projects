/**
 * Spec 017 D2 — the `unresolved_plugin_todo` advisory.
 *
 * A workflow that still ships `dependencies: []` + a `# TODO: add plugin hash` marker lints CLEAN
 * (an empty `dependencies` is valid format) yet fails a selfhost/cloud import for the missing plugin.
 * `runReport` records it as `report.unresolved_plugin_todo` + a NOTE — and it must NEVER flip
 * `lintClean` (so it can't block a `none` build). This pins the pure detector + that invariant.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hasUnresolvedPluginTodo, runReport } from '../server/lib/report.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

describe('hasUnresolvedPluginTodo (pure)', () => {
  test('empty dependencies + a TODO plugin-hash comment → true', () => {
    assert.equal(
      hasUnresolvedPluginTodo('dependencies: []\n# TODO: add plugin hash from target workspace\n'),
      true
    );
  });
  test('no TODO marker → false (a real, clean workflow)', () => {
    assert.equal(hasUnresolvedPluginTodo('dependencies: []\nworkflow: {}\n'), false);
  });
  test('a TODO without both "plugin" and "hash" → false (not the convention marker)', () => {
    assert.equal(hasUnresolvedPluginTodo('dependencies: []\n# TODO: rename this node\n'), false);
  });
  test('populated dependencies → false even with a stale TODO comment (hash was filled in)', () => {
    const yaml =
      'dependencies:\n- type: marketplace\n  value:\n    marketplace_plugin_unique_identifier: a/b:0.0.1@' +
      'a'.repeat(64) +
      '\n# TODO: add plugin hash\n';
    assert.equal(hasUnresolvedPluginTodo(yaml), false);
  });
});

// ── runReport integration: the advisory rides along but never flips lintClean ───────────────────

const SLUG = 'wf_plugin_todo';
let dir: string;

/** A `.venv/bin/python` shim that makes every linter exit 0 → lintClean is driven only by the codes. */
const SHIM = '#!/usr/bin/env bash\nexit 0\n';

function seedWorkflow(content: string): void {
  const wf = join(dir, 'projects', SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), content);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plugin-todo-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('runReport — D2 advisory', () => {
  test('unresolved TODO → report flags it + notes it, but lintClean stays true (cannot block none)', async () => {
    seedWorkflow('dependencies: []\n# TODO: add plugin hash from target workspace\n');
    const task = await createTask(dir, { requirement: 'x', slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true, 'the advisory must NOT flip the lint verdict');
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, true);
    assert.match(report.notes, /unresolved_plugin_todo/);
  });

  test('clean workflow → flag false, no advisory note', async () => {
    seedWorkflow('dependencies: []\nworkflow:\n  graph:\n    nodes: []\n');
    const task = await createTask(dir, { requirement: 'y', slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, false);
    assert.doesNotMatch(report.notes, /unresolved_plugin_todo/);
  });
});

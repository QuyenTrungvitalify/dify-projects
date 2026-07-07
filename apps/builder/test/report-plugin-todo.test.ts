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
  test('empty dependencies with an INLINE TODO plugin-hash comment → true (regression: inline form)', () => {
    assert.equal(
      hasUnresolvedPluginTodo('dependencies: []  # TODO: add plugin hash from target workspace\n'),
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

const PROJECT = 'proj_plugin_todo';
const SLUG = 'wf_plugin_todo';
let dir: string;

/** A `.venv/bin/python` shim that makes every linter exit 0 → lintClean is driven only by the codes. */
const SHIM = '#!/usr/bin/env bash\nexit 0\n';

function seedWorkflow(content: string): void {
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
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
    const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true, 'the advisory must NOT flip the lint verdict');
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, true);
    assert.match(report.notes, /unresolved_plugin_todo/);
  });

  test('clean workflow → flag false, no advisory note', async () => {
    seedWorkflow('dependencies: []\nworkflow:\n  graph:\n    nodes: []\n');
    const task = await createTask(dir, { requirement: 'y', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, true);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, false);
    assert.doesNotMatch(report.notes, /unresolved_plugin_todo/);
  });
});

// ── Spec 037 S1 (AC 4/4b): the runnability preflight in the ④ report ────────────────────────────
// ④ is backend (never the implement verify), so runReport RECOMPUTES the preflight on the same
// workflow text — a human's ③-gate edit followed by Confirm must not ship a STALE note.

const PREFLIGHT_SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then
  case "$2" in
    *runnability_facts*)
      [ -n "$PREFLIGHT_FACTS" ] && printf '%s' "$PREFLIGHT_FACTS" && exit 0
      exit 1 ;;
  esac
fi
exit 0
`;

describe('runReport — spec 037 preflight recompute (AC 4/4b)', () => {
  test('blockers present → the note leads into report.json.notes; existing D2 note byte-unchanged', async () => {
    writeFileSync(join(dir, '.venv', 'bin', 'python'), PREFLIGHT_SHIM, { mode: 0o755 });
    process.env.PREFLIGHT_FACTS = JSON.stringify({
      kind: 'runnability_facts',
      model_nodes: [{ id: 'n1', type: 'llm', empty: true }],
      code_nodes: [], kr_nodes: [],
    });
    try {
      seedWorkflow('dependencies: []\n# TODO: add plugin hash from target workspace\n');
      const task = await createTask(dir, { requirement: 'p', project: PROJECT, slug: SLUG, deploy: 'none' });
      const rep = await runReport(dir, task, log);
      const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
      assert.match(report.notes, /preflight: not runnable out-of-the-box/);
      assert.match(report.notes, /model fill \(llm n1/);
      // the D2 note's exact phrasing survives alongside (spec 037 AC 4)
      assert.match(report.notes, /unresolved_plugin_todo: dependencies are empty but a "# TODO add plugin hash" remains/);
      assert.equal(rep.lintClean, true, 'preflight can never flip the lint verdict');
    } finally {
      delete process.env.PREFLIGHT_FACTS;
    }
  });

  test('AC 4b: a STALE task.preflightNote is recomputed away when the workflow was fixed at the gate', async () => {
    writeFileSync(join(dir, '.venv', 'bin', 'python'), PREFLIGHT_SHIM, { mode: 0o755 });
    process.env.PREFLIGHT_FACTS = JSON.stringify({
      kind: 'runnability_facts',
      model_nodes: [{ id: 'n1', type: 'llm', empty: false }],
      code_nodes: [], kr_nodes: [],
    });
    try {
      seedWorkflow('workflow:\n  graph:\n    nodes: []\n'); // fixed at the gate: no TODO, model filled
      const task = await createTask(dir, { requirement: 'q', project: PROJECT, slug: SLUG, deploy: 'none' });
      task.preflightNote = 'preflight: not runnable out-of-the-box — needs: STALE. Advisory — does not block the build.';
      const rep = await runReport(dir, task, log);
      const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
      assert.equal(task.preflightNote, undefined, 'stale note cleared by the ④ recompute');
      assert.doesNotMatch(report.notes, /preflight:/);
    } finally {
      delete process.env.PREFLIGHT_FACTS;
    }
  });
});

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
    assert.equal(report.unresolved_plugin_todo, true, 'the raw dev field stays (spec 064)');
    // spec 064: the human NOTE is now PLAIN — the `unresolved_plugin_todo` jargon lives only on the
    // structured field above, never in the text a naive user reads.
    assert.match(report.notes, /relies on a Dify plugin/);
    for (const jargon of ['unresolved_plugin_todo:', 'plugin hash', 'dependencies are empty']) {
      assert.ok(!report.notes.includes(jargon), `note must not contain jargon "${jargon}"`);
    }
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

// ── spec 067 S5b: the tool checklist is gated on hasToolNode, NOT on the TODO marker ─────────────
// 067 S1 makes a RESOLVED `dependencies:` the correct output (the hash is public + version-keyed), so
// `unresolvedPluginTodo` goes false on exactly the builds that use a tool. Nesting 061's checklist
// under the TODO would retire it precisely then — the user still must install the plugin and add its
// API key. These two tests are the regression guard; they FAIL against the pre-067 nesting.
const TOOL_RESOLVED =
  'dependencies:\n' +
  '- type: marketplace\n' +
  '  value:\n' +
  '    marketplace_plugin_unique_identifier: omluc/google_sheets:0.0.2@' + '1'.repeat(64) + '\n' +
  'workflow:\n  graph:\n    nodes:\n    - data:\n        type: tool\n        tool_label: Google Sheets\n';

describe('spec 067 S5b — the tool checklist survives a resolved hash', () => {
  test('tool node + RESOLVED dependencies (no TODO) → checklist STILL rendered', async () => {
    seedWorkflow(TOOL_RESOLVED);
    const task = await createTask(dir, { requirement: 'z', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, false, 'the hash IS resolved — no TODO left');
    assert.match(report.notes, /Google Sheets/, 'the checklist names the tool (061 survives 067 S1)');
    assert.match(report.notes, /install/i, 'the user is still told to install it');
    assert.equal(rep.lintClean, true, 'still advisory — never flips the verdict');
  });

  test('tool node → the generic plugin line is suppressed (checklist supersedes it, no double-telling)', async () => {
    seedWorkflow('dependencies: []\n# TODO: add plugin hash\nworkflow:\n  graph:\n    nodes:\n' +
      '    - data:\n        type: tool\n        tool_label: Google Sheets\n');
    const task = await createTask(dir, { requirement: 'w', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    assert.equal(report.unresolved_plugin_todo, true, 'the dev field still records the TODO');
    assert.match(report.notes, /Google Sheets/, 'the specific checklist wins');
    assert.doesNotMatch(report.notes, /relies on a Dify plugin/, 'no vague duplicate alongside it');
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
      assert.match(report.notes, /Before this workflow can run, you need to: /); // spec 066 S5
      // spec 064: the model advisory is PLAIN reassurance and carries NO raw node id (`llm n1`
      // stays on the structured blocker, out of the human text).
      assert.match(report.notes, /the AI model \(filled in automatically when you test/);
      assert.ok(!report.notes.includes('n1'), 'no raw node id in the human note (spec 064)');
      // the D2 advisory still rides alongside (spec 037 AC 4) — now in plain language.
      assert.match(report.notes, /relies on a Dify plugin/);
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
      task.preflightNote = 'Before this workflow can run, you need to: STALE. (The build itself is finished — these are setup steps in Dify.)';
      const rep = await runReport(dir, task, log);
      const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
      assert.equal(task.preflightNote, undefined, 'stale note cleared by the ④ recompute');
      assert.doesNotMatch(report.notes, /STALE|Before this workflow can run/);
    } finally {
      delete process.env.PREFLIGHT_FACTS;
    }
  });
});

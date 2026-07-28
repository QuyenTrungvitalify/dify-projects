/**
 * 013 D1 — the single linter contract (linters.ts) drift-guard.
 *
 * C1 was: the 3-linter list + the "all three clean" test were hand-copied in post-turn.ts (Phase ③
 * gate) and report.ts (Phase ④ report) and had already drifted (a -6 vs -4 detail slice). This
 * suite pins the contract:
 *   1. `lintClean` truth table + `LINTERS` shape (pure).
 *   2. CROSS-CONSUMER IDENTITY: postTurnCheck (③) and runReport (④) run over the SAME fixture invoke
 *      the IDENTICAL ordered set of linter scripts and reach the IDENTICAL clean/dirty verdict — so a
 *      key/path/order change in the shared module moves both at once, and they can never disagree.
 *      (Spec 039 D7: the identity is the per-file contract on the DECLARED artifact — ③ additionally
 *      lints every other turn-touched workflows/*.ya?ml, which ④ structurally cannot re-scan: report
 *      time has no turn baseline to diff against. This suite's fixture has no extras, so it pins the
 *      declared-artifact identity unchanged.)
 *
 * The two REAL linter-invokers are exercised through a `.venv/bin/python` SHIM that records the
 * script path of each linter invocation and answers the YAML probe. (verifyPhase's `lintClean`
 * consumption — the third call site — is pinned behaviorally in advance-loop.test.ts: the Implement
 * success-vs-still_failing flip hinges on it.)
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LINTERS, lintClean, LINT_DETAIL_LINES, type LintCodes } from '../server/lib/linters.js';
import { postTurnCheck } from '../server/lib/post-turn.js';
import { runReport } from '../server/lib/report.js';
import { createTask } from '../server/state/task.js';
import type { SessionLogger } from '../server/lib/claude-session.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

describe('lintClean truth table', () => {
  test('all-zero → clean; any non-zero / null / undefined → not clean', () => {
    assert.equal(lintClean({ validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 }), true);
    assert.equal(lintClean({ validate: 1, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 }), false);
    assert.equal(lintClean({ validate: 0, lint_refs: 2, lint_plugin_hashes: 0, lint_node_bodies: 0 }), false);
    assert.equal(lintClean({ validate: 0, lint_refs: 0, lint_plugin_hashes: 3, lint_node_bodies: 0 }), false);
    // Spec 038 AC 8/8b — the promotion is the CONJUNCTION, not the array entry: an implementation
    // that adds the 4th LINTERS row but forgets lintClean would pass an entries-count test yet
    // never gate. This assertion is specifically the conjunction rejecting a non-zero 4th code.
    assert.equal(lintClean({ validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 1 }), false);
    assert.equal(lintClean(null), false);
    assert.equal(lintClean(undefined), false);
  });
});

describe('LINTERS contract', () => {
  test('exactly the 4 linters, in order, with the canonical keys + paths', () => {
    assert.deepEqual(
      LINTERS.map((l) => [l.key, l.script]),
      [
        ['validate', 'tools/dify_base/validate_workflow.py'],
        ['lint_refs', 'tools/dify_base/lint_refs.py'],
        ['lint_plugin_hashes', 'tools/dify_base/lint_plugin_hashes.py'],
        ['lint_node_bodies', 'tools/dify_base/lint_node_bodies.py'], // spec 038 P3 (038-fp-report.md: 0 FP)
      ]
    );
  });
});

// ── cross-consumer identity, via a recording python shim ───────────────────────────────────────

const PROJECT = 'proj_linter_fixture';
const SLUG = 'wf_linter_fixture';
let dir: string;
let recordFile: string;

/** A `.venv/bin/python` shim: linter calls (`<script> <wf>`) record the script + exit per $LINT_FAIL;
 *  the `-c` YAML probe emits a valid 13-digit node-id JSON so the ③ check's idsOk passes. */
const SHIM = `#!/usr/bin/env bash
if [ "$1" = "-c" ]; then
  case "$2" in
    *node_ids*) printf '%s' '{"node_ids": ["1234567890123"]}'; exit 0 ;;
    *) exit 0 ;;
  esac
fi
script="$1"
[ -n "$LINT_RECORD" ] && printf '%s\\n' "$script" >> "$LINT_RECORD"
case ",$LINT_FAIL," in
  *",$script,"*) echo "lint failure: $script" >&2; exit 1 ;;
esac
exit 0
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'linters-'));
  const bin = join(dir, '.venv', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'python'), SHIM, { mode: 0o755 });
  const wf = join(dir, 'projects', PROJECT, SLUG, 'workflows');
  mkdirSync(wf, { recursive: true });
  writeFileSync(join(wf, 'main.yml'), 'workflow:\n  graph:\n    nodes: []\n');
  recordFile = join(dir, 'record.txt');
});

afterEach(() => {
  delete process.env.LINT_RECORD;
  delete process.env.LINT_FAIL;
  rmSync(dir, { recursive: true, force: true });
});

/** The ordered linter scripts a consumer invoked, captured from the shim's record file. */
function recorded(): string[] {
  const raw = existsSync(recordFile) ? readFileSync(recordFile, 'utf8') : '';
  return raw.split('\n').filter(Boolean);
}

const sorted = (xs: string[]): string[] => [...xs].sort();

describe('cross-consumer identity (③ post-turn vs ④ report)', () => {
  test('both run the IDENTICAL linter SET = LINTERS', async () => {
    // D5 (017): the linters now run via Promise.all, so the shim's record-file append order is
    // COMPLETION order (racy), not invocation order. The real invariant is the SET (no extra/omitted
    // script) + the keyed verdict + the reason ORDER (the next describe pins that) — compare sorted.
    const expected = sorted(LINTERS.map((l) => l.script));

    // ③ post-turn
    writeFileSync(recordFile, '');
    process.env.LINT_RECORD = recordFile;
    await postTurnCheck({
      projectsDir: dir,
      project: PROJECT,
      workflowSlug: SLUG,
      workflowFile: 'main.yml',
      taskId: '1000000000001',
      baseline: new Set(),
      log,
    });
    const postTurnScripts = sorted(recorded());

    // ④ report
    writeFileSync(recordFile, '');
    const task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    await runReport(dir, task, log);
    // Spec 078 S2: on a from-scratch, lint-clean build ④ ALSO runs the advisory promote-nudge
    // catalog check — a sibling of the linters, never one of them. Split the record so the linter
    // identity stays exact AND any OTHER non-linter call is still drift (the catalog call is the
    // one sanctioned extra; this fixture is exactly the from-scratch+clean shape that triggers it).
    const linterSet = new Set(LINTERS.map((l) => l.script));
    const reportRaw = recorded();
    const reportScripts = sorted(reportRaw.filter((s) => linterSet.has(s)));
    assert.deepEqual(
      reportRaw.filter((s) => !linterSet.has(s)),
      ['tools/dify_base/catalog.py'],
      '④ non-linter python = the promote-nudge catalog check ONLY (spec 078 S2)'
    );

    assert.deepEqual(postTurnScripts, expected, '③ runs exactly the LINTERS set');
    assert.deepEqual(reportScripts, expected, '④ runs exactly the LINTERS set');
    assert.deepEqual(postTurnScripts, reportScripts, '③ and ④ run the SAME set');
  });

  test('both agree on the verdict — clean when all pass, dirty when the SAME linter fails', async () => {
    // all pass
    let task = await createTask(dir, { requirement: 'x', project: PROJECT, slug: SLUG, deploy: 'none' });
    let clean = await postTurnCheck({
      projectsDir: dir, project: PROJECT, workflowSlug: SLUG, workflowFile: 'main.yml', taskId: task.taskId, baseline: new Set(), log,
    });
    let rep = await runReport(dir, task, log);
    assert.equal(lintClean(clean.detail.lintCodes), true);
    assert.equal(rep.lintClean, true, '④ clean when ③ clean');

    // fail lint_refs in BOTH consumers via the shim
    process.env.LINT_FAIL = 'tools/dify_base/lint_refs.py';
    task = await createTask(dir, { requirement: 'y', project: PROJECT, slug: SLUG, deploy: 'none' });
    const dirty = await postTurnCheck({
      projectsDir: dir, project: PROJECT, workflowSlug: SLUG, workflowFile: 'main.yml', taskId: task.taskId, baseline: new Set(), log,
    });
    rep = await runReport(dir, task, log);
    assert.equal(dirty.detail.lintCodes?.lint_refs, 1, '③ saw lint_refs exit 1');
    assert.equal(lintClean(dirty.detail.lintCodes), false);
    assert.equal(rep.lintClean, false, '④ dirty when ③ dirty — verdicts cannot diverge');
  });
});

// ── D5 (017): parallelizing must keep keyed exit codes + reason/note ORDER = LINTERS order ───────

describe('D5 — parallel linters: behavior-equivalent codes + reason order', () => {
  test('③ post-turn: every failing linter reasons in LINTERS order (codes intact)', async () => {
    process.env.LINT_FAIL = LINTERS.map((l) => l.script).join(','); // fail all three
    const task = await createTask(dir, { requirement: 'a', project: PROJECT, slug: SLUG, deploy: 'none' });
    const res = await postTurnCheck({
      projectsDir: dir, project: PROJECT, workflowSlug: SLUG, workflowFile: 'main.yml', taskId: task.taskId, baseline: new Set(), log,
    });
    const idxs = LINTERS.map((l) => res.reasons.findIndex((r) => r.startsWith(`${l.name} exit`)));
    assert.ok(idxs.every((i) => i >= 0), `all 3 linter reasons present: ${res.reasons.join(' | ')}`);
    assert.deepEqual(idxs, [...idxs].sort((a, b) => a - b), 'reasons follow LINTERS order despite concurrency');
    assert.deepEqual(res.detail.lintCodes, { validate: 1, lint_refs: 1, lint_plugin_hashes: 1, lint_node_bodies: 1 });
  });

  test('④ report: notes list the failing linters in LINTERS key order (codes intact)', async () => {
    process.env.LINT_FAIL = LINTERS.map((l) => l.script).join(',');
    const task = await createTask(dir, { requirement: 'b', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, false);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    const order = LINTERS.map((l) => String(report.notes).indexOf(`${l.key} exit 1`));
    assert.ok(order.every((i) => i >= 0), report.notes);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), 'notes follow LINTERS key order');
    assert.deepEqual(report.lint, { validate: 1, lint_refs: 1, lint_plugin_hashes: 1, lint_node_bodies: 1 });
  });
});

describe('report.ts notes provenance (013 D1 / Q2)', () => {
  test('a failing linter keeps at most LINT_DETAIL_LINES detail lines (unified slice depth)', async () => {
    process.env.LINT_FAIL = 'tools/dify_base/lint_refs.py'; // shim writes 1 stderr line → ≤ N anyway
    const task = await createTask(dir, { requirement: 'z', project: PROJECT, slug: SLUG, deploy: 'none' });
    const rep = await runReport(dir, task, log);
    assert.equal(rep.lintClean, false);
    const report = JSON.parse(readFileSync(join(dir, rep.reportRel), 'utf8'));
    const noteDetail = String(report.notes).split('lint_refs exit 1: ')[1] ?? '';
    const lines = noteDetail.split(' ⏎ ').filter(Boolean);
    assert.ok(lines.length <= LINT_DETAIL_LINES, `detail kept ≤ ${LINT_DETAIL_LINES} lines`);
    assert.equal(report.lint.lint_refs, 1, 'report.lint records the exit code');
  });

  test('duplicateWarning leads the notes (⚠); deploy is recorded on the structured field', async () => {
    const task = await createTask(dir, { requirement: 'q', project: PROJECT, slug: SLUG, deploy: 'none' });
    await runReport(dir, task, log, { duplicateWarning: 'created a NEW app (duplicate)' });
    const report = JSON.parse(readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/report.json`), 'utf8'));
    assert.match(report.notes, /^⚠ created a NEW app \(duplicate\)/);
    assert.equal(report.duplicate_warning, 'created a NEW app (duplicate)');
    // spec 064: `deploy=none (no Dify contact)` was a dev detail meaningless to a user — it now
    // lives ONLY on the structured field, never in the human note text.
    assert.equal(report.deploy, 'none');
    assert.ok(!report.notes.includes('deploy=none'), 'no deploy=none jargon in the human note');
  });
});

// keep the LintCodes import referenced (it types the shared shape these tests assert against)
const _typecheck: LintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
void _typecheck;

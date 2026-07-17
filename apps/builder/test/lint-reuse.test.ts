/**
 * Spec 048 D2 — ④ reuses ③'s lint verdict on the WINDOWLESS maybeAutoAdvance ③→④ hop only.
 *
 *   AC 2  — auto: the hop passes reuseLint (deep-equal ③'s codes) into runReport; the REAL runReport
 *           with a clean reuseLint performs ZERO linter spawns (proof: a no-.venv projectsDir, where
 *           any spawn attempt records exit 1) and writes the reused codes + 'all linters passed';
 *   AC 2b — each_step's ③-gate `continue` is a WINDOWED path (separate request): no reuseLint;
 *   AC 2c — the still_failing `accept` and the ④ /reply retry pass no reuseLint;
 *   AC 2d — spec_only's ③→④ hop is windowless too (mode-agnostic seam — finding 2.7);
 *   plus the D1 wiring pin (finding 1.3i): orchestrator hands TURN_TIMEOUT_MS to runTurn's opts.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  startTask, confirmAdvance, replyWithin, TURN_TIMEOUT_MS, type OrchestratorCtx,
} from '../server/lib/orchestrator.js';
import { runReport as realRunReport, type ReportResult, type ReportOpts } from '../server/lib/report.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ShellResult } from '../server/lib/shell.js';
import type { LintCodes } from '../server/lib/linters.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;
const CLEAN: LintCodes = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
const DIRTY: LintCodes = { validate: 1, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };

let dir: string;
let current: Task | null = null;

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'lint-reuse-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\nreq: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\nreq: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\nfile: {{WORKFLOW_FILE}}\n{{KNOWLEDGE}}\n## Do\n');
  return d;
}

/** runTurn's opts param is an inline type in turn-runner.ts — mirror the one field we pin. */
type TurnOpts = { timeoutMs?: number };

interface Captured {
  reportOpts: (ReportOpts | undefined)[];
  turnOpts: (TurnOpts | undefined)[];
}

function harness(d: string, cap: Captured, o?: { lint?: LintCodes; failFirstReport?: boolean }) {
  const lint = o?.lint ?? CLEAN;
  const status: 'done' | 'error' = Object.values(lint).some((c) => c !== 0) ? 'error' : 'done';
  const runTurn = async (
    _s: ClaudeSession, _p: string, _e?: unknown, opts?: TurnOpts
  ): Promise<TurnResult> => {
    cap.turnOpts.push(opts);
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed": null, "summary": "ok"}');
    else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
    else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: status === 'done', status, reasons: status === 'done' ? [] : ['validate exit 1: boom'],
    detail: {
      artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
      lintCodes: { ...lint },
    },
  });
  const runReport = async (_d: string, t: Task, _l: SessionLogger, ro?: ReportOpts): Promise<ReportResult> => {
    cap.reportOpts.push(ro);
    if (o?.failFirstReport && cap.reportOpts.length === 1) {
      return { ok: false, reasons: ['report.json missing: boom'], reportRel: '', lintClean: false };
    }
    return { ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true };
  };
  const ctx: OrchestratorCtx = {
    projectsDir: d, settingsPath: '', log, broadcast: () => {},
    runners: { runTurn, runPython, runReport, postTurnCheck },
  };
  return ctx;
}

async function withTurn(taskId: string, work: () => Promise<void>): Promise<void> {
  assert.ok(acquireTurn(taskId));
  try {
    await work();
  } finally {
    releaseTurn(taskId);
  }
}

afterEach(() => {
  current = null;
  rmSync(dir, { recursive: true, force: true });
});

describe('spec 048 D2 — reuseLint rides ONLY the windowless ③→④ hop', () => {
  test('AC 2: auto — runReport receives reuseLint deep-equal to ③ codes (and runTurn gets TURN_TIMEOUT_MS)', async () => {
    dir = fixtureDir();
    const cap: Captured = { reportOpts: [], turnOpts: [] };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'auto', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // spec → (auto) implement → (hop) ④
    assert.equal(task.status, 'done');
    assert.equal(cap.reportOpts.length, 1);
    assert.deepEqual(cap.reportOpts[0]?.reuseLint, CLEAN, 'the hop threaded ③ codes verbatim');
    // D1 wiring pin (finding 1.3i): every phase turn was budgeted with the env-derived const.
    assert.ok(cap.turnOpts.length >= 2, 'spec + implement turns ran');
    for (const t of cap.turnOpts) assert.equal(t?.timeoutMs, TURN_TIMEOUT_MS);
  });

  test('AC 2d: spec_only — the human confirms ② but the ③→④ hop is the SAME request → reuse', async () => {
    dir = fixtureDir();
    const cap: Captured = { reportOpts: [], turnOpts: [] };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'spec_only', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // parks at the Spec gate
    assert.equal(task.phase, 'spec');
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ③ runs, then hops ④
    assert.equal(task.status, 'done');
    assert.deepEqual(cap.reportOpts[0]?.reuseLint, CLEAN, 'spec_only hop reuses too (mode-agnostic)');
  });

  test('AC 2b: each_step — the ③-gate continue is a separate (windowed) request → NO reuse', async () => {
    dir = fixtureDir();
    const cap: Captured = { reportOpts: [], turnOpts: [] };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // spec 055: parks at ① analyze
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ② spec
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② → ③, parks at ③ gate
    assert.equal(task.phase, 'implement');
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // the HUMAN window
    assert.equal(cap.reportOpts[0]?.reuseLint, undefined, 'windowed continue re-runs the linters');
  });

  test('AC 2c: still_failing accept and the ④ /reply retry pass NO reuseLint', async () => {
    // accept: ③ parked still_failing (lint≠0) — a human override, always windowed.
    dir = fixtureDir();
    const cap: Captured = { reportOpts: [], turnOpts: [] };
    const ctx = harness(dir, cap, { lint: DIRTY });
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // spec 055: parks at ① analyze
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ② spec
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx));
    assert.equal(task.gate?.flag, 'still_failing');
    await withTurn(task.taskId, () => confirmAdvance(task, 'accept', ctx));
    assert.equal(cap.reportOpts[0]?.reuseLint, undefined, 'accept never reuses');
    assert.equal(cap.reportOpts[0]?.acceptedLintFailure, true);
    rmSync(dir, { recursive: true, force: true });

    // /reply retry out of a ④ error: the first (auto) report DID reuse; the retry must NOT.
    dir = fixtureDir();
    const cap2: Captured = { reportOpts: [], turnOpts: [] };
    const ctx2 = harness(dir, cap2, { failFirstReport: true });
    const task2 = await createTask(dir, { requirement: 'r', confirmMode: 'auto', deploy: 'none' });
    current = task2;
    await withTurn(task2.taskId, () => startTask(task2, ctx2)); // hop → ④ report fails → error
    assert.equal(task2.status, 'error');
    assert.deepEqual(cap2.reportOpts[0]?.reuseLint, CLEAN, 'the failed attempt was the reuse hop');
    await withTurn(task2.taskId, () => replyWithin(task2, 'retry', ctx2)); // static ④ retry
    assert.equal(cap2.reportOpts.length, 2);
    assert.equal(cap2.reportOpts[1]?.reuseLint, undefined, 'the retry re-runs the linters');
  });
});

describe('spec 048 D2 — the REAL runReport skips the spawns on a clean reuse (no-.venv proof)', () => {
  test('reuse → codes verbatim + "all linters passed" + preflightNote untouched; control + dirty-reuse spawn', async () => {
    dir = mkdtempSync(join(tmpdir(), 'lint-reuse-real-'));
    const wfDir = join(dir, 'projects', 'p', 'w', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'main.yml'), 'kind: app\n');
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    task.project = 'p';
    task.workflowSlug = 'w';
    task.preflightNote = 'planted-by-③';

    // reuse: NO .venv exists here — any spawn attempt would exit non-zero. All-zero codes prove skip.
    const res = await realRunReport(dir, task, log, { reuseLint: { ...CLEAN } });
    const report = JSON.parse(readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/report.json`), 'utf8'));
    assert.deepEqual(report.lint, CLEAN, 'reused verbatim — zero spawns in a dir where spawns fail');
    assert.equal(res.lintClean, true);
    assert.match(report.notes, /The workflow file passed every automated check\./); // spec 066 S5
    assert.equal(task.preflightNote, 'planted-by-③', 'preflight recompute shares the reuse guard');
    assert.match(report.notes, /planted-by-③/, 'the ③-fresh note is carried, not recomputed');

    // control (windowed): no reuseLint → the 4 spawns run and fail (no .venv) → non-zero codes.
    const ctl = await realRunReport(dir, task, log, {});
    assert.equal(ctl.lintClean, false, 'control really spawned (and failed) — the skip was the reuse');

    // dirty reuse: the lintClean guard refuses it (a failing set would need linter output for notes).
    const dirty = await realRunReport(dir, task, log, { reuseLint: { ...DIRTY } });
    assert.equal(dirty.lintClean, false, 'non-clean reuseLint falls back to the real re-run');
  });
});

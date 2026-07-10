/**
 * Spec 049 D2 — the ④ import-probe: push the produced YAML to the REAL Dify, delete the probe app,
 * surface the verdict as an ADVISORY note (never a gate).
 *
 *   AC 3 — with selfhost creds the static ④ probes once ('[probe] <slug>' name, delete follows with
 *          the returned appId); a probe FAILURE carries Dify's redacted error and changes NO verdict;
 *          a failed push triggers NO delete; no creds → probe never called; live path → undefined.
 *   AC 4 — a planted secret in the probe stderr never reaches the note (redactSecrets).
 *   plus the report carry: the REAL runReport writes task.probeNote into report.json.notes.
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startTask, confirmAdvance, runImportProbe, type OrchestratorCtx } from '../server/lib/orchestrator.js';
import { runReport as realRunReport, type ReportResult, type ReportOpts } from '../server/lib/report.js';
import { registerSecret, unregisterSecret } from '../server/lib/dify-io.js';
import { acquireTurn, releaseTurn } from '../server/lib/lock.js';
import { createTask, type Task } from '../server/state/task.js';
import { PHASES } from '../server/lib/phases.js';
import { applyInitFake } from './helpers/scaffold-fake.js';
import type { ClaudeSession, SessionLogger } from '../server/lib/claude-session.js';
import type { TurnResult } from '../server/lib/turn-runner.js';
import type { PostTurnParams, PostTurnResult } from '../server/lib/post-turn.js';
import type { ShellResult } from '../server/lib/shell.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

let dir: string;
let current: Task | null = null;

function withDifyEnv(): void {
  process.env.DIFY_CONSOLE_URL = 'http://localhost/console/api';
  process.env.DIFY_CONSOLE_TOKEN = 'tok-probe-049';
}

afterEach(() => {
  current = null;
  delete process.env.DIFY_CONSOLE_URL;
  delete process.env.DIFY_CONSOLE_TOKEN;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function fixtureDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'import-probe-'));
  const skill = join(d, '.claude', 'skills', 'dify-build');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'analyze.md'), '# analyze\nreq: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'spec.md'), '# spec\nreq: {{REQUIREMENT}}\n');
  writeFileSync(join(skill, 'implement.md'), '# implement\nreq: {{REQUIREMENT}}\n{{KNOWLEDGE}}\n');
  return d;
}

interface ProbeCap {
  importCalls: { srcFileRel: string; appName: string }[];
  deleteCalls: string[];
  reconcileCalls: string[];
  importResult: { ok: boolean; appId: string | null; status?: string | null; stderr: string };
  /** what the orphan-sweep reconcile finds (r3: Dify commits the app row BEFORE validating vars). */
  reconcileResult?: { appId: string | null; ambiguous: boolean };
}

function harness(d: string, cap: ProbeCap) {
  const runTurn = async (_s: ClaudeSession, _p: string): Promise<TurnResult> => {
    const task = current!;
    const phase = PHASES.find((p) => p.id === task.phase)!;
    const abs = join(d, phase.artifactRel(task));
    mkdirSync(dirname(abs), { recursive: true });
    if (task.phase === 'analyze') writeFileSync(abs, '{"seed":null}'); // spec 055: from-scratch runs analyze
    else if (task.phase === 'spec') writeFileSync(abs, '# SPEC\nbuild it.\n');
    else writeFileSync(abs, 'workflow:\n  graph:\n    nodes: []\n');
    return { sessionId: `sess-${task.phase}`, result: { type: 'result', is_error: false }, isError: false };
  };
  const runPython = async (_p: string, args: string[]): Promise<ShellResult> => {
    applyInitFake(d, args);
    return { code: 0, stdout: '', stderr: '' };
  };
  const postTurnCheck = async (_p: PostTurnParams): Promise<PostTurnResult> => ({
    ok: true, status: 'done', reasons: [],
    detail: {
      artifactOk: true, yamlOk: true, idsOk: true, confinementBreaches: [], extraFiles: [],
      lintCodes: { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 },
    },
  });
  const runReport = async (_d: string, t: Task, _l: SessionLogger, _o?: ReportOpts): Promise<ReportResult> => ({
    ok: true, reasons: [], reportRel: `apps/builder/.runs/${t.taskId}/report.json`, lintClean: true,
  });
  const ctx: OrchestratorCtx = {
    projectsDir: d, settingsPath: '', log, broadcast: () => {},
    runners: {
      runTurn, runPython, runReport, postTurnCheck,
      liveOps: {
        importForTest: async (_pd, _proj, _slug, srcFileRel, appName) => {
          cap.importCalls.push({ srcFileRel, appName });
          return cap.importResult;
        },
        deleteApp: async (_pd, appId) => {
          cap.deleteCalls.push(appId);
          return true;
        },
        reconcileAppIdByName: async (_pd, appName) => {
          cap.reconcileCalls.push(appName);
          return cap.reconcileResult ?? { appId: null, ambiguous: false };
        },
      },
    },
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

/** each_step ladder: ② gate → ③ gate → (creds on) → static ④. */
async function driveToTest(ctx: OrchestratorCtx, task: Task): Promise<void> {
  await withTurn(task.taskId, () => startTask(task, ctx)); // parks at Analyze (spec 055)
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ②
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② → ③
  assert.equal(task.phase, 'implement');
  withDifyEnv();
  await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ③ → ④ static
}

describe('spec 049 D2 — the ④ import-probe (advisory oracle)', () => {
  test('AC 3: creds present → probe once, unique [probe] <taskId> name, delete with the returned appId', async () => {
    dir = fixtureDir();
    const cap: ProbeCap = { importCalls: [], deleteCalls: [], reconcileCalls: [], importResult: { ok: true, appId: 'app-777', stderr: '' } };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    await driveToTest(ctx, task);
    assert.equal(cap.importCalls.length, 1);
    assert.equal(cap.importCalls[0].appName, `[probe] ${task.taskId}`, 'unique per task, stable across retries');
    assert.ok(cap.importCalls[0].srcFileRel.endsWith('/workflows/main.yml'));
    assert.deepEqual(cap.deleteCalls, ['app-777'], 'the probe app is deleted immediately');
    assert.equal(cap.reconcileCalls.length, 0, 'no orphan sweep needed on success');
    assert.match(task.probeNote!, /^import-probe: OK/);
  });

  test('AC 3/4: probe FAILURE → redacted verbatim error, ORPHAN SWEEP (Dify commits the app row before validating vars), verdict unchanged', async () => {
    dir = fixtureDir();
    const cap: ProbeCap = {
      importCalls: [], deleteCalls: [], reconcileCalls: [],
      importResult: { ok: false, appId: null, stderr: 'HTTP 400 — {"error":"missing name"} token tok-probe-049' },
      reconcileResult: { appId: 'orphan-1', ambiguous: false },
    };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    registerSecret('tok-probe-049');
    try {
      await driveToTest(ctx, task);
    } finally {
      unregisterSecret('tok-probe-049');
    }
    assert.match(task.probeNote!, /^import-probe FAILED:/);
    assert.ok(task.probeNote!.includes('missing name'), 'Dify error verbatim — the /reply fix-turn input');
    assert.ok(!task.probeNote!.includes('tok-probe-049'), 'secret redacted');
    // r3 (review 3.1): a FAILED import can still have committed the app row — the probe reconciles
    // its unique name and deletes the orphan (verified live: 8 orphans in one field workspace).
    assert.deepEqual(cap.reconcileCalls, [`[probe] ${task.taskId}`], 'orphan sweep by the unique probe name');
    assert.deepEqual(cap.deleteCalls, ['orphan-1'], 'the swept orphan is deleted');
    // ADVISORY: the ④ outcome is whatever the report says — with selfhost creds + lintClean the
    // each_step static path parks at the Import gate exactly as without the probe.
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.gate?.flag, 'awaiting_import');
  });

  test('AC 3 (r3): HTTP 202 pending (version mismatch) → inconclusive note, never FAILED, no sweep', async () => {
    dir = fixtureDir();
    const cap: ProbeCap = {
      importCalls: [], deleteCalls: [], reconcileCalls: [],
      importResult: { ok: true, appId: null, status: 'pending', stderr: '' },
    };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    await driveToTest(ctx, task);
    assert.match(task.probeNote!, /^import-probe: skipped .*pending/);
    assert.ok(!task.probeNote!.includes('FAILED'), 'a version park is not a DSL rejection');
    assert.equal(cap.deleteCalls.length, 0);
    assert.equal(cap.reconcileCalls.length, 0, 'pending creates no app — nothing to sweep');
  });

  test('AC 3: no creds → the probe is never attempted and no note is written', async () => {
    dir = fixtureDir();
    const cap: ProbeCap = { importCalls: [], deleteCalls: [], reconcileCalls: [], importResult: { ok: true, appId: 'x', stderr: '' } };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', confirmMode: 'each_step', deploy: 'none' });
    current = task;
    await withTurn(task.taskId, () => startTask(task, ctx)); // spec 055: ① analyze
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ① → ②
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ② → ③
    // NO withDifyEnv() — static ④ without creds
    await withTurn(task.taskId, () => confirmAdvance(task, 'continue', ctx)); // ③ → ④ → done
    assert.equal(cap.importCalls.length, 0);
    assert.equal(task.probeNote, undefined);
    assert.equal(task.status, 'done');
  });

  test('AC 3: the live path returns undefined without touching the ops (defensive pin)', async () => {
    dir = fixtureDir();
    const cap: ProbeCap = { importCalls: [], deleteCalls: [], reconcileCalls: [], importResult: { ok: true, appId: 'x', stderr: '' } };
    const ctx = harness(dir, cap);
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    task.project = 'p';
    task.workflowSlug = 'w';
    task.testMode = 'live';
    withDifyEnv();
    assert.equal(await runImportProbe(task, ctx), undefined);
    assert.equal(cap.importCalls.length, 0);
  });

  test('report carry: the REAL runReport writes task.probeNote into report.json.notes', async () => {
    dir = mkdtempSync(join(tmpdir(), 'import-probe-real-'));
    const wfDir = join(dir, 'projects', 'p', 'w', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    writeFileSync(join(wfDir, 'main.yml'), 'kind: app\n');
    const task = await createTask(dir, { requirement: 'r', deploy: 'none' });
    task.project = 'p';
    task.workflowSlug = 'w';
    task.probeNote = 'import-probe FAILED: HTTP 400 — missing name';
    const CLEAN = { validate: 0, lint_refs: 0, lint_plugin_hashes: 0, lint_node_bodies: 0 };
    await realRunReport(dir, task, log, { reuseLint: CLEAN });
    const report = JSON.parse(readFileSync(join(dir, `apps/builder/.runs/${task.taskId}/report.json`), 'utf8'));
    assert.ok(report.notes.includes('import-probe FAILED: HTTP 400 — missing name'), report.notes);
  });
});

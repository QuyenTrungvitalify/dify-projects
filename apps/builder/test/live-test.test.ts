/**
 * Spec 032 S3-wiring-b — runLiveTest, the Phase ④ LIVE sub-orchestrator. Driven with the `liveOps` seam
 * stubbed (no real Dify), this pins the verdict → gate mapping the FSM depends on:
 *   • clean run → verdict `passed`/`live-verified`, parked at `test_result` (auto HARD-STOPS, B4 — never done)
 *   • run fails → `workflow_fail`/`live-verified-fail`, parked at `test_result` (NOT hidden as static-pass)
 *   • 0-model / infra → `infra_fail`/`static-only`, parked at `infra_degraded` (degrade, D1c)
 *   • undrivable input → `need_input`, parked (honest — not a workflow fault)
 * Plus resolveInput (D8) and the test-app tracking + app_url surfacing.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLiveTest, resolveInput, extractJson, parseJudgeVerdict, cleanupTestApps } from '../server/lib/live-test.js';
import { createTask, loadTask, type Task } from '../server/state/task.js';
import type { OrchestratorCtx, LiveOps } from '../server/lib/orchestrator-shared.js';
import type { SessionLogger } from '../server/lib/claude-session.js';
import type { InputVar } from '../server/lib/dify-io.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** liveOps that reach a clean pass; each test overrides one step to exercise a branch. */
const okOps = (): Partial<LiveOps> => ({
  resolveLlmModels: async () => ({ enabled: [{ provider: 'p', name: 'gpt-mini' }], pick: { provider: 'p', name: 'gpt-mini' } }),
  deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 1, patched: ['n1'], outFile: outRel, inputs: [], mode: 'workflow', stderr: '' }),
  importForTest: async () => ({ ok: true, appId: 'app-123', stderr: '' }),
  publishWorkflow: async () => ({ ok: true, stderr: '' }),
  mintAppKey: async () => 'app-secretkey',
  runWorkflow: async () => ({ ok: true, status: 'succeeded', outputs: { summary: 'ok' }, error: null, totalTokens: 42 }),
  deleteApp: async () => true,
});

async function harness(overrides: Partial<LiveOps>): Promise<{ task: Task; ctx: OrchestratorCtx; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'livetest-'));
  const task = await createTask(dir, { requirement: 'r', deploy: 'selfhost', testMode: 'live', project: 'proj', slug: 'wf' });
  const ctx: OrchestratorCtx = {
    projectsDir: dir,
    settingsPath: '',
    log,
    runners: {
      runReport: async () => ({ ok: true, reasons: [], reportRel: 'apps/builder/.runs/x/report.json', lintClean: true }),
      liveOps: { ...okOps(), ...overrides },
    },
  };
  return { task, ctx, dir };
}

// difyCreds() reads the env; the live path degrades without it, so set a fake console for the drive.
function withCreds(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const u = process.env.DIFY_CONSOLE_URL, t = process.env.DIFY_CONSOLE_TOKEN;
    process.env.DIFY_CONSOLE_URL = 'http://localhost:8090/console/api';
    process.env.DIFY_CONSOLE_TOKEN = 'admintok';
    try {
      await fn();
    } finally {
      if (u === undefined) delete process.env.DIFY_CONSOLE_URL; else process.env.DIFY_CONSOLE_URL = u;
      if (t === undefined) delete process.env.DIFY_CONSOLE_TOKEN; else process.env.DIFY_CONSOLE_TOKEN = t;
    }
  };
}

describe('resolveInput (D8)', () => {
  test('fills required text/paragraph/number; select/file → missing; optional skipped', () => {
    const vars: InputVar[] = [
      { variable: 'q', type: 'text-input', required: true },
      { variable: 'body', type: 'paragraph', required: true },
      { variable: 'n', type: 'number', required: true },
      { variable: 'opt', type: 'text-input', required: false },
      { variable: 'sel', type: 'select', required: true, options: ['a'] },
      { variable: 'doc', type: 'file', required: true },
    ];
    const { inputs, missing } = resolveInput(vars);
    assert.equal(typeof inputs.q, 'string');
    assert.equal(typeof inputs.body, 'string');
    assert.equal(inputs.n, 1);
    assert.ok(!('opt' in inputs), 'optional not filled');
    assert.deepEqual(missing.sort(), ['doc', 'sel']);
  });
});

describe('extractJson / parseJudgeVerdict (T3)', () => {
  test('extracts fenced json, bare trailing json; no json → null', () => {
    assert.deepEqual(extractJson('blah\n```json\n{"a":1}\n```\nend'), { a: 1 });
    assert.deepEqual(extractJson('here it is {"a":2}'), { a: 2 });
    assert.equal(extractJson('no json here'), null);
  });

  test('parseJudgeVerdict maps criteria, filters empty, reads summary', () => {
    const v = parseJudgeVerdict(
      '```json\n{"criteria":[{"criterion":"A","pass":true,"evidence":"e"},{"criterion":"","pass":false}],"summary":"1/1"}\n```'
    );
    assert.equal(v?.criteria.length, 1);
    assert.deepEqual(v?.criteria[0], { criterion: 'A', pass: true, evidence: 'e' });
    assert.equal(v?.summary, '1/1');
  });

  test('missing criteria array → null (inconclusive → advisory-absent)', () => {
    assert.equal(parseJudgeVerdict('{"foo":1}'), null);
    assert.equal(parseJudgeVerdict('not json'), null);
  });
});

describe('runLiveTest verdict → gate', () => {
  test('clean run → passed / live-verified, parked at test_result (auto never auto-dones, B4)', withCreds(async () => {
    const { task, ctx, dir } = await harness({});
    await runLiveTest(task, ctx);
    assert.equal(task.status, 'awaiting_confirm');
    assert.equal(task.gate?.flag, 'test_result');
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.liveTest?.label, 'live-verified');
    assert.equal(task.liveTest?.t1Pass, true);
    assert.deepEqual(task.liveTest?.output, { summary: 'ok' });
    assert.deepEqual(task.testApps, ['app-123']);
    assert.equal(task.appId, 'app-123');
    assert.ok(task.appUrl?.includes('app-123'));
    // persisted, not just in-memory
    const reloaded = await loadTask(dir, task.taskId);
    assert.equal(reloaded.liveTest?.verdict, 'passed');
  }));

  test('run fails → workflow_fail / live-verified-fail, parked at test_result (NOT hidden)', withCreds(async () => {
    const { task, ctx } = await harness({
      runWorkflow: async () => ({ ok: false, status: 'failed', outputs: null, error: 'Model not exist', totalTokens: null }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'test_result');
    assert.equal(task.liveTest?.verdict, 'workflow_fail');
    assert.equal(task.liveTest?.label, 'live-verified-fail');
    assert.match(task.liveTest?.reason ?? '', /Model not exist/);
  }));

  test('0-model → infra_fail / static-only, parked at infra_degraded (degrade, not fail)', withCreds(async () => {
    const { task, ctx } = await harness({ resolveLlmModels: async () => ({ enabled: [], pick: null }) });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.equal(task.liveTest?.verdict, 'infra_fail');
    assert.equal(task.liveTest?.label, 'static-only');
  }));

  test('transport error (status null) → infra_degraded (not workflow_fail)', withCreds(async () => {
    const { task, ctx } = await harness({
      runWorkflow: async () => ({ ok: false, status: null, outputs: null, error: 'timeout', totalTokens: null }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.equal(task.liveTest?.verdict, 'infra_fail');
  }));

  test('undrivable input → need_input, parked at test_result', withCreds(async () => {
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, patched: [], outFile: outRel, mode: 'workflow',
        inputs: [{ variable: 'sel', type: 'select', required: true, options: ['a'] }], stderr: '',
      }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'test_result');
    assert.equal(task.liveTest?.verdict, 'need_input');
    assert.deepEqual(task.liveTest?.needInputVars, ['sel']);
  }));

  test('advanced-chat app → runWorkflow gets mode+query, passes (chat via /chat-messages)', withCreds(async () => {
    let seenMode = '';
    let seenQuery = '';
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 1, patched: ['llm'], outFile: outRel, inputs: [], mode: 'advanced-chat', stderr: '' }),
      runWorkflow: async (_d, _k, mode, _inputs, q) => {
        seenMode = mode; seenQuery = q;
        return { ok: true, status: 'succeeded', outputs: { answer: 'hi there' }, error: null, totalTokens: 12 };
      },
    });
    await runLiveTest(task, ctx);
    assert.equal(seenMode, 'advanced-chat', 'mode threaded to the run');
    assert.ok(seenQuery.length > 0, 'a chat query was supplied');
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal((task.liveTest?.input as Record<string, unknown>)?.query, seenQuery, 'query shown in the gate input');
  }));

  test('T3 judge grades output against the rubric + attaches verdict (advisory)', withCreds(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'livejudge-'));
    const task = await createTask(dir, { requirement: 'r', deploy: 'selfhost', testMode: 'live', project: 'proj', slug: 'wf' });
    // runJudge reads the rubric (persisted at spec-verify) + the judge skill body from projectsDir.
    writeFileSync(join(dir, `apps/builder/.runs/${task.taskId}/criteria.json`), JSON.stringify({ criteria: ['Reply politely'] }));
    mkdirSync(join(dir, '.claude/skills/dify-build'), { recursive: true });
    writeFileSync(join(dir, '.claude/skills/dify-build/judge.md'), 'judge {{CRITERIA}} {{OUTPUT}}');
    const ctx: OrchestratorCtx = {
      projectsDir: dir,
      settingsPath: '',
      log,
      runners: {
        runReport: async () => ({ ok: true, reasons: [], reportRel: 'x', lintClean: true }),
        runTurn: async (_s, _p, _i, opts) => {
          opts?.onText?.('```json\n{"criteria":[{"criterion":"Reply politely","pass":true,"evidence":"was polite"}],"summary":"1/1 met"}\n```');
          return { sessionId: 's', result: null, isError: false };
        },
        liveOps: okOps(),
      },
    };
    await runLiveTest(task, ctx);
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.liveTest?.judge?.criteria.length, 1);
    assert.equal(task.liveTest?.judge?.criteria[0].pass, true);
    assert.equal(task.liveTest?.judge?.summary, '1/1 met');
  }));

  test('no rubric → judge skipped (smoke-test only), still passes', withCreds(async () => {
    const { task, ctx } = await harness({}); // no criteria.json written → judge absent
    await runLiveTest(task, ctx);
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.liveTest?.judge, undefined);
  }));

  test('import fails → infra_degraded (no app id)', withCreds(async () => {
    const { task, ctx } = await harness({ importForTest: async () => ({ ok: false, appId: null, stderr: 'boom' }) });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.ok(!task.testApps || task.testApps.length === 0);
  }));
});

describe('cleanupTestApps (S6)', () => {
  test('deletes this build\'s test apps + re-parks the same live gate', withCreds(async () => {
    const { task, ctx } = await harness({ deleteApp: async () => true });
    await runLiveTest(task, ctx);
    assert.deepEqual(task.testApps, ['app-123']);
    await cleanupTestApps(task, ctx);
    assert.deepEqual(task.testApps, []);
    assert.equal(task.gate?.flag, 'test_result'); // re-parked, result still stands
    assert.equal(task.appId, null);
  }));

  test('keeps ids that fail to delete (best-effort)', withCreds(async () => {
    const { task, ctx } = await harness({ deleteApp: async () => false });
    await runLiveTest(task, ctx);
    await cleanupTestApps(task, ctx);
    assert.deepEqual(task.testApps, ['app-123']); // delete failed → left in the list
  }));
});

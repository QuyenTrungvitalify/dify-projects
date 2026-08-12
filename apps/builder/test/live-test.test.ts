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
import { runLiveTest, finishLiveAccepted, resolveInput, extractJson, parseJudgeVerdict, cleanupTestApps } from '../server/lib/live-test.js';
import { createTask, loadTask, type Task } from '../server/state/task.js';
import type { OrchestratorCtx, LiveOps } from '../server/lib/orchestrator-shared.js';
import type { SessionLogger } from '../server/lib/claude-session.js';
import type { InputVar } from '../server/lib/dify-io.js';

const log = { info() {}, warn() {}, error() {} } as unknown as SessionLogger;

/** liveOps that reach a clean pass; each test overrides one step to exercise a branch. */
const okOps = (): Partial<LiveOps> => ({
  resolveLlmModels: async () => ({ enabled: [{ provider: 'p', name: 'gpt-mini' }], pick: { provider: 'p', name: 'gpt-mini' } }),
  deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 1, llmCount: 1, patched: ['n1'], outFile: outRel, inputs: [], mode: 'workflow', stderr: '' }),
  importForTest: async () => ({ ok: true, appId: 'app-123', stderr: '' }),
  publishWorkflow: async () => ({ ok: true, stderr: '' }),
  mintAppKey: async () => 'app-secretkey',
  uploadSampleFile: async () => 'upload-file-id-1',
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
  test('fills required text/paragraph/number; optional skipped', () => {
    const vars: InputVar[] = [
      { variable: 'q', type: 'text-input', required: true },
      { variable: 'body', type: 'paragraph', required: true },
      { variable: 'n', type: 'number', required: true },
      { variable: 'opt', type: 'text-input', required: false },
    ];
    const { inputs, missing } = resolveInput(vars);
    assert.equal(typeof inputs.q, 'string');
    assert.equal(typeof inputs.body, 'string');
    assert.equal(inputs.n, 1);
    assert.ok(!('opt' in inputs), 'optional not filled');
    assert.deepEqual(missing, []);
  });

  test('select → picks first option; fallback when options absent', () => {
    const { inputs: i1 } = resolveInput([{ variable: 'sel', type: 'select', required: true, options: ['a', 'b'] }]);
    assert.equal(i1.sel, 'a');
    const { inputs: i2 } = resolveInput([{ variable: 'sel', type: 'select', required: true }]);
    assert.equal(i2.sel, 'option_a');
  });

  test('file/file-list (local_file) → needsUpload, NOT in inputs until an id is provided (S1/QA-5=b)', () => {
    const vars: InputVar[] = [
      { variable: 'doc', type: 'file', required: true, allowed_file_upload_methods: ['local_file', 'remote_url'] },
      { variable: 'docs', type: 'file-list', required: true, allowed_file_upload_methods: ['local_file'] },
    ];
    const first = resolveInput(vars);
    assert.equal(first.needsUpload, true, 'flags an upload is needed');
    assert.ok(!('doc' in first.inputs) && !('docs' in first.inputs), 'no bare string / empty id sent');
    assert.deepEqual(first.cannotBuild, [], 'buildable once uploaded');
    // second pass with an uploaded id → valid Dify file-objects, type from allowed_file_types[0].
    const second = resolveInput(
      [{ variable: 'doc', type: 'file', required: true, allowed_file_upload_methods: ['local_file'], allowed_file_types: ['image'] }],
      { uploadedFileId: 'up-99' }
    );
    assert.deepEqual(second.inputs.doc, { transfer_method: 'local_file', upload_file_id: 'up-99', type: 'image' });
    const listPass = resolveInput(vars, { uploadedFileId: 'up-1' });
    assert.ok(Array.isArray(listPass.inputs.docs) && (listPass.inputs.docs as unknown[]).length === 1, 'file-list wraps in array');
    assert.equal((listPass.inputs.docs as Record<string, unknown>[])[0].transfer_method, 'local_file');
  });

  test('file that allows ONLY remote_url → cannotBuild (degrade, never fabricate a URL — QA-5=b)', () => {
    const { inputs, cannotBuild, needsUpload } = resolveInput([
      { variable: 'onlyurl', type: 'file', required: true, allowed_file_upload_methods: ['remote_url'] },
    ]);
    assert.ok(!('onlyurl' in inputs));
    assert.equal(needsUpload, false);
    assert.equal(cannotBuild.length, 1);
    assert.match(cannotBuild[0], /onlyurl/);
  });

  test('default (no allowed_file_upload_methods) assumes local_file → needsUpload', () => {
    const { needsUpload, cannotBuild } = resolveInput([{ variable: 'f', type: 'file', required: true }]);
    assert.equal(needsUpload, true);
    assert.deepEqual(cannotBuild, []);
  });

  test('boolean → true', () => {
    const { inputs } = resolveInput([{ variable: 'flag', type: 'boolean', required: true }]);
    assert.equal(inputs.flag, true);
  });

  test('truly unknown type → missing (need_input)', () => {
    const { inputs, missing } = resolveInput([
      { variable: 'weird', type: 'custom-exotic-type', required: true },
    ]);
    assert.ok(!('weird' in inputs));
    assert.deepEqual(missing, ['weird']);
  });
});


describe('extractJson / parseJudgeVerdict (T3)', () => {
  test('extracts fenced json, bare trailing json; no json → null', () => {
    assert.deepEqual(extractJson('blah\n```json\n{"a":1}\n```\nend'), { a: 1 });
    assert.deepEqual(extractJson('here it is {"a":2}'), { a: 2 });
    assert.equal(extractJson('no json here'), null);
  });

  test('extracts a NON-fenced NESTED object via the widest brace span (review #3)', () => {
    assert.deepEqual(extractJson('result: {"criteria":[{"criterion":"A","pass":true}]} done'), {
      criteria: [{ criterion: 'A', pass: true }],
    });
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

  // spec 036 D5 (S5) — the done-state re-entry, flagged as the biggest integration risk: the live
  // sub-orchestrator is entered from a TERMINAL `done` build (via POST /api/tasks/:id/live-test), NOT the
  // implement→test gate. Confirm done → running → awaiting_confirm(test_result) → (accept) → done is legal.
  test('re-entered from a `done` build → running → test_result → accept → done (D5 re-entry)', withCreds(async () => {
    const { task, ctx, dir } = await harness({});
    // Simulate the state the route hands to runLiveTest: a finished autonomous build with deploy/testMode
    // stamped and the terminal ④-success gate a done build carries.
    task.status = 'done';
    task.deploy = 'selfhost';
    task.testMode = 'live';
    task.gate = { actions: [] };

    await runLiveTest(task, ctx); // the route dispatches exactly this
    assert.equal(task.status, 'awaiting_confirm', 'done → running → parks at the live verdict gate');
    assert.equal(task.gate?.flag, 'test_result');
    assert.equal(task.liveTest?.verdict, 'passed');

    await finishLiveAccepted(task, ctx); // the human clicks Accept at the test_result gate
    assert.equal(task.status, 'done', 'accept closes the re-entered build back to done');
    assert.deepEqual(task.gate?.actions, [], 'terminal ④ — no actions');
    assert.equal((await loadTask(dir, task.taskId)).status, 'done', 'persisted done');
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

  // Spec 043: the 0-model gate is CONDITIONAL on the workflow actually containing an llm node.
  test('0-model + LLM workflow → still degrades to static-only at infra_degraded (spec 043 acc#2)', withCreds(async () => {
    const { task, ctx } = await harness({
      resolveLlmModels: async () => ({ enabled: [], pick: null }),
      deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 0, llmCount: 1, patched: [], outFile: outRel, inputs: [], mode: 'workflow', stderr: '' }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.equal(task.liveTest?.verdict, 'infra_fail');
    assert.equal(task.liveTest?.label, 'static-only');
    assert.match(task.liveTest?.reason ?? '', /0-model/);
  }));

  // Spec 087 S2 widened what `llmCount` COUNTS (llm + parameter-extractor + question-classifier),
  // but the count is minted in sync.py and `deployWithModel` is stubbed in every test here — so a
  // TS test naming a node type would only be asserting its own stub. Two such tests were written
  // and deleted for exactly that reason (they were byte-equal in inputs to the 043 pair above and
  // stayed green with S1 reverted). The widening is locked where it is real:
  //   tests/test_sync.py::test_model_types_matches_runnability  (which types carry a model)
  //   tests/test_sync.py::test_inject_patches_exactly_what_the_probe_calls_empty  (which get patched)
  // The 043 pair above still locks what THIS file owns: the gate keys off llmCount, not nodeCount.

  test('0-model + LLM-less workflow → RUNS the live test model-free (spec 043 acc#1)', withCreds(async () => {
    const { task, ctx } = await harness({
      resolveLlmModels: async () => ({ enabled: [], pick: null }),
      deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 0, llmCount: 0, patched: [], outFile: outRel, inputs: [], mode: 'workflow', stderr: '' }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'test_result', 'imports + runs instead of parking at infra_degraded');
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.liveTest?.model ?? null, null, 'no model shown for a model-agnostic run');
    assert.match(task.liveTest?.reason ?? '', /no model needed/);
  }));

  test('transport error (status null) → infra_degraded (not workflow_fail)', withCreds(async () => {
    const { task, ctx } = await harness({
      runWorkflow: async () => ({ ok: false, status: null, outputs: null, error: 'timeout', totalTokens: null }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.equal(task.liveTest?.verdict, 'infra_fail');
  }));

  test('undrivable input (truly unknown type) → need_input, parked at test_result', withCreds(async () => {
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, llmCount: 1, patched: [], outFile: outRel, mode: 'workflow',
        // 'custom-widget' is not a recognised type → resolveInput puts it in missing → need_input
        inputs: [{ variable: 'widget', type: 'custom-widget', required: true }], stderr: '',
      }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'test_result');
    assert.equal(task.liveTest?.verdict, 'need_input');
    assert.deepEqual(task.liveTest?.needInputVars, ['widget']);
  }));

  // spec 047 S2 — a local_file input uploads a bundled sample then runs with a real upload_file_id.
  test('file-list (local_file) input → uploads a sample, runs with a file-object, passes', withCreds(async () => {
    let uploadCalled = false;
    let seenInputs: Record<string, unknown> = {};
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, llmCount: 0, patched: [], outFile: outRel, mode: 'workflow',
        inputs: [{ variable: 'input_file', type: 'file-list', required: true, allowed_file_upload_methods: ['local_file', 'remote_url'], allowed_file_types: ['document'], allowed_file_extensions: ['.xlsx'] }],
        stderr: '',
      }),
      uploadSampleFile: async () => { uploadCalled = true; return 'up-xlsx-1'; },
      runWorkflow: async (_d, _k, _m, inputs) => {
        seenInputs = inputs;
        return { ok: true, status: 'succeeded', outputs: { count: 2 }, error: null, totalTokens: 7 };
      },
    });
    await runLiveTest(task, ctx);
    assert.equal(uploadCalled, true, 'uploaded a bundled sample');
    assert.deepEqual(seenInputs.input_file, [{ transfer_method: 'local_file', upload_file_id: 'up-xlsx-1', type: 'document' }]);
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.gate?.flag, 'test_result');
  }));

  // spec 047 S4 — a file input that ONLY allows remote_url can't be built → honest degrade, NEVER a run/hang.
  test('file input (only remote_url) → degrade-static with the var name, no run', withCreds(async () => {
    let ran = false;
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, llmCount: 0, patched: [], outFile: outRel, mode: 'workflow',
        inputs: [{ variable: 'remote_doc', type: 'file', required: true, allowed_file_upload_methods: ['remote_url'] }],
        stderr: '',
      }),
      runWorkflow: async () => { ran = true; return { ok: true, status: 'succeeded', outputs: {}, error: null, totalTokens: 0 }; },
    });
    await runLiveTest(task, ctx);
    assert.equal(ran, false, 'never issues a run for an unbuildable input');
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.equal(task.liveTest?.verdict, 'infra_fail');
    assert.match(task.liveTest?.reason ?? '', /remote_doc/);
  }));

  // spec 047 S2 — upload failure is infra, not a workflow fault → degrade (never send an empty id / hang).
  test('file input but upload fails → infra_degraded (not a run)', withCreds(async () => {
    let ran = false;
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, llmCount: 0, patched: [], outFile: outRel, mode: 'workflow',
        inputs: [{ variable: 'f', type: 'file', required: true, allowed_file_upload_methods: ['local_file'] }],
        stderr: '',
      }),
      uploadSampleFile: async () => null,
      runWorkflow: async () => { ran = true; return { ok: true, status: 'succeeded', outputs: {}, error: null, totalTokens: 0 }; },
    });
    await runLiveTest(task, ctx);
    assert.equal(ran, false);
    assert.equal(task.gate?.flag, 'infra_degraded');
    assert.match(task.liveTest?.reason ?? '', /upload a sample file/);
  }));


  test('advanced-chat app → runWorkflow gets mode+query, passes (chat via /chat-messages)', withCreds(async () => {
    let seenMode = '';
    let seenQuery = '';
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({ ok: true, nodeCount: 1, llmCount: 1, patched: ['llm'], outFile: outRel, inputs: [], mode: 'advanced-chat', stderr: '' }),
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

  // Spec 057 S4 — a trigger-entry build runs the SAME ④ flow (r3 probes: /workflows/run works); only
  // the manual-enable advisory is appended to the reason. Verdict/label/gate flag stay untouched.
  test('trigger entryTypes → passed at test_result, reason carries the manual-enable note (additive)', withCreds(async () => {
    const { task, ctx } = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 0, llmCount: 0, patched: [], outFile: outRel, inputs: [], mode: 'workflow',
        entryTypes: ['trigger-schedule'], stderr: '',
      }),
    });
    await runLiveTest(task, ctx);
    assert.equal(task.gate?.flag, 'test_result', 'the ④ flow is UNCHANGED — no special park');
    assert.equal(task.liveTest?.verdict, 'passed');
    assert.equal(task.liveTest?.label, 'live-verified');
    assert.match(task.liveTest?.reason ?? '', /ran OK/, 'the normal run summary still leads');
    assert.ok(
      (task.liveTest?.reason ?? '').includes(
        'trigger-entry workflow: the run above was a manual fire — a schedule or webhook starts ' +
          'firing on its own only once you PUBLISH the workflow in Dify Studio'
      ),
      'the wording-stable EN advisory is appended'
    );
  }));

  test('start entryTypes (and absent entryTypes) → NO trigger note in the reason', withCreds(async () => {
    // explicit ['start']
    const a = await harness({
      deployWithModel: async (_d, _s, outRel) => ({
        ok: true, nodeCount: 1, llmCount: 1, patched: ['n1'], outFile: outRel, inputs: [], mode: 'workflow',
        entryTypes: ['start'], stderr: '',
      }),
    });
    await runLiveTest(a.task, a.ctx);
    assert.equal((a.task.liveTest?.reason ?? '').includes('trigger-entry workflow'), false);
    // absent (older sync.py) → assume start (okOps' deployWithModel has no entryTypes)
    const b = await harness({});
    await runLiveTest(b.task, b.ctx);
    assert.equal((b.task.liveTest?.reason ?? '').includes('trigger-entry workflow'), false);
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
    assert.equal(task.appId, 'app-123'); // review #1: current app NOT deleted → pointer kept (no dead link)
    assert.ok(task.appUrl?.includes('app-123'));
  }));

  test('spec 036: cleanupTestApps keepCurrent deletes only the OLD apps; default deletes all', async () => {
    const deletedIds: string[] = [];
    const { task, ctx } = await harness({ deleteApp: async (_d, id) => { deletedIds.push(id); return true; } });
    // Simulate 3 accumulated test apps (current = app-3), parked at the live verdict gate.
    task.testApps = ['app-1', 'app-2', 'app-3'];
    task.appId = 'app-3';
    task.appUrl = 'http://x/app/app-3/workflow';
    task.status = 'awaiting_confirm';
    task.gate = { actions: [], flag: 'test_result' };
    task.liveTest = { verdict: 'passed', label: 'live-verified', appId: 'app-3', appUrl: 'http://x/app/app-3/workflow' };

    // keepCurrent → delete every app EXCEPT the current one ("Delete old apps").
    await cleanupTestApps(task, ctx, true);
    assert.deepEqual(deletedIds.sort(), ['app-1', 'app-2'], 'only the OLD apps were deleted');
    assert.deepEqual(task.testApps, ['app-3'], 'the current app is kept');
    assert.equal(task.appId, 'app-3', 'current pointer untouched');
    assert.equal(task.gate?.flag, 'test_result', 're-parked the same live gate');

    // default (no keepCurrent) → delete ALL, incl. the current one (its pointer nulls → no dead link).
    deletedIds.length = 0;
    await cleanupTestApps(task, ctx);
    assert.deepEqual(deletedIds, ['app-3']);
    assert.deepEqual(task.testApps, []);
    assert.equal(task.appId, null, 'deleting the current app nulls appId');
  });

  test('spec 036: a re-test AUTO-DELETES the prior test apps (no accumulation)', withCreds(async () => {
    let n = 0;
    const deletedIds: string[] = [];
    const { task, ctx } = await harness({
      importForTest: async () => ({ ok: true, appId: `app-${++n}`, stderr: '' }), // a fresh id per run
      deleteApp: async (_d, id) => { deletedIds.push(id); return true; },
    });
    await runLiveTest(task, ctx); // 1st run → app-1 (no prior to delete)
    assert.deepEqual(task.testApps, ['app-1']);
    assert.deepEqual(deletedIds, []);

    await runLiveTest(task, ctx); // 2nd run → app-2, auto-deletes the prior app-1
    assert.deepEqual(deletedIds, ['app-1'], 'the prior app was auto-deleted on the re-test');
    assert.deepEqual(task.testApps, ['app-2'], 'only the current app remains — apps never accumulate');
    assert.equal(task.appId, 'app-2');
  }));
});

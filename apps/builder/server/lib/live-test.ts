/**
 * live-test.ts — spec 032 S3-wiring-b: the Phase ④ LIVE sub-orchestrator (backend). Runs ONLY when the
 * user picks `test_live`; the static path (runTestAndFinish/runImportAndFinish) is untouched.
 *
 * Flow (B1 lint baseline FIRST → model-resolve → deploy.yml → import → publish → mint → run → T1), with
 * `isCancelled` between steps (B2), degrade-to-static on an infra reason (D1c), and a HUMAN gate on every
 * result (auto hard-stops at `test_result`, B4 — v1 never auto-dones; the judge/fixtures that would gate a
 * clean auto-done arrive in S4). Every Dify call goes through the injectable `liveOps` seam (013 D2) so
 * the FSM is unit-testable without a real Dify.
 */
import { computeGate } from './gate.js';
import { difyCreds, appUrlFrom, unregisterSecret, type InputVar } from './dify-io.js';
import { emit, resolveRunners, resolveLiveOps, type OrchestratorCtx } from './orchestrator-shared.js';
import { isCancelled } from './lock.js';
import type { LiveTestResult, Task } from '../state/task.js';

const RUN_TIMEOUT_MS = Number(process.env.BUILDER_LIVE_RUN_TIMEOUT_MS) || 120_000;
const INFRA_RUN_RETRY = 2; // OQ2 default — retry only the (transient) run step, never re-import

/**
 * Build a sample run input from the start-node schema (D8). Fills REQUIRED text/paragraph/number with a
 * sample; a required select/file/… can't be safely guessed → `missing` (→ `need_input`, park). Optional
 * vars are left unset (Dify uses their default/empty). Pure.
 */
export function resolveInput(vars: InputVar[]): { inputs: Record<string, unknown>; missing: string[] } {
  const inputs: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const v of vars) {
    if (!v.variable || !v.required) continue;
    const t = (v.type || '').toLowerCase();
    if (t === 'text-input' || t === 'paragraph' || t === 'text') {
      inputs[v.variable] = `Sample input for "${v.label || v.variable}" (builder live-test).`;
    } else if (t === 'number') {
      inputs[v.variable] = 1;
    } else {
      missing.push(v.variable); // select / file / file-list / unknown → can't derive
    }
  }
  return { inputs, missing };
}

const lastLine = (s: string): string => s.trim().split('\n').slice(-1)[0] || '';

/**
 * The live-test sub-orchestrator. `opts.deleteOldAppId` (a re-test with the "delete old app" checkbox)
 * deletes the prior app AFTER the new import succeeds. Always ends parked at a human gate (`test_result`
 * or `infra_degraded`) or `error`; never silently `done`.
 */
export async function runLiveTest(
  task: Task,
  ctx: OrchestratorCtx,
  opts?: { deleteOldAppId?: string | null }
): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx);
  const live = resolveLiveOps(ctx);

  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const bail = (): boolean => isCancelled(task.taskId);
  const parkResult = async (lt: LiveTestResult): Promise<void> => {
    task.liveTest = lt;
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'test_result' }, task.deploy);
    await emit(task, ctx);
  };
  const degradeStatic = async (reason: string, partial?: Partial<LiveTestResult>): Promise<void> => {
    // D1c: an INFRA reason (not a workflow fault). The static lint result stands; park a degrade confirm.
    task.liveTest = { verdict: 'infra_fail', label: 'static-only', reason, ...partial };
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'infra_degraded' }, task.deploy);
    await emit(task, ctx);
  };

  const creds = difyCreds();
  if (!creds.url || !creds.token) return degradeStatic('no Dify console creds in the backend env');

  // B1: run the static lint report FIRST — the baseline `static PASS` a degrade falls back to.
  const report = await runReport(projectsDir, task, log, {});
  if (bail()) return;
  if (!report.ok) {
    task.status = 'error';
    task.error = report.reasons.join(' | ');
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    return;
  }

  // 1. resolve the workspace model (enabled set + D4 pick).
  const { enabled, pick } = await live.resolveLlmModels(projectsDir);
  if (bail()) return;
  if (!pick) return degradeStatic('no enabled LLM model in the workspace (0-model)');

  // 2. inject the model into a TEMP deploy.yml (main.yml on disk stays model-agnostic, B5) + read inputs.
  const srcRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
  const outRel = `apps/builder/.runs/${task.taskId}/deploy.yml`;
  const dep = await live.deployWithModel(projectsDir, srcRel, outRel, pick, enabled.map((m) => m.name));
  if (bail()) return;
  if (!dep.ok || !dep.outFile) return degradeStatic(`model inject failed: ${lastLine(dep.stderr) || 'unknown'}`, { model: pick });

  // 3. sample input from the start-node schema (D8). Can't derive → honest park (not infra, not workflow).
  const { inputs, missing } = resolveInput(dep.inputs);
  if (missing.length) {
    return parkResult({
      verdict: 'need_input',
      label: 'live-verified-fail',
      model: pick,
      modelAutofilled: dep.nodeCount,
      needInputVars: missing,
      reason: `cần input mẫu cho: ${missing.join(', ')} — cung cấp qua /reply rồi test lại`,
    });
  }

  // 4. import the deploy.yml as a NEW app (A2 — no push_intent/reconcile).
  const appName = task.name ?? task.workflowSlug!;
  const imp = await live.importForTest(projectsDir, task.project!, task.workflowSlug!, dep.outFile, appName);
  if (bail()) return;
  if (!imp.ok || !imp.appId) {
    return degradeStatic(`import failed: ${lastLine(imp.stderr) || 'no app id'}`, { model: pick, modelAutofilled: dep.nodeCount });
  }
  const appId = imp.appId;
  const appUrl = appUrlFrom(creds.url, appId);
  task.testApps = [...(task.testApps ?? []), appId];
  task.appId = appId;
  task.appUrl = appUrl;
  await emit(task, ctx); // surface the new app_url promptly

  // Re-test with the "delete old app" checkbox: remove the prior app now that the new one exists (Q3).
  if (opts?.deleteOldAppId && opts.deleteOldAppId !== appId) {
    await live.deleteApp(projectsDir, opts.deleteOldAppId).catch(() => {});
    task.testApps = (task.testApps ?? []).filter((id) => id !== opts.deleteOldAppId);
  }

  // Chat-like apps (advanced-chat / chat / agent-chat) run via /chat-messages and need a `query` message;
  // workflow apps run via /workflows/run with just inputs.
  const isChat = /chat/.test(dep.mode);
  const query = isChat ? 'Hello — this is a builder live-test message. Please reply.' : '';
  const runInput = query ? { ...inputs, query } : inputs;
  const base: Partial<LiveTestResult> = { model: pick, modelAutofilled: dep.nodeCount, appId, appUrl, input: runInput };

  // 5. publish (import does NOT auto-publish).
  const pub = await live.publishWorkflow(projectsDir, appId);
  if (bail()) return;
  if (!pub.ok) return degradeStatic(`publish failed: ${lastLine(pub.stderr) || 'unknown'}`, base);

  // 6. mint an app key (registered for redaction inside mintAppKey, B3).
  const key = await live.mintAppKey(projectsDir, appId);
  if (bail()) return;
  if (!key) return degradeStatic('could not mint an app API key', base);

  // 7. run — mode-aware (workflow vs chat); retry only the transient (transport/timeout) case, never re-import.
  let run = await live.runWorkflow(projectsDir, key, dep.mode, inputs, query, RUN_TIMEOUT_MS);
  for (let i = 0; i < INFRA_RUN_RETRY && !run.ok && run.status === null; i++) {
    if (bail()) { unregisterSecret(key); return; }
    run = await live.runWorkflow(projectsDir, key, dep.mode, inputs, query, RUN_TIMEOUT_MS);
  }
  unregisterSecret(key); // done with the key (bounded registry lifetime, B3)
  if (bail()) return;

  base.totalTokens = run.totalTokens;
  // status===null ⇒ transport/timeout ⇒ INFRA (not a workflow fault). status==='failed' / empty ⇒ workflow_fail.
  if (!run.ok && run.status === null) {
    return degradeStatic(`run could not complete: ${run.error ?? 'infra error'}`, base);
  }
  const outputNonEmpty = !!run.outputs && Object.keys(run.outputs).length > 0;
  const t1Pass = run.ok && outputNonEmpty; // T1 mechanical
  return parkResult({
    verdict: t1Pass ? 'passed' : 'workflow_fail',
    label: t1Pass ? 'live-verified' : 'live-verified-fail',
    ...base,
    output: run.outputs,
    runError: run.error,
    t1Pass,
    reason: t1Pass
      ? `ran OK on ${pick.name} (${run.totalTokens ?? '?'} tokens) — review the output below`
      : run.error
        ? `workflow ran but FAILED: ${run.error}`
        : 'workflow ran but produced no output',
  });
}

/** Accept a parked live result (verdict gate `accept`) or the degraded static result (`accept_static`) →
 *  finish `done`. The report.json is already written (B1); this just closes the build. */
export async function finishLiveAccepted(task: Task, ctx: OrchestratorCtx): Promise<void> {
  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy);
  await emit(task, ctx);
}

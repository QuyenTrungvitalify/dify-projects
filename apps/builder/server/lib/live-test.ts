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
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeGate } from './gate.js';
import { difyCreds, appUrlFrom, unregisterSecret, type InputVar } from './dify-io.js';
import { emit, resolveRunners, resolveLiveOps, type OrchestratorCtx } from './orchestrator-shared.js';
import { isCancelled, setSession, clearSession } from './lock.js';
import { ClaudeSession } from './claude-session.js';
import { renderPrompt } from './phases.js';
import { criteriaRel } from './criteria.js';
import type { LiveTestResult, JudgeVerdict, Task } from '../state/task.js';

const RUN_TIMEOUT_MS = Number(process.env.BUILDER_LIVE_RUN_TIMEOUT_MS) || 120_000;
const JUDGE_TIMEOUT_MS = 3 * 60 * 1000; // T3 judge is a short data-only turn
const INFRA_RUN_RETRY = 2; // OQ2 default — retry only the (transient) run step, never re-import
const JUDGE_SKILL = '.claude/skills/dify-build/judge.md';

/** Read the Acceptance-Criteria rubric persisted at spec-verify (A3). [] when absent → smoke-test only. */
async function readCriteria(projectsDir: string, taskId: string): Promise<string[]> {
  try {
    const raw = await readFile(join(projectsDir, criteriaRel(taskId)), 'utf8');
    const obj = JSON.parse(raw) as { criteria?: unknown };
    return Array.isArray(obj.criteria) ? obj.criteria.filter((c): c is string => typeof c === 'string') : [];
  } catch {
    return [];
  }
}

/** Extract a JSON object from an LLM message. Prefers ```json fenced blocks (LAST first — the final
 *  answer is usually last), then falls back to the WIDEST `{ … }` span (first `{` to last `}`), which
 *  recovers a non-fenced object including nested ones (review #3). Never throws; null if none parse. */
export function extractJson(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  const fences = text.match(/```(?:json)?\s*[\s\S]*?```/gi) ?? [];
  for (const f of fences.reverse()) candidates.push(f.replace(/```(?:json)?/i, '').replace(/```\s*$/, '').trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj as Record<string, unknown>;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Parse the judge's message → a structured verdict (ADVISORY). null when no criteria array is found. */
export function parseJudgeVerdict(text: string): JudgeVerdict | null {
  const obj = extractJson(text);
  if (!obj || !Array.isArray(obj.criteria)) return null;
  const criteria = (obj.criteria as Array<Record<string, unknown>>)
    .map((c) => ({
      criterion: typeof c.criterion === 'string' ? c.criterion : '',
      pass: c.pass === true,
      evidence: typeof c.evidence === 'string' ? c.evidence : undefined,
    }))
    .filter((c) => c.criterion);
  return { criteria, summary: typeof obj.summary === 'string' ? obj.summary : undefined };
}

/**
 * T3 judge (spec 032 D3/S4) — a DATA-ONLY turn: grade the run OUTPUT against the Acceptance Criteria.
 * No creds (spec 015 strips DIFY_* from every turn), no tools needed (all data is in the prompt). ADVISORY:
 * a failure/parse-miss returns null and never flips T1 or the gate. Injectable via the runTurn seam.
 */
async function runJudge(
  task: Task,
  ctx: OrchestratorCtx,
  criteria: string[],
  input: Record<string, unknown>,
  output: Record<string, unknown> | null
): Promise<JudgeVerdict | null> {
  if (!criteria.length) return null; // no rubric → smoke-test only (A3)
  const { projectsDir, settingsPath, log } = ctx;
  const { runTurn } = resolveRunners(ctx);
  let body: string;
  try {
    body = await readFile(join(projectsDir, JUDGE_SKILL), 'utf8');
  } catch {
    return null;
  }
  const prompt = renderPrompt(body, {
    REQUIREMENT: task.requirement,
    CRITERIA: criteria.map((c, i) => `${i + 1}. ${c}`).join('\n'),
    INPUT: JSON.stringify(input),
    OUTPUT: JSON.stringify(output ?? {}),
  });
  const session = new ClaudeSession(`${task.taskId}:judge`, {
    taskId: task.taskId,
    workingDir: projectsDir,
    settingsPath,
    log,
  });
  setSession(task.taskId, session); // hand the child to /cancel
  let text = '';
  const turn = await runTurn(session, prompt, () => {}, {
    timeoutMs: JUDGE_TIMEOUT_MS,
    onText: (t) => {
      text += t;
    },
  });
  clearSession(task.taskId);
  if (turn.isError) return null;
  return parseJudgeVerdict(text);
}

/**
 * A publicly accessible 1-page PDF used as a placeholder for `file`/`file-list` inputs during the
 * builder live-test. Chosen for: tiny size, stable URL (W3C sample document), plain PDF (no auth).
 * Dify accepts a URL as a file value when the workflow's file-upload mode allows remote URLs.
 */
const SAMPLE_FILE_URL = 'https://www.w3.org/WAI/WCAG21/Techniques/pdf/img/table-word.pdf';

/**
 * Build a sample run input from the start-node schema (D8). Fills REQUIRED variables automatically:
 * - text / paragraph / text-input → short sample string
 * - number                        → 1
 * - select                        → first option from `options[]` (or 'option_a' fallback)
 * - file                          → SAMPLE_FILE_URL placeholder (a tiny W3C PDF)
 * - file-list                     → [SAMPLE_FILE_URL]
 * - boolean                       → true
 * - truly unknown types           → `missing` (→ `need_input`, park)
 * Optional vars are left unset (Dify uses their default/empty). Pure.
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
    } else if (t === 'select') {
      // Pick the first declared option; fall back to a generic string when options is absent/empty.
      inputs[v.variable] = Array.isArray(v.options) && v.options.length > 0 ? v.options[0] : 'option_a';
    } else if (t === 'file') {
      // Dify accepts a URL string for file inputs when the app's upload mode allows remote URLs.
      // Using a stable, tiny W3C PDF so the workflow can at least attempt to process it.
      inputs[v.variable] = SAMPLE_FILE_URL;
    } else if (t === 'file-list') {
      inputs[v.variable] = [SAMPLE_FILE_URL];
    } else if (t === 'boolean') {
      inputs[v.variable] = true;
    } else {
      missing.push(v.variable); // truly unknown type → can't derive a safe value
    }
  }
  return { inputs, missing };
}

const lastLine = (s: string): string => s.trim().split('\n').slice(-1)[0] || '';

/**
 * The live-test sub-orchestrator. Spec 036: a re-test that creates a new app AUTO-DELETES every PRIOR test
 * app of this build, so apps don't accumulate across re-tests — only the current run's app remains. Always
 * ends parked at a human gate (`test_result` or `infra_degraded`) or `error`; never silently `done`.
 */
export async function runLiveTest(
  task: Task,
  ctx: OrchestratorCtx
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

  // 1. resolve the workspace model (enabled set + D4 pick). May be empty — do NOT bail yet (spec 043):
  //    a model-agnostic workflow (0 llm nodes) needs no workspace model to run.
  const { enabled, pick } = await live.resolveLlmModels(projectsDir);
  if (bail()) return;

  // 2. inject the model into a TEMP deploy.yml (main.yml on disk stays model-agnostic, B5) + read inputs.
  //    With no model available, pass a placeholder — a workflow with 0 llm nodes patches nothing, so the
  //    copy is valid & model-free. The placeholder is only ever written into an llm node when llmCount>0,
  //    and step 3's gate rejects that deploy.yml BEFORE it is imported, so a bad copy never reaches Dify.
  const srcRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
  const outRel = `apps/builder/.runs/${task.taskId}/deploy.yml`;
  const dep = await live.deployWithModel(projectsDir, srcRel, outRel, pick ?? { provider: '', name: '' }, enabled.map((m) => m.name));
  if (bail()) return;
  if (!dep.ok || !dep.outFile) return degradeStatic(`model inject failed: ${lastLine(dep.stderr) || 'unknown'}`, pick ? { model: pick } : {});

  // 3. 0-model gate — CONDITIONAL (spec 043): only a workflow that CONTAINS an llm node needs a model.
  //    llmCount === 0 (or a real pick) → proceed; a model-agnostic workflow runs model-free.
  if (dep.llmCount > 0 && !pick) {
    return degradeStatic('no enabled LLM model in the workspace (0-model)', { modelAutofilled: dep.nodeCount });
  }

  // 3. sample input from the start-node schema (D8). Can't derive → honest park (not infra, not workflow).
  const { inputs, missing } = resolveInput(dep.inputs);
  if (missing.length) {
    return parkResult({
      verdict: 'need_input',
      label: 'live-verified-fail',
      model: pick,
      modelAutofilled: dep.nodeCount,
      needInputVars: missing,
      reason: `need sample input for: ${missing.join(', ')} — provide it via /reply then test again`,
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
  const priorApps = (task.testApps ?? []).filter((id) => id !== appId); // apps from EARLIER runs of this build
  task.testApps = [...(task.testApps ?? []), appId];
  task.appId = appId;
  task.appUrl = appUrl;
  await emit(task, ctx); // surface the new app_url promptly

  // Spec 036: a NEW test app supersedes the old ones — auto-delete every PRIOR test app so they don't pile
  // up across re-tests (the reported "app 1→5" accumulation). Best-effort: a failed delete is left in the
  // list (cleaned via "Delete test apps"). Only the just-created app remains as the current one.
  for (const oldId of priorApps) {
    const ok = await live.deleteApp(projectsDir, oldId).catch(() => false);
    if (ok) task.testApps = (task.testApps ?? []).filter((id) => id !== oldId);
  }
  if (priorApps.length) await emit(task, ctx); // reflect the pruned list

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

  // T3 (advisory, spec 032 D3): grade the OUTPUT against the Acceptance Criteria. Skipped when there is
  // no output or no rubric. NEVER flips T1 or the gate outcome — it's enrichment for the human decision.
  let judge: JudgeVerdict | undefined;
  if (outputNonEmpty) {
    const criteria = await readCriteria(projectsDir, task.taskId);
    if (bail()) return;
    judge = (await runJudge(task, ctx, criteria, runInput, run.outputs)) ?? undefined;
    if (bail()) return;
  }

  return parkResult({
    verdict: t1Pass ? 'passed' : 'workflow_fail',
    label: t1Pass ? 'live-verified' : 'live-verified-fail',
    ...base,
    output: run.outputs,
    runError: run.error,
    t1Pass,
    judge,
    reason: t1Pass
      ? `ran OK (${dep.nodeCount > 0 ? `auto-filled ${dep.nodeCount} node(s) with ${pick?.name}` : 'no model needed (deterministic)'}, ${run.totalTokens ?? '?'} tokens) — review the output below`
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

/**
 * S6 — delete THIS build's test apps (Q3/Q4 cleanup): `DELETE /console/api/apps/{id}` (the minted
 * app-keys die with the app). Spec 036: `keepCurrent` deletes every app EXCEPT the current one ("Delete
 * old apps"); else delete ALL ("Delete test apps"). Then re-park the SAME live gate with the deleted ids
 * removed, so the human can still Accept/Discard the result. Best-effort: a failed delete leaves that id.
 */
export async function cleanupTestApps(task: Task, ctx: OrchestratorCtx, keepCurrent = false): Promise<void> {
  const { projectsDir } = ctx;
  const live = resolveLiveOps(ctx);
  const all = task.testApps ?? [];
  // keepCurrent → delete every app EXCEPT the current one (the "Delete old apps" button); else delete ALL.
  const targets = keepCurrent ? all.filter((id) => id !== task.appId) : all;
  const remaining: string[] = [...all];
  let deleted = 0;
  for (const id of targets) {
    const ok = await live.deleteApp(projectsDir, id).catch(() => false);
    if (ok) {
      const i = remaining.indexOf(id);
      if (i >= 0) remaining.splice(i, 1); // drop only the ones that actually deleted (a fail keeps it)
      deleted++;
    }
  }
  task.testApps = remaining;
  // Null the current-app pointers ONLY if that app is actually gone (a partial multi-app cleanup can
  // delete some ids and keep others) — otherwise the gate would show a dead link (review #1).
  if (task.appId && !remaining.includes(task.appId)) {
    task.appId = null;
    task.appUrl = null;
    if (task.liveTest) task.liveTest.appUrl = null;
  }
  if (deleted > 0 && task.liveTest) {
    task.liveTest.reason = `${task.liveTest.reason ?? ''} (${deleted} test app(s) deleted)`.trim();
  }
  // re-park the SAME gate (outcome unchanged — the result still stands; only the apps are gone).
  const outcome = task.gate?.flag === 'infra_degraded' ? 'infra_degraded' : 'test_result';
  task.status = 'awaiting_confirm';
  task.gate = computeGate('test', { outcome }, task.deploy);
  await emit(task, ctx);
}

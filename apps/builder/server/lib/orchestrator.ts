/**
 * orchestrator.ts — the GATED phase state machine for spec 009 Lát 3 (the crux).
 *
 * Lát 2 was one auto-advancing loop. Lát 3 splits it into entry points each driven by a SEPARATE
 * HTTP request, so the build pauses at `awaiting_confirm` between phases and only the next request
 * issues the next turn (the gate is enforced by *who issues the turn*, not a soft "stop", §D):
 *
 *   - startTask     — POST /api/tasks   → runPhase(①) → gate → maybeAutoAdvance
 *   - confirmAdvance — POST /confirm     → run the NEXT phase as a fresh turn (no cross-phase resume)
 *   - replyWithin   — POST /reply        → re-run the CURRENT phase via --resume, re-gate, no advance
 *
 * ①②③ are fresh `claude` turns (model C, via ClaudeSession); ④ is backend (report.ts, no turn).
 * Verify is NEVER `is_error` alone (spike E5): ③ runs the full Lát-1 post-turn check, ①/② check
 * artifact-exists/non-empty + confinement-with-revert. The scaffold (`init_project.py` + SPEC.md
 * move) is re-homed from Lát 2's raw advance to the ②→③ `/confirm` (AC #18).
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ClaudeSession } from './claude-session.js';
import { confinementCheck, gitDirtyPaths, type PostTurnDetail } from './post-turn.js';
import { type TurnResult } from './turn-runner.js';
import { PHASES, renderPrompt, languagePin, type PhaseDef } from './phases.js';
import { attachmentBlock } from './attachments.js';
import { snapshotDiffBase, writeDiffArtifact } from './diff.js';
import { lintClean, type LintCodes } from './linters.js';
import { computeGate, type GateOutcome } from './gate.js';
import { clearSession, isCancelled, setSession, turnHolderId } from './lock.js';
import { emit, errMsg, httpError, resolveLiveOps, resolveRunners, type OrchestratorCtx, type ConfirmPayload } from './orchestrator-shared.js';
import { deriveSlugName, firstFreeSlug } from './slug.js';
import { difySeedScaffoldAndPull, localEditSeed, scaffoldAtSpecGate, relocateRunArtifacts } from './scaffold.js';
import { runImportAndFinish, finishWithoutImport } from './import.js';
import { runLiveTest, finishLiveAccepted, cleanupTestApps } from './live-test.js';
import { difyTargets, harvestWorkspaceFacts, knowledgeBlock, loadWorkspaceFacts, redactSecrets } from './dify-io.js';
import { applyAnalysisToTask } from './analysis.js';
import { checkRunnability, preflightNote } from './runnability.js';
import { persistCriteria } from './criteria.js';
import { saveTask, type Task } from '../state/task.js';

// L2 (spec 019): the runner seams, ctx types, ConfirmPayload, and emit/errMsg/httpError moved to
// orchestrator-shared.ts (a leaf the extracted scaffold/import modules can import without a cycle); the
// pure slug helpers moved to slug.ts; the scaffold/seed IO moved to scaffold.ts. Re-export the public
// surface so routes/tasks.ts + the tests keep importing them from here unchanged.
export type { OrchestratorCtx, OrchestratorRunners, ConfirmPayload } from './orchestrator-shared.js';
export { deriveSlugName, firstFreeSlug };
export { localEditSeed };

/** Per-turn wall-clock budget (spec §I default 10 min). Env-tunable (spec 048 D1, the
 *  BUILDER_LIVE_RUN_TIMEOUT_MS idiom): read ONCE at module load, so a change needs a restart. */
export const TURN_TIMEOUT_MS = Number(process.env.BUILDER_TURN_TIMEOUT_MS) || 10 * 60 * 1000;

interface PhaseVerify {
  outcome: GateOutcome;
  reasons: string[];
  /** ③'s lint exit codes (spec 048 D2) — threaded to ④ ONLY on the windowless maybeAutoAdvance
   *  ③→④ hop (same dispatched request, turn lock held), so runReport skips the identical re-run.
   *  Every path with a human window (each_step continue, ④ accept, /reply) re-runs (037 r2). */
  lintCodes?: LintCodes;
}

// ───────────────────────────── entry points (one per HTTP request) ─────────────────────────────

/** POST /api/tasks core: run Phase ① then gate; `maybeAutoAdvance` honors Confirm-mode from there.
 *  A Dify-seed build first scaffolds + pulls the chosen app (backend, before the Analyze turn). */
export async function startTask(task: Task, ctx: OrchestratorCtx): Promise<void> {
  if (task.seedAppId) {
    try {
      await difySeedScaffoldAndPull(task, ctx);
    } catch (e) {
      task.status = 'error';
      task.error = `Dify-seed setup failed: ${errMsg(e)}`;
      task.gate = computeGate('analyze', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock; /reply re-acquires to retry (§I)
    }
    if (isCancelled(task.taskId)) return;
  } else if (task.workflow) {
    // Edit-existing of a LOCAL workflow (no Dify seed): resolve the chosen slug into a real seed so
    // Analyze summarizes it and the diff has a pre-edit base (closes the targeting gap, GAP #14).
    try {
      await localEditSeed(task, ctx);
    } catch (e) {
      task.status = 'error';
      task.error = `edit-existing setup failed: ${errMsg(e)}`;
      task.gate = computeGate('analyze', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return;
    }
    if (isCancelled(task.taskId)) return;
  }
  // Spec 028: a fast build (from-scratch single-LLM; seed/edit/slug already forced fastMode:false, so
  // task.workflowSlug is null here) SKIPS the standalone Analyze turn+gate — `runPhaseAndGate('spec')` runs the
  // merged Analyze+Spec `draft.md` (the `spec` slot's fast, pre-scaffold promptFile) and stops at the
  // Spec gate. The Analyze gate is simply never emitted.
  let startPhase: 'analyze' | 'spec' = task.fastMode ? 'spec' : 'analyze';
  // Spec 046 D1: a from-scratch STANDARD build's Analyze is a CONSTANT — the 027 honesty rules force
  // the seedless turn to write `{seed:null, pattern:"custom"}` + one note and STOP (no find_query, no
  // change_points), so a model turn (~40s + a spawn + a 10-min slot) and a nothing-to-review gate
  // bought zero information. The backend authors the exact 027-honest constant itself and starts at
  // Spec (the 028 skip precedent; standard `spec.md` still gets PRIOR_ARTIFACT = this real file).
  // SEEDED builds keep the full Analyze turn — seed summary/change_points are where its value lives.
  if (!task.fastMode && !task.seedAppId && !task.workflow) {
    const analyzeRel = PHASES.find((p) => p.id === 'analyze')!.artifactRel(task);
    const constant = JSON.stringify(
      {
        seed: null,
        pattern: 'custom',
        note: 'from-scratch build — nothing to analyze (backend-written, spec 046 D1)',
      },
      null,
      2
    );
    await writeFile(join(ctx.projectsDir, analyzeRel), constant);
    // Fold like the analyze verify would have: pattern 'custom' + no features → no advisory (O2's
    // documented back-compat path); artifacts.analyze keeps the report/UI links intact.
    applyAnalysisToTask(task, constant, ctx.projectsDir);
    task.artifacts.analyze = analyzeRel;
    startPhase = 'spec';
  }
  await runPhaseAndGate(task, startPhase, ctx);
  if (isCancelled(task.taskId)) return;
  await maybeAutoAdvance(task, ctx);
}

/**
 * POST /api/tasks/:id/confirm core: validate the action, then advance ONE boundary. Closing Spec
 * (②→③) re-homes the scaffold here; Implement→Test (③→④) is backend (no turn). `auto`/`spec_only`
 * recurse via maybeAutoAdvance.
 */
export async function confirmAdvance(
  task: Task,
  actionId: string,
  ctx: OrchestratorCtx,
  payload?: ConfirmPayload,
  // Spec 048 D2: INTERNAL-ONLY (maybeAutoAdvance's windowless hop) — deliberately NOT a ConfirmPayload
  // field: payload is the HTTP request body, and a client-supplied reuseLint could skip the ④ lint
  // re-run on a WINDOWED path (fabricated codes after a gate edit). routes/ never populates this.
  internal?: { reuseLint?: LintCodes }
): Promise<void> {
  if (task.status !== 'awaiting_confirm') {
    throw httpError(409, `task ${task.taskId} is not awaiting confirmation (status: ${task.status})`);
  }
  const action = task.gate?.actions.find((a) => a.id === actionId && a.kind === 'confirm');
  if (!action) {
    throw httpError(409, `'${actionId}' is not a current confirm action for ${task.taskId}`);
  }

  const cur = task.phase;
  // Spec 048 D2: the ③ verify captured here (spec branch) rides to the tail's maybeAutoAdvance — the
  // ONLY consumer is the windowless ③→④ hop inside this same dispatched request (lock still held).
  let implVerify: PhaseVerify | undefined;
  if (cur === 'analyze') {
    await runPhaseAndGate(task, 'spec', ctx);
  } else if (cur === 'spec') {
    try {
      await scaffoldAtSpecGate(task, ctx, payload);
    } catch (e) {
      task.status = 'error';
      task.error = `scaffold failed: ${errMsg(e)}`;
      task.gate = computeGate('spec', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock (§I)
    }
    // A /cancel could have raced the scaffold's awaits (init_project.py / move) — there is no live
    // child then, so the cancel handler flipped the status; converge + bail rather than run Implement.
    if (isCancelled(task.taskId)) {
      task.status = 'cancelled';
      task.gate = undefined;
      await emit(task, ctx);
      return;
    }
    implVerify = await runPhaseAndGate(task, 'implement', ctx);
  } else if (cur === 'implement') {
    // Spec 032: `test_live` → the LIVE sub-orchestrator (import→run→verify). `continue`/`accept` → the
    // STATIC path exactly as before (`accept` = the still-failing human override, lint≠0).
    if (actionId === 'test_live') {
      // Spec 036 D4: stamp the chosen target so report.ts and the /reply-re-runs-live path
      // (replyWithin's `testMode==='live'`) label the verdict as a real selfhost live test — not
      // `deploy=none` (createTask now defaults deploy:'none', S1). The stamp persists via runLiveTest's
      // first `emit` (which saveTasks). testMode='live' also arms the `/reply` re-run to stay live.
      task.deploy = 'selfhost';
      task.testMode = 'live';
      await runLiveTest(task, ctx);
      return; // ④ live parks at its own gate (test_result / infra_degraded) — never falls through
    }
    // 048 D2: reuseLint applies to 'continue' only — 'accept' is always a human click at a
    // still_failing gate (maybeAutoAdvance HARD-STOPS on that flag, so internal is never set there).
    await runTestAndFinish(task, ctx, actionId === 'accept', actionId === 'continue' ? internal?.reuseLint : undefined);
    // deploy=none|cloud → ④ is terminal (status:done) unless lint failed (spec 014 D2 → a ④ accept
    // gate). selfhost-clean → runTestAndFinish parks at the Import gate. Either parked gate is a
    // `flag` that maybeAutoAdvance HARD-STOPS on (D1 deploy / D2 still-failing), so `auto`/`spec_only`
    // wait for the explicit human button rather than auto-confirming (AC #16/#25 reworded).
  } else if (cur === 'test') {
    // Spec 032 live-test ④ gates (distinguished by the gate flag) take precedence over the static ones:
    //   test_result: accept → done · test_live → re-test (new app) · (changes is a /reply)
    //   infra_degraded: retry_live → re-run live · accept_static → done on the static result
    const flag = task.gate?.flag;
    if (actionId === 'test_live' || actionId === 'retry_live') {
      // A re-test ALWAYS makes a NEW app (D5); spec 036: runLiveTest auto-deletes the PRIOR apps so they
      // don't accumulate (the new app supersedes the old ones).
      await runLiveTest(task, ctx);
      return;
    }
    if (actionId === 'cleanup_apps') {
      // S6 / spec 036: delete this build's test apps then re-park the same live gate (the result still
      // stands). `payload.keepCurrent` deletes only the OLD apps (keep the current one); absent → delete all.
      await cleanupTestApps(task, ctx, payload?.keepCurrent === true);
      return;
    }
    if (actionId === 'accept_static' || (actionId === 'accept' && flag === 'test_result')) {
      await finishLiveAccepted(task, ctx); // accept the live/static result → done
      return;
    }
    // ── static ④ gates (unchanged) ──
    // 'import' → backend push + finish; 'skip_import' → done w/o push; 'accept' → the D2 still-failing
    // override (finish `done`, tagged accepted_lint_failure). 'discard' is /cancel.
    if (actionId === 'import') {
      await runImportAndFinish(task, ctx);
    } else if (actionId === 'accept') {
      await runTestAndFinish(task, ctx, /*acceptedLintFailure*/ true);
    } else {
      await finishWithoutImport(task, ctx);
    }
    return; // ④ is terminal
  } else {
    return; // defensively no-op
  }

  if (isCancelled(task.taskId)) return;
  // implVerify.lintCodes is set only when THIS request just ran the ③ verify (spec branch above) —
  // for every other branch this is the plain no-reuse call it always was.
  await maybeAutoAdvance(task, ctx, implVerify?.lintCodes ? { reuseLint: implVerify.lintCodes } : undefined);
}

/**
 * POST /api/tasks/:id/reply core: re-run the CURRENT phase WITHIN the phase via
 * `--resume <sessionIds[phase]>` (Spike E5), re-verify, re-gate WITHOUT advancing. Also the Retry
 * path out of `error` (§I). A /reply never auto-advances — it is a human revise, so it always
 * pauses for the next decision (even in `auto`).
 */
export async function replyWithin(task: Task, text: string, ctx: OrchestratorCtx): Promise<void> {
  if (task.phase === 'test') {
    // Spec 041 (generalizes the spec-032→036 fix): a "Request changes" at ANY ④ gate is a REVISION —
    // the human wants the WORKFLOW changed per their feedback. Route it back through the IMPLEMENT phase
    // (resume the implement session, edit main.yml with the change request), then re-park at the Implement
    // gate — the human re-tests from there via "Test with workflow". This holds for the LIVE gates
    // (test_result/infra_degraded) AND the STATIC gates (awaiting_import/still_failing): a ④ revision is
    // `status==='awaiting_confirm'`. The signal is `status`, NOT `testMode`, so the static gates now edit
    // the workflow instead of silently re-running the report on the UNCHANGED main.yml.
    //   (History: 032 dropped `text` and re-ran runLiveTest on the unchanged workflow → the edit no-op'd;
    //    036 fixed it for the live path only; 041 extends the same correct routing to every ④ gate.)
    if (task.status === 'awaiting_confirm' && task.sessionIds.implement) {
      await runPhaseAndGate(task, 'implement', ctx, { resumeId: task.sessionIds.implement, replyText: text });
      return;
    }
    // Retry OUT OF ERROR (status==='error'), or no implement session to resume: re-run ④ itself, exactly
    // as before — a live turn on the live path, else the backend static report (no turn/session).
    if (task.testMode === 'live') {
      const resumeId = task.sessionIds.implement;
      await runPhaseAndGate(task, 'implement', ctx, { resumeId, replyText: text });
      return;
    }
    await runTestAndFinish(task, ctx, false);
    return;
  }
  const resumeId = task.sessionIds[task.phase as 'analyze' | 'spec' | 'implement'];
  await runPhaseAndGate(task, task.phase, ctx, { resumeId, replyText: text });
}

// ───────────────────────────── internal steps ─────────────────────────────

async function runPhaseAndGate(
  task: Task,
  phaseId: 'analyze' | 'spec' | 'implement',
  ctx: OrchestratorCtx,
  opts?: { resumeId?: string; replyText?: string }
): Promise<PhaseVerify | undefined> {
  // 048 D2: returns the verify (additive — most callers ignore it) so confirmAdvance's spec branch
  // can hand ③'s lintCodes to the windowless auto-hop. undefined on the cancel bail.
  const verify = await runPhase(task, phaseId, ctx, opts);
  if (isCancelled(task.taskId)) return undefined;
  await gateAfterPhase(task, verify, ctx);
  return verify;
}

/**
 * gateAfterPhase — set the gate + status from the verify outcome and STOP (do not issue the next
 * turn). Both outcomes END this turn's write-unit: `error` parks at `status:error` (a /reply retry
 * re-acquires the turn lock); success / still_failing park at `awaiting_confirm`. The turn lock is
 * freed by the dispatch `finally` when this work settles — a gate holds NO lock (turn-level, §I). The
 * caller decides whether to maybeAutoAdvance.
 */
async function gateAfterPhase(task: Task, verify: PhaseVerify, ctx: OrchestratorCtx): Promise<void> {
  // Spec 036 D1/D4: capability-aware Implement gate — the live "Test with workflow" button is offered per
  // reachable Dify target (difyTargets()), NOT by an upfront `deploy=selfhost` declaration. computeGate is
  // PURE, so the env probe happens HERE and the targets are passed in. Only computeGate's `implement`
  // branch reads them, so probing at every phase is harmless (analyze/spec/test ignore `targets`).
  const targets = difyTargets();
  task.gate = computeGate(task.phase, { outcome: verify.outcome }, task.deploy, targets);
  if (verify.outcome === 'error') {
    task.status = 'error';
    task.error = verify.reasons.filter(Boolean).join(' | ') || 'phase failed';
    await emit(task, ctx);
    return;
  }
  task.status = 'awaiting_confirm'; // success or still_failing → park (the turn lock frees on settle)
  task.error = undefined;
  await emit(task, ctx);
}

/** Spec 028 §5: true iff `features` is a NON-EMPTY array whose every entry is 'llm'. Deliberately
 *  FALSE for undefined/[] — ∅ ⊆ {llm} is vacuously true, but the guard must hard-stop on a merged
 *  draft that wrote no features (fail-safe), so we require non-empty. */
function featuresSubsetOfLlm(features: string[] | undefined): boolean {
  return Array.isArray(features) && features.length > 0 && features.every((f) => f === 'llm');
}

/** Decide per Confirm-mode whether THIS boundary auto-advances, then issue the primary confirm.
 *  `internal.reuseLint` (spec 048 D2) carries ③'s just-verified lint codes across the windowless
 *  ③→④ hop — mode-agnostic on purpose: `auto` AND `spec_only` (AND the fast+auto path) all ride
 *  this same seam, and all of them hop inside the one dispatched request that holds the turn lock. */
async function maybeAutoAdvance(
  task: Task,
  ctx: OrchestratorCtx,
  internal?: { reuseLint?: LintCodes }
): Promise<void> {
  if (isCancelled(task.taskId)) return; // a /cancel mutates a separate object — re-check the live flag
  if (task.status !== 'awaiting_confirm') return; // error / done / cancelled never auto-advance
  if (task.gate?.flag === 'still_failing') return; // `auto` HARD-STOPS at still-failing (§D / AC #25)
  if (task.gate?.flag === 'awaiting_import') return; // deploy is ALWAYS an explicit human decision (spec 014 D1)
  if (task.gate?.flag === 'test_result') return; // spec 032 B4: live-test verdict → human decides (auto only parks here on a fail)
  if (task.gate?.flag === 'infra_degraded') return; // spec 032 D1c: degrade-to-static → human decides
  if (!boundaryAutoAdvances(task.confirmMode, task.phase)) return;
  // Spec 028 §5: the auto+fast structural sanity-check — the ONE config with no human gate. Before
  // auto-confirming the MERGED Spec gate, require the draft's analyze.json.features (folded onto
  // task.analysisFeatures by the merged verify) to be a non-empty subset of {llm}. If the merged draft
  // itself found a non-trivial shape — or wrote no features — hard-stop and park at the Spec gate for a
  // human. (each_step/spec_only already paused via boundaryAutoAdvances, so this only fires under `auto`.)
  if (task.fastMode && task.phase === 'spec' && !featuresSubsetOfLlm(task.analysisFeatures)) {
    task.fastReviewNote = 'Fast build found a non-trivial shape — review before continuing';
    await emit(task, ctx);
    return;
  }
  // Spec 036 D5: an autonomous build is ALWAYS static at the implement gate — the primary is `continue`
  // (the first confirm). The 032 `testMode==='live' → primary=test_live` auto-pick is DELETED: `auto`/
  // `spec_only` never live-test (live is a human action from the done state, S5). testMode is never 'live'
  // at an autonomous implement gate anyway (only a human `test_live` click stamps it), so this is both the
  // policy AND already unreachable — even with self-host creds present the implement gate offers the
  // `test_live` button but auto takes `continue`, finishing `done` on the static test (AC #4).
  const primary = task.gate?.actions.find((a) => a.kind === 'confirm');
  if (!primary) return; // terminal (④) — nothing to advance
  await confirmAdvance(task, primary.id, ctx, undefined, internal);
}

/** auto → always; spec_only → pause only after Spec (② pauses, ①/③ auto); else (each_step OR any
 *  corrupt/unrecognized persisted value) → never auto. Fail-SAFE toward pausing, never toward an
 *  autonomous `auto` run (a stale `confirmMode:null` in a reconciled task.json must not silently run). */
export function boundaryAutoAdvances(mode: Task['confirmMode'], phase: Task['phase']): boolean {
  if (mode === 'auto') return true;
  if (mode === 'spec_only') return phase !== 'spec';
  return false; // each_step (and any unknown/corrupt value)
}

/**
 * runPhase — spawn exactly ONE fresh `claude` turn for `phaseId` (model C; `/reply` adds --resume),
 * persist its session id per-phase, then post-turn verify → PhaseVerify. For ③ the verify resolves
 * the clean / still-failing / hard-error variant from the structured post-turn detail; the backend
 * NEVER re-spawns the turn (the cap-5 validate→fix loop runs INSIDE the agent's single turn,
 * implement.md — re-spawning would double-apply edits and break §I idempotency).
 */
async function runPhase(
  task: Task,
  phaseId: 'analyze' | 'spec' | 'implement',
  ctx: OrchestratorCtx,
  opts?: { resumeId?: string; replyText?: string }
): Promise<PhaseVerify> {
  const { projectsDir, settingsPath, log } = ctx;
  const { runTurn } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  const phase = PHASES.find((p) => p.id === phaseId) as PhaseDef;
  const sessKey = phaseId;

  task.phase = phaseId;
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  task.fastReviewNote = undefined; // spec 028: a re-run/reply re-evaluates the §5 guard from scratch
  await emit(task, ctx);

  const body = await readFile(join(projectsDir, phase.promptFile!(task)), 'utf8');
  // Spec 037 S2+S3 (Implement only): harvest the workspace facts (D5 — degrades to nothing without
  // creds/Dify; never blocks), then render them into the {{KNOWLEDGE}} token. The orchestrator owns
  // this — phases.ts stays pure/io-free (r2); the vars() default '' keeps every other phase (and a
  // facts-less Implement) byte-identical.
  let knowledge = '';
  if (phaseId === 'implement') {
    await harvestWorkspaceFacts(projectsDir, task.taskId, log);
    knowledge = knowledgeBlock(await loadWorkspaceFacts(projectsDir, task.taskId));
  }
  const renderedFresh = renderPrompt(body, { ...phase.injectVars(task), KNOWLEDGE: knowledge });
  // Spec 012: the trailing `添付画像:` path block (empty string when no images). Appended ONCE to
  // whichever prompt string is finally sent — this is the single seam BOTH the fresh render and the
  // /reply resume prompt pass through (the resume prompt skips phases.ts injectVars entirely), so it is
  // the only place that covers create→Analyze AND a reply at any phase (AC2/AC3). Every phase benefits,
  // including a fresh Implement turn. (046 D2: Implement now DOES inject {{REQUIREMENT}} — the
  // language banner needs the raw string — this seam still covers what token injection can't: resumes.)
  const block = attachmentBlock(task.attachments);
  // A /reply carries a CHANGE REQUEST under an explicit "revise the artifact" header. The resumed session
  // already has context, but WITHOUT this header a terse request (e.g. "Return the summary in ALL
  // UPPERCASE") reads as conversational and the model may answer instead of EDITING the file — the
  // observed bug where a live-gate "Request changes" re-ran Implement but left main.yml unchanged. Give the
  // resume prompt the SAME header as the fresh path so "revise the artifact" is unambiguous either way.
  const CHANGE_REQUEST = '## Change request (revise the existing artifact; do not restart from scratch)';
  // Layer 1 reply-language guard: a native-language pin prepended at the TOP of every phase prompt (fresh
  // AND /reply) so the model's user-facing prose follows the requirement's language from token one. '' for
  // a Latin-script requirement. The single seam covering both prompts, like the attachment block below.
  const langPin = languagePin(task.requirement);
  const freshPrompt =
    langPin + (opts?.replyText ? `${renderedFresh}\n\n${CHANGE_REQUEST}\n${opts.replyText}` : renderedFresh) + block;
  // Spec 037 D6(b): the RESUME prompt skips phases.ts injectVars entirely, so the facts ride the
  // same fresh+resume seam as the attachment block — appended on the replyText branch only (a fresh
  // turn already carries them via the token; appending here too would double them).
  const knowledgeTail = knowledge && opts?.replyText ? `\n\n${knowledge}` : '';
  const resumePrompt = opts?.replyText ? langPin + `${CHANGE_REQUEST}\n${opts.replyText}${block}${knowledgeTail}` : freshPrompt;

  // Snapshot the pre-edit workflow BEFORE Implement overwrites it, so an edit-existing diff has a
  // real base (idempotent: no-op on a no-seed new build, a Dify-seed, or a /reply re-run, Task 4).
  if (phaseId === 'implement') await snapshotDiffBase(projectsDir, task);

  // Confinement baseline for THIS turn (captured just before spawn — after any scaffold).
  const baseline = await gitDirtyPaths(projectsDir);

  const spawnOnce = async (resumeSessionId: string | undefined, prompt: string): Promise<TurnResult> => {
    const session = new ClaudeSession(`${task.taskId}:${phaseId}${resumeSessionId ? ':resume' : ''}`, {
      taskId: task.taskId,
      workingDir: projectsDir,
      settingsPath,
      log,
      resumeSessionId,
    });
    setSession(task.taskId, session); // hand the child to /cancel
    const turn = await runTurn(
      session,
      prompt,
      (sid) => {
        // Persist session_id the MOMENT init yields it (a /reply, a separate request, reads it back).
        task.sessionIds[sessKey] = sid;
        void saveTask(projectsDir, task);
      },
      {
        timeoutMs: TURN_TIMEOUT_MS,
        // Relay each assistant fragment to the SSE clients live (Lát 4) — high-volume, not buffered.
        onText: (text) => ctx.broadcast?.(task.taskId, 'phase:output', { phase: phaseId, text }),
      }
    );
    clearSession(task.taskId);
    // Don't write a `running`-bearing task AFTER a /cancel flipped it (would clobber `cancelled`).
    if (turn.sessionId && !isCancelled(task.taskId)) {
      task.sessionIds[sessKey] = turn.sessionId;
      await saveTask(projectsDir, task);
    }
    return turn;
  };

  // NEVER spawn a turn for a build that no longer owns the TURN lock. The primary guard is the live
  // `isCancelled` flag: a /cancel during the awaits above (emit/readFile/gitDirtyPaths) force-kills any
  // child + marks cancelled on a SEPARATELY-loaded object, and the auto-advance path gates only on the
  // stale in-memory status. `turnHolderId() !== task.taskId` is a defensive backstop (the turn lock is
  // held for THIS build across its whole dispatched work, so it should always match) — if it somehow
  // doesn't, the spawn's setSession() would no-op → an untracked, unkillable turn. Bail in either case.
  if (isCancelled(task.taskId) || turnHolderId() !== task.taskId) {
    task.status = 'cancelled';
    task.gate = undefined;
    await saveTask(projectsDir, task);
    return { outcome: 'error', reasons: ['cancelled before spawn'] };
  }

  log.info({ taskId: task.taskId, phase: phaseId, resume: !!opts?.resumeId }, 'spawning turn');
  let turn = await spawnOnce(opts?.resumeId, opts?.resumeId ? resumePrompt : freshPrompt);

  // Resume-failure fallback (spec §A persistence caveat / Q3): a bad/expired session id makes the
  // child exit before any result event — re-run as a FRESH turn seeded with the artifact PATH.
  // A wall-clock TIMEOUT (or a spawn failure) sets turn.note — that is NOT a resume failure, and
  // re-running would silently spend a SECOND full TURN_TIMEOUT_MS. Exclude it so a /reply timeout
  // parks at error like a fresh-turn timeout instead of doubling the budget (spec 014 D4 / C4).
  if (opts?.resumeId && turn.isError && !turn.result && !turn.note) {
    log.warn({ taskId: task.taskId, phase: phaseId }, 'resume failed → fresh turn seeded with artifact');
    turn = await spawnOnce(undefined, freshPrompt);
  }

  // A /cancel may have killed the child mid-turn. Converge the build's own state to `cancelled`
  // (idempotent with the cancel handler's write) and bail — do NOT verify/gate/advance. The lock is
  // owned/released by the cancel handler.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }

  const verify = await verifyPhase(phase, task, ctx, baseline, turn.note);
  // verifyPhase awaits python/git subprocesses — a /cancel can land in that window. Re-check (mirrors
  // the guard at the spawn boundary above) so the success save below can't clobber `cancelled`→`running`.
  if (isCancelled(task.taskId)) {
    task.status = 'cancelled';
    task.gate = undefined;
    await emit(task, ctx);
    return { outcome: 'error', reasons: ['cancelled by user'] };
  }
  if (verify.outcome !== 'error') {
    task.artifacts[sessKey] = phase.artifactRel(task);
    // Implement produced a (parseable) main.yml → compute + persist the {path,diff} payload now so
    // GET /api/tasks renders the split diff (base per kind: seed / pre-edit snapshot / empty, Task 4).
    if (phaseId === 'implement') {
      try {
        task.artifacts.diff = await writeDiffArtifact(projectsDir, task);
      } catch (e) {
        log.warn({ taskId: task.taskId, err: errMsg(e) }, 'diff producer failed (non-fatal)');
      }
    }
    await saveTask(projectsDir, task);
  }
  return verify;
}

/**
 * Spec 039 D5 — the ③ variant fold, extracted PURE so the hard/success/still_failing split is
 * directly unit-testable (post-turn-multi-lint.test.ts; `PostTurnResult.status` cannot express it).
 *
 * HARD error (→ status:error, Retry): a crash/timeout, no artifact, unparseable YAML (truncation),
 * a confinement breach (security — always reverted + error, AC #23), an unparseable/missing EXTRA
 * workflow file, or an extension TWIN of the declared file (039 D4 — two canonical-looking
 * artifacts is a correctness ambiguity even lint-clean). These are NOT the still-failing gate
 * (which assumes present, parseable, in-confinement files).
 *
 * Success consumes the SHARED lintClean (013 D1) — the identical clean-test the ④ report's Import
 * precondition uses — for the declared artifact AND every extra (039 D5); anything else parks at
 * still_failing (cap-5 reached; the agent self-corrected as far as it could — §D / AC #20).
 */
export function resolveImplementOutcome(
  d: PostTurnDetail,
  turnNote: string | undefined
): 'error' | 'success' | 'still_failing' {
  const hardError =
    !!turnNote || !d.artifactOk || !d.yamlOk || d.confinementBreaches.length > 0 ||
    d.extraFiles.some((f) => !f.yamlOk || f.twin);
  if (hardError) return 'error';
  if (lintClean(d.lintCodes) && d.idsOk && d.extraFiles.every((f) => lintClean(f.lintCodes) && f.idsOk)) {
    return 'success';
  }
  return 'still_failing';
}

/** Post-turn verify → outcome. ③ resolves clean/still-failing/hard-error from the post-turn detail. */
async function verifyPhase(
  phase: PhaseDef,
  task: Task,
  ctx: OrchestratorCtx,
  baseline: Set<string>,
  turnNote: string | undefined
): Promise<PhaseVerify> {
  const { projectsDir, log } = ctx;
  const { postTurnCheck } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake

  // The skill bodies write task artifacts to the shorthand `.runs/<taskId>/` (cwd = repo root).
  // Relocate them into the canonical `apps/builder/.runs/<taskId>/` (spec §A :517) BEFORE verifying.
  await relocateRunArtifacts(projectsDir, task.taskId, log);

  if (phase.id === 'implement') {
    const check = await postTurnCheck({
      projectsDir,
      project: task.project!,
      workflowSlug: task.workflowSlug!,
      workflowFile: task.workflowFile,
      taskId: task.taskId,
      baseline,
      log,
    });
    const reasons = [...check.reasons];
    if (turnNote) reasons.unshift(turnNote);

    // Spec 037 S1 — the runnability preflight (D3/D4): recomputed on EVERY implement verify (fresh,
    // /reply revise) so a fix clears the note and a regression re-raises it; persisted to
    // .runs/<id>/preflight.json (the criteria.json convention) for the report/tests; NON-FATAL —
    // a detector throw (unparseable artifact etc.) logs and never fails the phase. Deliberately
    // NOT in gateAfterPhase (036's seam) — the two specs edit disjoint code (D4/D8).
    try {
      const pf = await checkRunnability(projectsDir, phase.artifactRel(task), resolveRunners(ctx).runPython);
      await writeFile(
        join(projectsDir, `apps/builder/.runs/${task.taskId}/preflight.json`),
        JSON.stringify(pf, null, 2)
      );
      task.preflightNote = preflightNote(pf) ?? undefined;
    } catch (e) {
      log.warn({ taskId: task.taskId, err: errMsg(e) }, 'runnability preflight failed (advisory, non-fatal)');
    }

    const outcome = resolveImplementOutcome(check.detail, turnNote);
    // 048 D2: expose ③'s lint codes for the windowless hop. `?? undefined` — detail.lintCodes is
    // null when the artifact was missing/empty, but that maps to 'error' (never hops) anyway.
    return {
      outcome,
      reasons: outcome === 'success' ? [] : reasons,
      lintCodes: check.detail.lintCodes ?? undefined,
    };
  }

  // ①/②: artifact exists + non-empty (+ analyze.json valid JSON) + confinement+revert.
  const reasons: string[] = [];
  if (turnNote) reasons.push(turnNote);
  const rel = phase.artifactRel(task);
  const abs = join(projectsDir, rel);
  let size = -1;
  try {
    size = (await stat(abs)).size;
  } catch {
    reasons.push(`artifact missing: ${rel}`);
  }
  if (size === 0) reasons.push(`artifact empty: ${rel}`);
  if (phase.id === 'analyze' && size > 0) {
    try {
      // O2 (spec 019): also fold the chosen pattern + needed feature-set from analyze.json onto the
      // task and compute the pattern-coverage advisory (never a hard-fail). Throws on invalid JSON →
      // the same error path as before.
      applyAnalysisToTask(task, await readFile(abs, 'utf8'), projectsDir);
    } catch (e) {
      reasons.push(`analyze.json invalid JSON: ${errMsg(e)}`);
    }
  }
  // Spec 028 §3: the MERGED draft turn (fast `spec`) also wrote analyze.json — fold it too. Its path is
  // NOT `phase.artifactRel` (that is SPEC.md); it is the analyze slot's canonical path (post-relocate).
  // Folding sets task.analysisFeatures, which the §5 auto+fast guard reads. Set artifacts.analyze here
  // (runPhase sets artifacts.spec via `artifacts[sessKey]`). Throws on invalid/missing JSON → error.
  if (phase.id === 'spec' && task.fastMode) {
    const analyzeRel = PHASES.find((p) => p.id === 'analyze')!.artifactRel(task);
    try {
      applyAnalysisToTask(task, await readFile(join(projectsDir, analyzeRel), 'utf8'), projectsDir);
      task.artifacts.analyze = analyzeRel;
    } catch (e) {
      reasons.push(`analyze.json invalid/missing (merged draft): ${errMsg(e)}`);
    }
  }
  // Spec 032 A3: persist the Acceptance-Criteria rubric from SPEC.md → criteria.json. NON-FATAL — a
  // parse/write failure never fails Spec; the live-test judge (T3) just degrades to a smoke-test. Runs
  // for every spec verify (standard + fast + /reply) so a human's gate edit to the criteria is captured.
  if (phase.id === 'spec' && size > 0) {
    try {
      await persistCriteria(projectsDir, task, abs);
    } catch (e) {
      log.warn({ taskId: task.taskId, err: errMsg(e) }, 'criteria persist failed (non-fatal)');
    }
  }
  // Confinement runs unconditionally — a breach must be reverted even if the artifact failed.
  reasons.push(
    ...(await confinementCheck({ projectsDir, project: task.project, workflowSlug: task.workflowSlug, taskId: task.taskId, baseline, log })).breaches
  );
  return { outcome: reasons.length ? 'error' : 'success', reasons };
}

/**
 * ④ Test&Report — BACKEND write-unit (no turn): re-run the 3 linters, write report.json. For
 * `none`/`cloud` (and a selfhost build whose lint failed via "Accept anyway"), this is terminal →
 * `done`. For a CLEAN `selfhost` build it PARKS at the Import gate (`awaiting_confirm`) so the import
 * runs only on the explicit Import button (AC #16) — never auto-imports lint≠0 (AC #25). `cloud` skips
 * the import entirely; its report carries the copyable-YAML + Studio steps (AC #9). The turn lock is
 * freed by the dispatch `finally` when this work settles (done or parked) — it is never held at a gate.
 */
/**
 * Spec 049 D2 — the ④ import-probe: push the produced YAML to the user's REAL Dify, capture the
 * verdict, delete the probe app immediately. The one oracle that catches import blockers our
 * linters have not met yet (the mimic-drift problem). ADVISORY ONLY in v1 (020: warn → measure →
 * promote): the returned note NEVER feeds lintClean or a gate. Returns undefined (no note) when
 * there is nothing to probe against: no selfhost creds, or the live path (whose real import IS the
 * oracle — defensive: runTestAndFinish is not reachable with testMode==='live' today).
 * Exported for direct unit tests (the resolveImplementOutcome precedent).
 */
export async function runImportProbe(task: Task, ctx: OrchestratorCtx): Promise<string | undefined> {
  if (task.testMode === 'live') return undefined;
  if (!difyTargets().selfhost) return undefined;
  if (!task.project || !task.workflowSlug) return undefined; // nothing produced yet — defensive
  const ops = resolveLiveOps(ctx);
  const wfRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
  try {
    const res = await ops.importForTest(
      ctx.projectsDir, task.project, task.workflowSlug, wfRel, `[probe] ${task.workflowSlug}`
    );
    if (res.ok && res.appId) {
      // Best-effort cleanup — a failed delete leaves one stray probe app, never fails the build.
      const deleted = await ops.deleteApp(ctx.projectsDir, res.appId).catch(() => false);
      return `import-probe: OK — Dify accepted this DSL${deleted ? ' (probe app deleted)' : ' (probe app cleanup failed — delete it in Dify)'}`;
    }
    // The VERBATIM (redacted) Dify error is deliberate: it is exactly what a ④ "Request changes"
    // fix-turn needs (D3) — e.g. HTTP 400 "missing name" named the 2026-07-08 incident precisely.
    const detail = redactSecrets(res.stderr ?? '').trim().split('\n').slice(-3).join(' ⏎ ');
    return `import-probe FAILED: ${detail || 'import rejected (no detail captured)'}`;
  } catch (e) {
    return `import-probe: skipped (${redactSecrets(errMsg(e))})`;
  }
}

async function runTestAndFinish(
  task: Task,
  ctx: OrchestratorCtx,
  acceptedLintFailure: boolean,
  // 048 D2: ③'s codes from the SAME request's verify (windowless hop only) — see ReportOpts.reuseLint.
  reuseLint?: LintCodes
): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  // Spec 049 D2: probe BEFORE the report so the verdict lands in report.json. Set-or-cleared each
  // static ④ run (a /reply retry re-probes the changed file); persisted on the Task so the
  // Import/Skip re-report carries it too (the preflightNote precedent).
  task.probeNote = await runImportProbe(task, ctx);

  const res = await runReport(projectsDir, task, log, { acceptedLintFailure, reuseLint });
  if (isCancelled(task.taskId)) return; // a /cancel raced the (childless) ④ step

  if (!res.ok) {
    task.status = 'error';
    task.error = res.reasons.join(' | ');
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    return; // the dispatch `finally` frees the turn lock (§I)
  }

  // Spec 036 D4 (Option A): a CLEAN static test parks at the Import gate only for a HUMAN — `each_step`
  // or a null/corrupt confirmMode (fail-safe to human). The autonomous set `{auto, spec_only}` does NOT
  // park: it falls through to `done` static and reaches Dify only via the D5 done-state live action
  // (keeps `auto` hands-free with creds present, AC #4). The trigger is now CAPABILITY (`targets.selfhost`,
  // difyTargets()), not the removed upfront `deploy` declaration.
  const targets = difyTargets();
  const isAutonomous = task.confirmMode === 'auto' || task.confirmMode === 'spec_only';
  if (targets.selfhost && res.lintClean && !isAutonomous) {
    // Deploy-stamp fix (D4 Rev-A / AC #9): a static "Continue to Test" leaves `task.deploy='none'`, but if
    // the human then clicks Import the push succeeds (import.ts reads creds, not task.deploy) while
    // report.ts — which branches entirely on task.deploy — would mislabel it `deploy=none` / `DEPLOYED ·
    // none`. Stamp `selfhost` HERE, before the Import/Skip re-report, so the real import labels selfhost.
    // `testMode` stays 'static' — it WAS a static test; only the deploy target moves.
    task.deploy = 'selfhost';
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'awaiting_import' }, task.deploy);
    await emit(task, ctx);
    return;
  }

  // lint≠0 and NOT a human-accepted ③ override → never silently `done` (spec 014 D2 / C2). Park at a
  // still-failing ④ gate for an explicit Accept (finish, tagged) or Discard; `auto` HARD-STOPS (flag).
  if (!res.lintClean && !acceptedLintFailure) {
    task.status = 'awaiting_confirm';
    task.gate = computeGate('test', { outcome: 'still_failing' }, task.deploy);
    await emit(task, ctx);
    return;
  }

  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy); // terminal: no actions
  await emit(task, ctx);
}




/**
 * import.ts — the ④-deploy IO extracted out of orchestrator.ts (spec 019 L2 3.4).
 *
 * The selfhost push-to-Dify (+ its idempotency/reconcile dance) and the skip-import finish are backend
 * write-units the gate FSM DISPATCHES; they are not the FSM itself. Moved VERBATIM: bodies unchanged.
 * They reach `emit` / `resolveRunners` from the leaf shared module (no orchestrator import → no cycle).
 * Called only by `confirmAdvance` (orchestrator), so nothing is re-exported.
 */
import { computeGate } from './gate.js';
import { appUrlFrom, difyCreds, pushApp, reconcileAppIdByName, resolveLlmModels, deployWithModel } from './dify-io.js';
import { clearPushIntent, readPushIntent, writePushIntent } from './recovery.js';
import { emit, resolveRunners, type OrchestratorCtx } from './orchestrator-shared.js';
import type { Task } from '../state/task.js';

/** Spec 087 S4 — deps seam for {@link resolveImportSource}: unit tests inject fakes; prod uses the
 *  real dify-io fns (the live-test `ops` precedent, scoped to just these two). */
export interface ImportInjectDeps {
  resolveLlmModels: typeof resolveLlmModels;
  deployWithModel: typeof deployWithModel;
}

/**
 * Spec 087 S4 — best-effort model inject for the STATIC selfhost import ('Import to Dify' at the
 * `awaiting_import` gate). The live-test path injects the workspace model into a temp copy (043);
 * this path used to push main.yml as-is, so any model-carrying node reached the user's Dify with
 * `provider: ''` and died "Model not exist" on the first Studio run. Mirror the inject: a successful
 * patch → push the temp copy (pushApp `srcFileRel` → sync.py `--src-file`); ANY failure, 0-model, or
 * nothing-to-patch → push the source unchanged (pre-087 behavior — the S3 advisory already tells the
 * user what to check). Never throws; never touches main.yml (B5). The temp copy gets its OWN name
 * (`import-deploy.yml`) so it can't be confused with the live-test's `deploy.yml` in the run dir.
 */
export async function resolveImportSource(
  projectsDir: string,
  task: Pick<Task, 'taskId' | 'project' | 'workflowSlug' | 'workflowFile'>,
  deps: ImportInjectDeps = { resolveLlmModels, deployWithModel }
): Promise<{ srcFileRel?: string; injectedModel?: string }> {
  try {
    const { enabled, pick } = await deps.resolveLlmModels(projectsDir);
    if (!pick) return {}; // 0-model / models arm failed → source as-is
    const srcRel = `projects/${task.project}/${task.workflowSlug}/workflows/${task.workflowFile}`;
    const outRel = `apps/builder/.runs/${task.taskId}/import-deploy.yml`;
    const dep = await deps.deployWithModel(projectsDir, srcRel, outRel, pick, enabled.map((m) => m.name));
    // Prefer the copy only when a node was actually patched — an ok-but-0-patch copy adds nothing.
    if (dep.ok && dep.outFile && dep.nodeCount > 0) return { srcFileRel: dep.outFile, injectedModel: pick.name };
    return {};
  } catch {
    return {}; // best-effort: an inject hiccup must never block the import
  }
}

/**
 * ④-import (selfhost, Task 6) — BACKEND: push the produced workflow to Dify as a NEW app, capture the
 * `app_id`, build the clickable `app_url`, re-write report.json, then `done` (the dispatch `finally`
 * frees the turn lock on settle). Idempotency
 * (§I / AC #25): a `push_intent` marker WITHOUT a confirmed `appId` means a prior push may have
 * created the app (crash mid-push) → reconcile via `list`, NEVER re-push (a re-push would duplicate).
 */
export async function runImportAndFinish(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.phase = 'test';
  task.status = 'running';
  task.gate = undefined;
  task.error = undefined;
  await emit(task, ctx);

  const project = task.project!;
  const workflowSlug = task.workflowSlug!;
  const appName = task.name ?? workflowSlug;

  const creds = difyCreds();
  if (!creds.url || !creds.token) {
    task.status = 'error';
    task.error = 'selfhost import needs DIFY_CONSOLE_URL + DIFY_CONSOLE_TOKEN in the backend env';
    task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
    await emit(task, ctx);
    return; // the dispatch `finally` frees the turn lock
  }

  let appId: string | null = null;
  let reconcileAmbiguous = false; // ≥2 same-named apps matched — never silently attach the wrong one (D6)
  const existing = await readPushIntent(projectsDir, task.taskId);
  if (existing) {
    // A marker ALREADY exists → a prior attempt pushed (or may have). NEVER re-push (a re-push would
    // duplicate the app, AC #25) — use the captured id, else reconcile by slugified name. This covers
    // both a crash mid-push (appId null) AND a boot-recovered marker (appId already written back).
    log.warn({ taskId: task.taskId, hadAppId: !!existing.appId }, 'push_intent exists — reconciling, NOT re-pushing');
    if (existing.appId) {
      appId = existing.appId;
    } else {
      const rec = await reconcileAppIdByName(projectsDir, existing.appName);
      appId = rec.appId;
      reconcileAmbiguous = rec.ambiguous;
    }
  } else {
    // Spec 087 S4: local-only, side-effect-free → runs BEFORE the push-intent marker. On the
    // reconcile branch above there is no push, so there is nothing to inject.
    const inject = await resolveImportSource(projectsDir, task);
    if (inject.srcFileRel) {
      log.info({ taskId: task.taskId, model: inject.injectedModel }, 'import: pushing model-injected copy');
    }
    // Fresh import: write the marker BEFORE the push (the guard keys off the PRE-push marker, §I).
    await writePushIntent(projectsDir, task.taskId, { project, workflowSlug, file: task.workflowFile, appName, appId: null });
    const push = await pushApp(projectsDir, project, workflowSlug, task.workflowFile, appName, inject.srcFileRel);
    // --json-out is PRIMARY; on absence/crash, reconcile by slugified name (D6: exactly-one match, else
    // ambiguous — never a silent newest-pick that could attach the wrong app).
    if (push.appId) {
      appId = push.appId;
    } else {
      const rec = await reconcileAppIdByName(projectsDir, appName);
      appId = rec.appId;
      reconcileAmbiguous = rec.ambiguous;
    }
    if (!push.ok && !appId) {
      // push failed AND nothing to reconcile → error. The marker (no appId) PERSISTS so a /reply
      // re-run reconciles instead of re-pushing (never a duplicate).
      const tail = push.stderr.trim().split('\n').slice(-2).join(' ⏎ ') || 'sync.py push exited non-zero';
      task.status = 'error';
      task.error = `import failed: ${tail}`;
      task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the dispatch `finally` frees the turn lock
    }
  }

  const appUrl = appId ? appUrlFrom(creds.url, appId) : null;
  task.appId = appId;
  task.appUrl = appUrl;
  await writePushIntent(projectsDir, task.taskId, { project, workflowSlug, file: task.workflowFile, appName, appId });

  // Push ALWAYS makes a NEW app → editing an existing workflow silently DUPLICATES (spec footgun).
  const duplicateWarning = task.workflow
    ? `created a NEW Dify app (a DUPLICATE): Dify import always creates a new app, so "${task.workflow}" was NOT updated in place — delete the old app or reconcile in Dify.`
    : null;
  // D6 (C6): when ≥2 same-named apps matched we attached NONE (can't tell which is this build's), so say
  // so explicitly rather than letting a generic "check Dify" imply a single new app exists.
  const importNote = appId
    ? null
    : reconcileAmbiguous
      ? `ambiguous import — multiple Dify apps are named like "${appName}"; none was attached. Verify in Dify which one is this build.`
      : 'app id not captured — push may have completed; check Dify for the new app';

  await runReport(projectsDir, task, log, { appUrl, duplicateWarning, importNote });
  if (appId) await clearPushIntent(projectsDir, task.taskId); // resolved → drop the marker

  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy);
  await emit(task, ctx);
}

/** skip_import at the selfhost Import gate → finish `done` WITHOUT pushing (built + linted locally). */
export async function finishWithoutImport(task: Task, ctx: OrchestratorCtx): Promise<void> {
  const { projectsDir, log } = ctx;
  const { runReport } = resolveRunners(ctx); // 013 D2: real impl unless a test injects a fake
  task.status = 'running';
  task.gate = undefined;
  await emit(task, ctx);
  await runReport(projectsDir, task, log, {
    importNote: 'import skipped by user (built + linted locally; not pushed to Dify).',
  });
  task.status = 'done';
  task.gate = computeGate('test', { outcome: 'success' }, task.deploy);
  await emit(task, ctx);
}

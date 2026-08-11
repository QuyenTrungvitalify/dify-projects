/**
 * import.ts — the ④-deploy IO extracted out of orchestrator.ts (spec 019 L2 3.4).
 *
 * The selfhost push-to-Dify (+ its idempotency/reconcile dance) and the skip-import finish are backend
 * write-units the gate FSM DISPATCHES; they are not the FSM itself. Moved VERBATIM: bodies unchanged.
 * They reach `emit` / `resolveRunners` from the leaf shared module (no orchestrator import → no cycle).
 * Called only by `confirmAdvance` (orchestrator), so nothing is re-exported.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { computeGate } from './gate.js';
import { appUrlFrom, difyCreds, isAppGoneFailure, pushApp, reconcileAppIdByName, resolveLlmModels, deployWithModel } from './dify-io.js';
import { clearPushIntent, readPushIntent, writePushIntent } from './recovery.js';
import { artifactHash } from './post-turn.js';
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
 * The `app.mode` declared by a Dify DSL ('workflow' | 'advanced-chat' | 'chat' | …), or null when the
 * file has no readable `app:` block. Deliberately a small scanner rather than a YAML dependency: the
 * server has none, and this reads one scalar from a fixed, linter-enforced position. Scoped to the
 * TOP-LEVEL `app:` block so a `mode:` inside the graph (nodes carry their own) can never be mistaken
 * for it — the block ends at the next column-0 key.
 */
export function readAppMode(yamlText: string): string | null {
  const lines = yamlText.split('\n');
  let inApp = false;
  for (const line of lines) {
    if (/^app:\s*$/.test(line)) {
      inApp = true;
      continue;
    }
    if (!inApp) continue;
    if (/^\S/.test(line)) break; // a new top-level key ⇒ the app block is over
    const m = line.match(/^\s{1,4}mode:\s*['"]?([\w-]+)['"]?\s*$/);
    if (m) return m[1];
  }
  return null;
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
  // The app THIS import owns from a previous round, if any. Passing it to `push` overwrites that app in
  // place (same id, same URL, no second app) — which is what makes the post-import fix loop usable: find
  // a problem in Dify → Request a fix → re-import, and the app you already have open just gets the new
  // workflow. `importAppId` and NOT `appId`, so an Import never lands on top of a live-test's throwaway
  // app (which the next re-test deletes — it would take the imported workflow with it).
  // Reading the CURRENT DSL's mode is what lets a mode change disqualify the overwrite (Dify's
  // update-existing path installs the graph but never reassigns `app.mode`, and the draft workflow is
  // typed from the APP's mode — so an advanced-chat DSL pushed over a workflow app produces a
  // structurally mismatched app, not an error). Unknown on either side ⇒ we cannot prove the mode is
  // unchanged ⇒ create. A duplicate app is a nuisance; a broken one costs the user their afternoon.
  const currentMode = readAppMode(
    await readFile(join(projectsDir, 'projects', project, workflowSlug, 'workflows', task.workflowFile), 'utf-8').catch(() => '')
  );
  const modeUnchanged = !!currentMode && !!task.importAppMode && currentMode === task.importAppMode;
  const overwriteTarget = task.importAppId && modeUnchanged ? task.importAppId : null;
  const modeChanged = !!task.importAppId && !modeUnchanged; // the app exists but is no longer the right kind
  let overwrote = false; // drives the human note: updated the existing app vs created a new one
  let staleTarget = false; // the remembered app was deleted in Dify → we fell back to creating
  // An id the PUSH ITSELF returned. `appId` below may also come from the name-reconcile fallback, which
  // is a "exactly one app is called this" GUESS — fine for building a link, never for something we later
  // overwrite destructively (this build's live-test apps carry the same name, and the live-test cleanup
  // deletes them on the next re-test, which would take the imported workflow with it).
  let confirmedAppId: string | null = null;
  const existing = await readPushIntent(projectsDir, task.taskId);
  if (existing?.targetAppId) {
    // A crashed OVERWRITE. Unlike a create, redoing it cannot duplicate — same id in, same app out — so
    // the never-re-push rule does not apply here: re-push, which is the only way to know the new DSL
    // actually landed (the name-reconcile below can only prove an app EXISTS, not that it was updated).
    log.warn({ taskId: task.taskId, targetAppId: existing.targetAppId }, 'push_intent exists for an OVERWRITE — re-pushing (idempotent)');
    const inject = await resolveImportSource(projectsDir, task);
    const redo = await pushApp(projectsDir, project, workflowSlug, task.workflowFile, appName, inject.srcFileRel, existing.targetAppId);
    if (redo.appId) {
      appId = redo.appId;
      confirmedAppId = redo.appId;
      overwrote = true;
    } else if (isAppGoneFailure(`${redo.stdout}\n${redo.stderr}`)) {
      // The target was deleted in Dify while we were down — fall through to a normal create below.
      staleTarget = true;
    }
    if (!appId && !staleTarget) {
      const tail = (redo.stderr.trim() || redo.stdout.trim()).split('\n').slice(-2).join(' ⏎ ') || 'push produced no output';
      task.status = 'error';
      task.error = `import failed: ${tail}`;
      task.gate = computeGate('test', { outcome: 'error' }, task.deploy);
      await emit(task, ctx);
      return; // the marker PERSISTS — the next /reply re-runs this same idempotent overwrite
    }
  } else if (existing) {
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
  }
  if (!appId && (!existing || staleTarget)) {
    // Spec 087 S4: local-only, side-effect-free → runs BEFORE the push-intent marker. On the
    // reconcile branch above there is no push, so there is nothing to inject.
    const inject = await resolveImportSource(projectsDir, task);
    if (inject.srcFileRel) {
      log.info({ taskId: task.taskId, model: inject.injectedModel }, 'import: pushing model-injected copy');
    }
    // Null when this build has never imported, or when a remembered app already turned out to be gone.
    const target = staleTarget ? null : overwriteTarget;
    // Write the marker BEFORE the push (the guard keys off the PRE-push marker, §I). `targetAppId`
    // records the overwrite INTENT — never as `appId`, which means "confirmed result": a crash before
    // the push would otherwise read as a completed import over the app's old, unchanged content.
    await writePushIntent(projectsDir, task.taskId, { project, workflowSlug, file: task.workflowFile, appName, appId: null, targetAppId: target });
    let push = await pushApp(projectsDir, project, workflowSlug, task.workflowFile, appName, inject.srcFileRel, target);
    if (target && !push.appId && isAppGoneFailure(`${push.stdout}\n${push.stderr}`)) {
      // The user deleted the app in Dify between rounds. Dify does NOT fall back to creating on a stale
      // id (HTTP 400 "App not found", probed) — so do it here, rather than dead-ending the import on a
      // cleanup the user was entitled to do. The note says a new app was made.
      log.warn({ taskId: task.taskId, target }, 'overwrite target is gone in Dify — creating a new app instead');
      staleTarget = true;
      await writePushIntent(projectsDir, task.taskId, { project, workflowSlug, file: task.workflowFile, appName, appId: null, targetAppId: null });
      push = await pushApp(projectsDir, project, workflowSlug, task.workflowFile, appName, inject.srcFileRel);
    }
    confirmedAppId = push.appId ?? null; // whatever the branches below decide, THIS is what Dify confirmed
    if (target && !staleTarget) {
      // An overwrite has nothing to reconcile — the id was known going in. Either the push confirmed it,
      // or we cannot claim the new DSL landed; the marker keeps `targetAppId` so the next attempt just
      // redoes the (idempotent) overwrite. Reconciling by name here would "find" the app and report
      // success while the workflow inside it was still the old one.
      if (push.appId) {
        appId = push.appId;
        overwrote = true;
      }
    } else if (push.appId) {
      // --json-out is PRIMARY; on absence/crash, reconcile by slugified name (D6: exactly-one match, else
      // ambiguous — never a silent newest-pick that could attach the wrong app).
      appId = push.appId;
    } else {
      const rec = await reconcileAppIdByName(projectsDir, appName);
      appId = rec.appId;
      reconcileAmbiguous = rec.ambiguous;
    }
    // Create path (target null): unchanged — error only when the push failed AND nothing reconciled, so
    // the marker persists and a /reply re-run reconciles instead of re-pushing (never a duplicate).
    // Overwrite path: no id means the import did not complete, whatever the exit code said (a DSL
    // version mismatch answers HTTP 200 with `status:"pending"`), so never finish `done` on it.
    if (!appId && (!push.ok || (target && !staleTarget))) {
            // stdout, not just stderr: the dangerous failure (a DSL version mismatch) answers HTTP 200 with
      // `status:"pending"` on STDOUT and exit 0 — the old literal then told the user the push "exited
      // non-zero", sending them to look for a crash that never happened.
      const tail = (push.stderr.trim() || push.stdout.trim()).split('\n').slice(-2).join(' ⏎ ') || 'push produced no output';
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
  // Remember what THIS import owns, so the next round overwrites it instead of adding another app —
  // strictly from an id the push RETURNED, never a reconcile guess (see `confirmedAppId`). The mode
  // rides along so a later round can tell whether the app is still the right kind to overwrite.
  if (confirmedAppId) {
    task.importAppId = confirmedAppId;
    task.importAppMode = currentMode;
  }
  // Spec 094 S1 — stamp WHAT was imported and WHEN, so a later gate can say "this is byte-for-byte the
  // file you already imported at HH:MM" instead of offering an identical Import that reads like a new
  // one. Hashes the SOURCE artifact, not the injected `import-deploy.yml` copy: the copy only exists
  // when the model-inject patched a node, and the ③ verify hashes the source too — comparing the same
  // thing on both sides is the whole point. Gated on `appId` (the same "resolved" test that clears the
  // push-intent marker below): an unconfirmed push must not be recorded as a known-imported state.
  if (appId) {
    task.importedHash = await artifactHash(
      projectsDir,
      `projects/${project}/${workflowSlug}/workflows/${task.workflowFile}`
    );
    task.importedAt = Date.now();
  }
  await writePushIntent(projectsDir, task.taskId, { project, workflowSlug, file: task.workflowFile, appName, appId });

  // The duplicate footgun applies ONLY to a create. An overwrite updated the very app the user already
  // has open, so warning about a duplicate there would be plain wrong. `staleTarget` is the honest
  // middle case: we meant to update, the app was gone, so a new one exists after all.
  const duplicateWarning = overwrote
    ? null
    : staleTarget
      ? `the Dify app this build previously imported no longer exists, so a NEW app was created instead of updating it.`
      : modeChanged
        ? `this workflow changed type (${task.importAppMode ?? 'unknown'} → ${currentMode ?? 'unknown'}), which Dify cannot apply to an existing app — a NEW app was created; the previous one is now out of date.`
        : task.workflow
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

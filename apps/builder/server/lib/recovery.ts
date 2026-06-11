/**
 * recovery.ts — push idempotency + restart recovery for spec 009 Lát 5 (§I, AC #25).
 *
 * Dify import (`sync.py push`) ALWAYS creates a NEW app, so a crash mid-push must never cause a
 * re-push (it would silently duplicate the app). The guard keys off a `push_intent.json` marker the
 * backend writes to `.runs/<taskId>/` BEFORE calling push:
 *   - marker WITHOUT a confirmed `appId` = "a push may be in flight / may have completed" → do NOT
 *     re-push; reconcile the id via `sync.py list` (slugified-name match) instead;
 *   - the `appId` is written back into the marker once captured.
 *
 * {@link reconcilePushIntents} runs at boot (after lock.ts flips `running`→`error`): for any task
 * whose marker lacks an `appId`, it recovers the id (so the user sees the app) or annotates the task
 * "push may have completed — check Dify".
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, unlink, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { reconcileAppIdByName, appUrlFrom, difyCreds } from './dify-io.js';
import { runsRoot, saveTask, type Task } from '../state/task.js';
import type { SessionLogger } from './claude-session.js';

/** The pre-push marker (§I). `appId: null` until the import is confirmed → the idempotency key. */
export interface PushIntent {
  slug: string;
  /** the workflow file pushed (relative to projects/<slug>/workflows/). */
  file: string;
  /** the app name used for the `list`-reconcile slug match. */
  appName: string;
  /** the captured new app id, or null while the push is unconfirmed (the idempotency guard). */
  appId: string | null;
}

const markerPath = (projectsDir: string, taskId: string): string =>
  join(runsRoot(projectsDir), taskId, 'push_intent.json');

/** Write/overwrite the push_intent marker (atomic-ish: the dir already exists for a live task). */
export async function writePushIntent(
  projectsDir: string,
  taskId: string,
  intent: PushIntent
): Promise<void> {
  await mkdir(join(runsRoot(projectsDir), taskId), { recursive: true });
  await writeFile(markerPath(projectsDir, taskId), JSON.stringify(intent, null, 2));
}

/** Read the push_intent marker, or null if none exists / it is unreadable. */
export async function readPushIntent(
  projectsDir: string,
  taskId: string
): Promise<PushIntent | null> {
  const p = markerPath(projectsDir, taskId);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(await readFile(p, 'utf8')) as PushIntent;
  } catch {
    return null;
  }
}

/** Remove the marker once the import is fully resolved (best-effort). */
export async function clearPushIntent(projectsDir: string, taskId: string): Promise<void> {
  try {
    await unlink(markerPath(projectsDir, taskId));
  } catch {
    // already gone
  }
}

/**
 * Boot recovery (runs from index.ts AFTER lock.ts's reconcileOnBoot): for every task dir whose
 * push_intent marker lacks an `appId`, the backend crashed around a push. Reconcile the id by
 * slugified name; if found, write it back into the marker + the task (so the app is visible), else
 * annotate the task "push may have completed — check Dify". Never re-pushes.
 */
export async function reconcilePushIntents(projectsDir: string, log: SessionLogger): Promise<void> {
  const root = runsRoot(projectsDir);
  if (!existsSync(root)) return;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const taskId of entries) {
    const intent = await readPushIntent(projectsDir, taskId);
    if (!intent || intent.appId) continue; // no marker, or already resolved → nothing to do

    const taskFile = join(root, taskId, 'task.json');
    if (!existsSync(taskFile)) continue;
    let task: Task;
    try {
      task = JSON.parse(await readFile(taskFile, 'utf8')) as Task;
    } catch {
      continue;
    }

    const recovered = await reconcileAppIdByName(projectsDir, intent.appName);
    const { url } = difyCreds();
    if (recovered) {
      intent.appId = recovered;
      await writePushIntent(projectsDir, taskId, intent);
      task.appId = recovered;
      task.appUrl = url ? appUrlFrom(url, recovered) : null;
      task.error = `recovered after a mid-import restart: app was imported (id ${recovered}). ${task.error ?? ''}`.trim();
      log.warn({ taskId, appId: recovered }, 'boot: recovered push_intent app id');
    } else {
      task.error = `push may have completed — check Dify (interrupted mid-import). ${task.error ?? ''}`.trim();
      log.warn({ taskId }, 'boot: push_intent unresolved — surfaced "check Dify"');
    }
    await saveTask(projectsDir, task);
  }
}

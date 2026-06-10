/**
 * lock.ts — the build-level run-lock for spec 009 Lát 3 (§I "Run-lock granularity").
 *
 * v1 is **single-build-at-a-time**: a task in `running` OR `awaiting_confirm` (a build paused at a
 * human gate, possibly for minutes) HOLDS the lock; only `done | error | cancelled` RELEASE it. A
 * second `POST /api/tasks` while the lock is held → 409 (AC #21).
 *
 * Two sources of truth, deliberately:
 *   - the in-memory `holder` is the LIVE process (carries the child handle for `/cancel` + a
 *     `cancelled` flag the orchestrator checks after each await so a kill can't be overwritten);
 *   - the persisted set of `.runs/<taskId>/task.json` statuses is what a restart reconciles
 *     against ({@link reconcileOnBoot}).
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeSession, SessionLogger } from './claude-session.js';
import { runsRoot, saveTask, type Task } from '../state/task.js';

interface Holder {
  taskId: string;
  /** the live child for the in-flight turn; null when paused at a gate (no child) or re-acquired on boot. */
  session: ClaudeSession | null;
}

let holder: Holder | null = null;
// Cancelled task ids — a Set, NOT a holder field, so the flag SURVIVES the lock release that
// `/cancel` performs: the orchestrator (running in a different request) checks `isCancelled` after
// its turn await and must still see `true` even though the holder was already cleared. Entries are
// keyed by the unique ms-timestamp taskId, so they never collide; the handful that accumulate over a
// server lifetime is negligible for a single-user local app.
const cancelledTasks = new Set<string>();

/** Acquire for `taskId`. Idempotent for the same task; false (→ caller maps to 409) if another holds it. */
export function acquire(taskId: string): boolean {
  if (holder && holder.taskId !== taskId) return false;
  cancelledTasks.delete(taskId); // fresh slate on (re)acquire
  if (!holder) holder = { taskId, session: null };
  return true;
}

/** Release iff the holder matches (terminal-status transition). No-op otherwise. */
export function release(taskId: string): void {
  if (holder && holder.taskId === taskId) holder = null;
}

/** The current lock holder's taskId, or null. */
export function holderTaskId(): string | null {
  return holder?.taskId ?? null;
}

/** Attach the live child for the in-flight turn (so `/cancel` can kill it). */
export function setSession(taskId: string, session: ClaudeSession | null): void {
  if (holder && holder.taskId === taskId) holder.session = session;
}

/** Detach the child handle when a turn ends (the build may still hold the lock at a gate). */
export function clearSession(taskId: string): void {
  if (holder && holder.taskId === taskId) holder.session = null;
}

/** The live child for `taskId`, or null when paused at a gate / not the holder. */
export function liveSession(taskId: string): ClaudeSession | null {
  return holder && holder.taskId === taskId ? holder.session : null;
}

/** Mark the in-flight build cancelled (checked by the orchestrator after each await; survives release). */
export function markCancelled(taskId: string): void {
  cancelledTasks.add(taskId);
}

/** True if `/cancel` flipped this build mid-flight — the orchestrator must stop writing status. */
export function isCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId);
}

/**
 * Boot reconcile (called ONCE from index.ts at startup, AC #19 + #24):
 *   - `running` / `scaffolding` tasks can NOT survive a restart (their child died) → `status:error`
 *     ("interrupted by backend restart — phase re-runnable"); lock NOT held for them.
 *   - an `awaiting_confirm` task is a live gated build with no child (paused) → it is left as-is and
 *     RE-ACQUIRES the lock so the user can still `/confirm` or `/cancel` it.
 *   - `done | error | cancelled` are ignored.
 *
 * Single-build invariant tie-breaker: at most one non-terminal task should exist. If several
 * `awaiting_confirm` tasks are found (corrupt state), keep only the most-recently-updated (file
 * mtime) and `error` the rest. The lock is re-acquired iff a surviving gated build remains.
 */
export async function reconcileOnBoot(projectsDir: string, log: SessionLogger): Promise<void> {
  holder = null;
  const root = runsRoot(projectsDir);
  if (!existsSync(root)) return;

  interface Rec {
    taskId: string;
    status: Task['status'];
    mtimeMs: number;
    task: Task;
  }
  const records: Rec[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const taskId of entries) {
    const f = join(root, taskId, 'task.json');
    if (!existsSync(f)) continue;
    try {
      const task = JSON.parse(await readFile(f, 'utf8')) as Task;
      const st = await stat(f);
      records.push({ taskId, status: task.status, mtimeMs: st.mtimeMs, task });
    } catch {
      // skip a corrupt/half-written task.json (the atomic-write temp should never be here).
    }
  }

  const nonTerminal = records.filter(
    (r) => r.status === 'running' || r.status === 'scaffolding' || r.status === 'awaiting_confirm'
  );
  // Only a paused (awaiting_confirm) build can survive a restart; pick the most recent as survivor.
  const survivor =
    nonTerminal
      .filter((r) => r.status === 'awaiting_confirm')
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0] ?? null;

  for (const r of nonTerminal) {
    if (survivor && r.taskId === survivor.taskId) continue; // keep the gated build as-is
    r.task.status = 'error';
    r.task.error =
      r.status === 'awaiting_confirm'
        ? 'superseded on boot (single-build invariant — only the most recent gated build is kept)'
        : 'interrupted by backend restart — phase re-runnable';
    await saveTask(projectsDir, r.task);
    log.warn({ taskId: r.taskId, prev: r.status }, 'boot reconcile → error');
  }

  if (survivor) {
    cancelledTasks.delete(survivor.taskId);
    holder = { taskId: survivor.taskId, session: null };
    log.info({ taskId: survivor.taskId }, 'boot reconcile: re-acquired lock for gated build');
  }
}

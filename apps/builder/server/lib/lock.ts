/**
 * lock.ts — the TURN-LEVEL run-lock for spec 009 (§I "Run-lock granularity", Lát 6 / Phase 3).
 *
 * The lock is held while a `claude` TURN (or a backend write-unit) is actually RUNNING — NOT for the
 * lifetime of a build. A build paused at a human gate (`awaiting_confirm`, no turn running) holds
 * NOTHING, so any number of builds may sit parked at gates; only turn *execution* is serialized
 * 1-at-a-time. This single-`turnHolder` invariant is what keeps the #3b post-turn confinement check
 * valid UNCHANGED: at most one build writes the tree at a time, so its `git status` baseline-delta is
 * never polluted by another build's turn. (Build-level locking — a gate holding the lock — was Lát 3;
 * this replaces it. The only time a 2nd build sees "busy" is a genuine TURN collision.)
 *
 * Two sources of truth, deliberately:
 *   - the in-memory `turnHolder` is the LIVE running turn (carries the child handle for `/cancel` + a
 *     `cancelled` flag the orchestrator checks after each await so a kill can't be overwritten). It is
 *     acquired synchronously in the route BEFORE the turn is dispatched, and released when the
 *     dispatched work settles (the build parks or terminates) — so it never outlives a running turn.
 *   - the persisted `.runs/<taskId>/task.json` statuses are what a restart reconciles against
 *     ({@link reconcileOnBoot}); `turnHolder` is in-memory only and starts null on boot.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeSession, SessionLogger } from './claude-session.js';
import { runsRoot, saveTask, type Task } from '../state/task.js';

interface TurnHolder {
  taskId: string;
  /** the live child for the in-flight turn; null between acquire and spawn, or after the turn ends. */
  session: ClaudeSession | null;
}

// The build whose turn is CURRENTLY executing, or null when no turn is running (any number of builds
// may be parked at gates meanwhile). A SINGLE slot — this IS the 1-writer invariant the #3b check rests on.
let turnHolder: TurnHolder | null = null;
// Cancelled task ids — a Set, NOT a turnHolder field, so the flag SURVIVES the release that happens
// when a cancelled turn unwinds: the orchestrator (running in a different request) checks `isCancelled`
// after its turn await and must still see `true` even though the turn lock was already released. Keyed
// by the unique ms-timestamp taskId, so entries never collide; the handful that accumulate over a
// server lifetime is negligible for a single-user local app.
const cancelledTasks = new Set<string>();

/**
 * Acquire the turn lock for `taskId`. STRICT: false (→ caller maps to 409) if ANY turn is already
 * running — including, defensively, a stale same-task holder (there should be none: every acquire is
 * paired with a release when its dispatched work settles). Strictness is what closes the
 * double-dispatch race — two concurrent `/confirm` for ONE build: the 2nd `acquireTurn` fails, so it
 * replaces the old `advancing` Set. Called synchronously in the route, right before dispatch.
 */
export function acquireTurn(taskId: string): boolean {
  if (turnHolder !== null) return false;
  cancelledTasks.delete(taskId); // fresh slate on (re)acquire (e.g. a /reply retry out of error)
  turnHolder = { taskId, session: null };
  return true;
}

/**
 * Release iff `taskId` is the running turn (no-op otherwise — "clear iff matches" makes a stray
 * release after another build already acquired harmless). Called from the dispatch `finally` when the
 * turn's work settles (the build parks at a gate or goes done/error/cancelled).
 */
export function releaseTurn(taskId: string): void {
  if (turnHolder && turnHolder.taskId === taskId) turnHolder = null;
}

/** The taskId of the turn currently executing, or null. */
export function turnHolderId(): string | null {
  return turnHolder?.taskId ?? null;
}

/** True if any turn is currently executing (a 2nd build's turn must wait → 409; parked builds don't count). */
export function turnBusy(): boolean {
  return turnHolder !== null;
}

/** Attach the live child for the in-flight turn (so `/cancel` can kill it). */
export function setSession(taskId: string, session: ClaudeSession | null): void {
  if (turnHolder && turnHolder.taskId === taskId) turnHolder.session = session;
}

/** Detach the child handle when a turn ends. */
export function clearSession(taskId: string): void {
  if (turnHolder && turnHolder.taskId === taskId) turnHolder.session = null;
}

/** The live child for `taskId`, or null when no turn is running for it / it is not the holder. */
export function liveSession(taskId: string): ClaudeSession | null {
  return turnHolder && turnHolder.taskId === taskId ? turnHolder.session : null;
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
 * Boot reconcile (called ONCE from index.ts at startup, AC #19 + #24). `turnHolder` is in-memory only,
 * so it starts null — NOTHING is held across a restart. Scan `.runs/<taskId>/task.json`:
 *   - `running` / `scaffolding` → `status:error` ("interrupted by backend restart — phase re-runnable");
 *     their child died with the process.
 *   - `awaiting_confirm` → LEFT AS-IS. A gate holds no lock now, so a parked build simply survives a
 *     restart and stays reachable. MULTIPLE parked builds are legal — there is no single-build
 *     tie-breaker and no lock re-acquire (both were dropped with build-level locking).
 *   - `done | error | cancelled` → ignored.
 */
export async function reconcileOnBoot(projectsDir: string, log: SessionLogger): Promise<void> {
  turnHolder = null;
  const root = runsRoot(projectsDir);
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  for (const taskId of entries) {
    const f = join(root, taskId, 'task.json');
    if (!existsSync(f)) continue;
    let task: Task;
    try {
      task = JSON.parse(await readFile(f, 'utf8')) as Task;
    } catch {
      continue; // skip a corrupt/half-written task.json (the atomic-write temp should never be here)
    }
    const prev = task.status;
    if (prev === 'running' || prev === 'scaffolding') {
      task.status = 'error';
      task.error = 'interrupted by backend restart — phase re-runnable';
      await saveTask(projectsDir, task);
      log.warn({ taskId, prev }, 'boot reconcile → error');
    }
    // awaiting_confirm survives untouched (turn-level lock — a parked gate holds nothing).
  }
}

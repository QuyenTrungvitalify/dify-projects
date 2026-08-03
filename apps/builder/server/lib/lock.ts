/**
 * lock.ts — the TURN-LEVEL run-lock for spec 009 (§I "Run-lock granularity", Lát 6 / Phase 3),
 * reworked by spec 082 S1 into TWO LANES.
 *
 * The lock is held while a `claude` TURN (or a backend write-unit) is actually RUNNING — NOT for the
 * lifetime of a build. A build paused at a human gate (`awaiting_confirm`, no turn running) holds
 * NOTHING, so any number of builds may sit parked at gates; only turn *execution* is serialized.
 *
 * Spec 082: ONE slot per LANE, keyed by the existing turn `kind`:
 *   - 'phase' → the BUILD lane: any turn that writes files / mutates task status (phase turns,
 *     promote turns, live-test, import). Single-slot — this preserves the 1-WRITER invariant the
 *     #3b post-turn confinement check rests on: at most one build writes the tree at a time, so its
 *     `git status` baseline-delta is never polluted by another build's turn.
 *   - 'ask'   → the CHAT lane: write-denied turns only (askWithin / askTestWithin / consultWithin,
 *     all `askMode:true` → the permission hook denies every Write/Edit). Running one of these beside
 *     a build turn cannot violate the 1-writer invariant, because it is not a writer.
 *
 * PER-TASK EXCLUSIVITY (the load-bearing 082 rule): a given task holds AT MOST ONE lane at a time —
 * `acquireTurn` refuses a task that already holds the other lane. Parallelism exists only BETWEEN
 * tasks, never within one, so every existing same-task safety argument (FIX-M snapshot windows,
 * PATCH/PUT-spec clobber guards, cancel convergence) is untouched.
 *
 * Two sources of truth, deliberately:
 *   - the in-memory `holders` are the LIVE running turns (each carries the child handle for
 *     `/cancel`). Acquired synchronously in the route BEFORE dispatch, released when the dispatched
 *     work settles — never outliving a running turn.
 *   - the persisted `.runs/<taskId>/task.json` statuses are what a restart reconciles against
 *     ({@link reconcileOnBoot}); `holders` is in-memory only and starts empty on boot.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClaudeSession, SessionLogger } from './claude-session.js';
import { runsRoot, saveTask, type Task } from '../state/task.js';

export type TurnKind = 'phase' | 'ask';

interface TurnHolder {
  taskId: string;
  /** the live child for the in-flight turn; null between acquire and spawn, or after the turn ends. */
  session: ClaudeSession | null;
  /** Spec 033 D9: distinguishes a phase turn from an Ask turn so `/cancel` can scope its abort — an
   *  Ask's force-kill must never converge the build's `status`/`gate` to `cancelled`. Under 082 the
   *  kind IS the lane, so this now also names which slot the holder occupies. */
  kind: TurnKind;
  /** Spec 033 review #2: set by `/cancel` when a Stop lands in the [lock acquired → session spawned]
   *  window of an Ask, where there is no live child to force-kill yet. `askWithin` checks it after its
   *  (potentially long) snapshot walk and bails before spawning. Lives on the holder (NOT the shared
   *  `cancelledTasks` Set, which would leak — an Ask never reaches a terminal status to evict it, D9), so
   *  it dies with the turn on `releaseTurn`. */
  cancelRequested: boolean;
}

// One slot per lane (082 S1). `holders.phase` is the build whose WRITE turn is currently executing —
// the single-writer slot; `holders.ask` is the task whose write-denied chat turn is executing.
const holders: Record<TurnKind, TurnHolder | null> = { phase: null, ask: null };

// Cancelled task ids — a Set, NOT a holder field, so the flag SURVIVES the release that happens
// when a cancelled turn unwinds: the orchestrator (running in a different request) checks `isCancelled`
// after its turn await and must still see `true` even though the turn lock was already released. Keyed
// by the unique ms-timestamp taskId, so entries never collide; the handful that accumulate over a
// server lifetime is negligible for a single-user local app. ONLY build-lane work reads it (ask turns
// never markCancelled, 033 D9).
const cancelledTasks = new Set<string>();

/** The holder (either lane) owned by `taskId`, or null. Unambiguous by per-task exclusivity. */
function holderFor(taskId: string): TurnHolder | null {
  if (holders.phase?.taskId === taskId) return holders.phase;
  if (holders.ask?.taskId === taskId) return holders.ask;
  return null;
}

/**
 * Acquire the `kind` lane for `taskId`. STRICT: false (→ caller maps to 409) if that lane is already
 * running ANY turn, or — per-task exclusivity (082) — if this task already holds the OTHER lane.
 * Strictness is what closes the double-dispatch race — two concurrent `/confirm` for ONE build: the
 * 2nd `acquireTurn` fails. Called synchronously in the route, right before dispatch.
 */
export function acquireTurn(taskId: string, kind: TurnKind = 'phase'): boolean {
  if (holders[kind] !== null) return false;
  if (holderFor(taskId) !== null) return false; // per-task exclusivity: one lane per task
  cancelledTasks.delete(taskId); // fresh slate on (re)acquire (e.g. a /reply retry out of error)
  holders[kind] = { taskId, session: null, kind, cancelRequested: false };
  return true;
}

/**
 * Release whichever lane `taskId` holds (no-op otherwise — "clear iff matches" makes a stray release
 * after another build already acquired harmless). Called from the dispatch `finally` when the turn's
 * work settles (the build parks at a gate or goes done/error/cancelled).
 */
export function releaseTurn(taskId: string): void {
  if (holders.phase?.taskId === taskId) holders.phase = null;
  if (holders.ask?.taskId === taskId) holders.ask = null;
}

/** True if a BUILD-lane turn is executing (a 2nd build's turn must wait → 409; parked builds and
 *  chat turns don't count). Replaces the pre-082 `turnBusy()` at every build fast-path. */
export function buildTurnBusy(): boolean {
  return holders.phase !== null;
}

/** True if a CHAT-lane turn is executing (an Ask/consult anywhere). */
export function chatTurnBusy(): boolean {
  return holders.ask !== null;
}

/** The taskId of the BUILD-lane turn currently executing, or null. Replaces the pre-082
 *  `turnHolderId()` at the orchestrator/promote spawn backstops + the /cancel evict decision. */
export function buildHolderId(): string | null {
  return holders.phase?.taskId ?? null;
}

/** The taskId of the CHAT-lane turn currently executing, or null (409 `holder` + test cleanup). */
export function chatHolderId(): string | null {
  return holders.ask?.taskId ?? null;
}

/** True if `taskId` holds ANY lane right now. Replaces every pre-082 `turnHolderId() === id` guard
 *  (PATCH / PUT-spec / /reply FIX-M / /restore / /live-test): those guards protect a task's own
 *  in-memory-snapshot writes, which an ask turn performs too (sessionIds saveTask). */
export function taskTurnRunning(taskId: string): boolean {
  return holderFor(taskId) !== null;
}

/** Attach the live child for `taskId`'s in-flight turn (so `/cancel` can kill it). */
export function setSession(taskId: string, session: ClaudeSession | null): void {
  const h = holderFor(taskId);
  if (h) h.session = session;
}

/** Detach the child handle when a turn ends. */
export function clearSession(taskId: string): void {
  const h = holderFor(taskId);
  if (h) h.session = null;
}

/** The live child for `taskId`, or null when no turn is running for it. */
export function liveSession(taskId: string): ClaudeSession | null {
  return holderFor(taskId)?.session ?? null;
}

/** Spec 033 D9: the kind of turn currently executing for `taskId` ('phase' | 'ask'), or null when no
 *  turn is running for it. `/cancel` branches on this to scope an Ask's abort. */
export function liveKind(taskId: string): TurnKind | null {
  return holderFor(taskId)?.kind ?? null;
}

/** Spec 033 review #2: flag an in-flight Ask for cancellation when there is no live child to force-kill
 *  yet (the pre-spawn snapshot window). No-op unless `taskId` holds a turn. */
export function requestAskCancel(taskId: string): void {
  const h = holderFor(taskId);
  if (h) h.cancelRequested = true;
}

/** True if a cancel was requested for the in-flight turn on `taskId` (checked by `askWithin` after its
 *  snapshot, before spawning). Dies with the turn on `releaseTurn` — never leaks across turns. */
export function isAskCancelRequested(taskId: string): boolean {
  return holderFor(taskId)?.cancelRequested ?? false;
}

/** Mark the in-flight build cancelled (checked by the orchestrator after each await; survives release). */
export function markCancelled(taskId: string): void {
  cancelledTasks.add(taskId);
}

/** True if `/cancel` flipped this build mid-flight — the orchestrator must stop writing status. */
export function isCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId);
}

/** Clear the cancelled flag so a /restore'd build can run a turn again (without this, the orchestrator's
 *  post-await `isCancelled` checks would bail the resumed turn). In-memory only — a restart already
 *  clears the Set, so this only matters for a same-process restore. */
export function unmarkCancelled(taskId: string): void {
  cancelledTasks.delete(taskId);
}

/**
 * Evict a build's cancelled flag once it has reached a TERMINAL status and its dispatched work has fully
 * settled — bounding `cancelledTasks` so it can't grow without limit over a long-lived server (spec 014
 * D7). Call this ONLY on terminal settle (done/error/cancelled), NEVER on a plain turn-lock release: the
 * flag MUST outlive the release so the orchestrator's post-await `isCancelled` checks (which run after
 * the turn await unwinds, before the dispatched chain finishes) still see it. By the time a chain is
 * terminal-settled, no further check needs it, and a later /restore re-acquire would clear it anyway.
 * Same body as {@link unmarkCancelled}; named distinctly so the call sites document their intent.
 */
export function evictCancelled(taskId: string): void {
  cancelledTasks.delete(taskId);
}

/** Count of tracked cancelled flags — for the bounded-Set test (spec 014 D7). */
export function cancelledCount(): number {
  return cancelledTasks.size;
}

/**
 * Boot reconcile (called ONCE from index.ts at startup, AC #19 + #24). `holders` is in-memory only,
 * so both lanes start empty — NOTHING is held across a restart. Scan `.runs/<taskId>/task.json`:
 *   - `running` / `scaffolding` → `status:error` ("interrupted by backend restart — phase re-runnable");
 *     their child died with the process.
 *   - `awaiting_confirm` → LEFT AS-IS. A gate holds no lock now, so a parked build simply survives a
 *     restart and stays reachable. MULTIPLE parked builds are legal — there is no single-build
 *     tie-breaker and no lock re-acquire (both were dropped with build-level locking).
 *   - `done | error | cancelled` → ignored. (A `kind:'consult'` task is born `done`, so a restart
 *     mid-chat-turn leaves it untouched — reopen and keep chatting, spec 082 §4.1.)
 */
export async function reconcileOnBoot(projectsDir: string, log: SessionLogger): Promise<void> {
  holders.phase = null;
  holders.ask = null;
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

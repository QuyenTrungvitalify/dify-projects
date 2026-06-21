/* ============================================================
   store.ts — slim @preact/signals store for the Lát 4 UI.
   NOT a copy of nexus's 981-LOC store: authored fresh. The store
   is DUMB — it never decides gate logic, it renders what the
   backend sends (task.json over SSE / GET). It mirrors the live
   task, builds the chat thread from SSE transitions, and exposes
   the action verbs the components call (start/confirm/reply/cancel/
   saveSpec/openTask). All gate/verify/phase logic stays backend-side.
   ============================================================ */
import { signal, computed } from '@preact/signals';
import { api, confirmModeWire, ApiError, type ImageAttachment } from './api';
import { connectSSE } from './sse-client';
import type {
  WireTask,
  WireTreeProject,
  WireTreeTask,
  WirePhase,
  Seed,
  WireGateAction,
} from './types';

let _uid = 0;
const uid = (): string => 'i' + ++_uid;

export type UiPhaseState = 'pending' | 'running' | 'awaiting' | 'done' | 'error';
const PHASE_ORDER: WirePhase[] = ['analyze', 'spec', 'implement', 'test'];

/** Live chat-thread items, built client-side from SSE transitions (the backend stores no chat log). */
export type LiveThreadItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'run'; phase: WirePhase; running: boolean; output: string; stopped?: boolean }
  | { id: string; kind: 'gate'; phase: WirePhase; snapshot: WireTask; resolved?: string };

/** Run-settings shown below the input (AC #14): Workflow / Confirm mode / Deploy only. */
export interface RunSettings {
  workflow: string; // 'none' = new workflow
  confirm: string; // 'each step' | 'spec only' | 'auto'
  deploy: string; // 'none' | 'selfhost' | 'cloud'
  seed: string | null; // selected seed id (degrades to none until Lát 5)
}

// ───────────────────────────── signals ─────────────────────────────
export const tree = signal<WireTreeProject[]>([]);
export const seeds = signal<Seed[]>([]);
export const task = signal<WireTask | null>(null);
export const thread = signal<LiveThreadItem[]>([]);
export const connected = signal(false);
/** The in-progress (non-terminal) builds for the sidebar (Lát 6). With the turn-level lock, multiple
 *  builds can sit parked at gates; fetched on load so a parked build is never stranded. */
export const active = signal<WireTreeTask[]>([]);
/** A turn-collision (409) or other start error to surface in the UI (AC #21). */
export const startError = signal<string | null>(null);
/** The taskId whose turn is running, parsed from a 409 — lets the UI offer "open it" (Lát 6). */
export const busyHolder = signal<string | null>(null);
export const settings = signal<RunSettings>({ workflow: 'none', confirm: 'each step', deploy: 'none', seed: null });

// ───────────────────────────── confirm dialog (common) ─────────────────────────────
/** Options for the site-styled confirm dialog (replaces window.confirm()). */
export interface ConfirmOptions {
  title: string;
  message?: string;
  okLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}
/** The live confirm request (App renders <ConfirmModal> from this), with the pending resolver. */
export type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };
export const confirmState = signal<ConfirmRequest | null>(null);

/**
 * Common confirm prompt — `await askConfirm({...})` resolves true (OK) / false (Cancel/Esc/backdrop).
 * Any component or store action can call it; App renders the single mounted ConfirmModal. A second
 * call while one is open auto-cancels the first (resolves it false) so prompts never stack.
 */
export function askConfirm(opts: ConfirmOptions): Promise<boolean> {
  confirmState.value?.resolve(false); // supersede any open prompt
  return new Promise<boolean>((resolve) => {
    confirmState.value = { ...opts, resolve };
  });
}
/** Resolve + dismiss the open confirm dialog (wired to ConfirmModal's onOk/onCancel in App). */
export function resolveConfirm(ok: boolean): void {
  const req = confirmState.value;
  confirmState.value = null;
  req?.resolve(ok);
}

/** Fixed 4-phase state derived from the single authoritative task snapshot (SSE-driven, no poll). */
export const phaseStates = computed<Record<WirePhase, UiPhaseState>>(() => {
  const out: Record<WirePhase, UiPhaseState> = {
    analyze: 'pending',
    spec: 'pending',
    implement: 'pending',
    test: 'pending',
  };
  const t = task.value;
  if (!t) return out;
  const ci = PHASE_ORDER.indexOf(t.phase);
  for (let i = 0; i < ci; i++) out[PHASE_ORDER[i]] = 'done';
  out[t.phase] =
    t.status === 'running' || t.status === 'scaffolding'
      ? 'running'
      : t.status === 'awaiting_confirm'
        ? 'awaiting'
        : t.status === 'error'
          ? 'error'
          : t.status === 'done'
            ? 'done'
            : 'pending'; // cancelled
  if (t.status === 'done') out.test = 'done';
  return out;
});

export const currentPhase = computed<WirePhase | null>(() => task.value?.phase ?? null);
export const busy = computed<boolean>(
  () => task.value?.status === 'running' || task.value?.status === 'scaffolding'
);

// ───────────────────────────── thread building ─────────────────────────────
/** Coarse phase-state used to decide thread transitions (scaffolding folds into running). */
function coarse(status: WireTask['status']): 'run' | 'gate' {
  return status === 'running' || status === 'scaffolding' ? 'run' : 'gate';
}

function resolveLabel(t: WireTask): string {
  if (t.status === 'done') return 'Done';
  if (t.status === 'error') return 'Errored';
  if (t.status === 'cancelled') return 'Cancelled';
  const primary = t.gate?.actions.find((a) => a.kind === 'confirm');
  return primary ? primary.label : 'Continued';
}

// ───────────────────────────── reconnect version guard (spec 014 D5 / 011 R8) ─────────────────────
// The init/reconnect path fires a fire-and-forget `api.getTask(id).then(applyTask)`, and `applyTask`
// itself fires a second GET at a gate to inline artifact contents. Either GET can resolve AFTER a newer
// live `task:update` has already been applied — and `applyTask` used to set `task.value` UNconditionally,
// so the stale response would clobber the newer state (the exact "reconnect shows an older gate" hazard
// AC #22 / 011 R8 describe). Each persisted transition now carries a monotonic `rev` (server `emit`); we
// drop any snapshot strictly older than the last applied for the SAME task.
let _appliedTaskId: string | null = null;
let _appliedRev = -1;

/**
 * Is `t` fresh enough to apply (vs a stale late GET)? A different task — or the first snapshot — always
 * applies and resets the tracking. For the same task we keep the rule loose at EQUAL rev: the
 * artifact-contents enrichment GET shares the rev of the live update that triggered it and must still
 * land (it only adds `artifactContents`), so only a STRICTLY older rev is dropped. Absent `rev` ⇒ 0
 * (pre-014 snapshots migrate trivially). PURE — the unit test drives it directly (014 D5 / R8).
 */
export function isFreshSnapshot(t: WireTask, lastTaskId: string | null, lastRev: number): boolean {
  if (t.taskId !== lastTaskId) return true;
  return (t.rev ?? 0) >= lastRev;
}

/** Apply an authoritative task snapshot: set the signal, then extend the chat thread on transition. */
export function applyTask(t: WireTask): void {
  // 017 D6: drain any buffered streaming fragments onto the still-running run item BEFORE this
  // snapshot mutates the thread (a gate transition finalizes the run → unflushed text would be lost).
  flushPendingOutput();
  // 014 D5 / R8: never let a late (older-rev) reconnect GET revert a newer applied state.
  if (!isFreshSnapshot(t, _appliedTaskId, _appliedRev)) return;
  _appliedTaskId = t.taskId;
  _appliedRev = t.rev ?? 0;
  task.value = t;
  const items = thread.value.slice();
  const last = items[items.length - 1];

  if (coarse(t.status) === 'run') {
    // Phase is (re-)running. Reuse the trailing run item for this phase, else open a fresh one.
    if (last && last.kind === 'run' && last.phase === t.phase) {
      if (!last.running) items[items.length - 1] = { ...last, running: true };
    } else {
      // mark a preceding unresolved gate as resolved before starting the next run
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === 'gate' && !(items[i] as { resolved?: string }).resolved) {
          items[i] = { ...(items[i] as LiveThreadItem & { kind: 'gate' }), resolved: resolveLabel(t) };
          break;
        }
        if (items[i].kind === 'run') break;
      }
      items.push({ id: uid(), kind: 'run', phase: t.phase, running: true, output: '' });
    }
  } else {
    // Gate state (awaiting_confirm / error / done / cancelled): finish the run, surface the gate.
    // A `cancelled` build that was mid-turn marks its run `stopped` so the disclosure shows
    // "Stopped during ① …" (alert) instead of a green ✓ as if the phase had completed (design handoff).
    if (last && last.kind === 'run' && last.running) {
      items[items.length - 1] = { ...last, running: false, stopped: t.status === 'cancelled' };
    }
    const lastNow = items[items.length - 1];
    if (lastNow && lastNow.kind === 'gate' && !lastNow.resolved && lastNow.phase === t.phase) {
      items[items.length - 1] = { ...lastNow, snapshot: t }; // refresh the active gate (reconnect)
    } else {
      items.push({ id: uid(), kind: 'gate', phase: t.phase, snapshot: t });
    }
    // SSE task:update carries no artifact contents — re-fetch once at a gate so the panel is fresh.
    if (!t.artifactContents) {
      void api.getTask(t.taskId).then(applyTask).catch(() => {});
    }
  }
  thread.value = items;
}

/**
 * Optimistically close the active gate after a fire-and-forget /confirm or /reply: mark the trailing
 * unresolved gate resolved + reflect the snapshot (so the buttons disappear and `busy` is true)
 * WITHOUT pushing a run item. The optimistic snapshot still carries the OLD phase, so letting
 * applyTask build the thread would synthesize a duplicate "Running <old phase>" disclosure; the
 * authoritative SSE task:update opens the correct (next-phase / re-run) run item instead.
 */
function optimisticAdvance(t: WireTask, resolvedLabel: string): void {
  task.value = t;
  // Track the optimistic snapshot's rev too (014 D5), so a late older-rev GET issued before this action
  // can't revert the optimistic state; the authoritative SSE `task:update` carries a newer rev and wins.
  _appliedTaskId = t.taskId;
  _appliedRev = Math.max(_appliedRev, t.rev ?? 0);
  const items = thread.value.slice();
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'run') break;
    const g = items[i];
    if (g.kind === 'gate' && !g.resolved) {
      items[i] = { ...g, resolved: resolvedLabel };
      break;
    }
  }
  thread.value = items;
}

// ───────────────────────────── streaming output coalescing (spec 017 D6 / F2) ───────────────────
// Streaming emits many small `phase:output` fragments. Reassigning `thread.value` per fragment makes
// the Disclosure re-render once per fragment; even with the markdown render memoized per buffer
// (Chat.tsx D6), N writes still cost N renders over a growing buffer. We accumulate per-phase text and
// flush at most once per animation frame. CRUCIAL invariant: every applyTask (a gate/phase transition
// over SSE) calls flushPendingOutput() FIRST, so buffered text always lands on the still-running run
// item BEFORE the gate finalizes it (running→false) — no output is ever lost at the run→gate boundary.
let _pendingOutput = new Map<string, string>();
let _outputRaf: number | null = null;

/** Apply (and clear) any buffered fragments onto the trailing running run item. Idempotent. */
export function flushPendingOutput(): void {
  if (_outputRaf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_outputRaf);
  _outputRaf = null;
  if (_pendingOutput.size === 0) return;
  const items = thread.value.slice();
  const last = items[items.length - 1];
  let changed = false;
  if (last && last.kind === 'run' && last.running) {
    const add = _pendingOutput.get(last.phase);
    if (add) {
      items[items.length - 1] = { ...last, output: last.output + add };
      changed = true;
    }
  }
  _pendingOutput.clear();
  if (changed) thread.value = items;
}

export function applyOutput(phase: string, text: string): void {
  _pendingOutput.set(phase, (_pendingOutput.get(phase) ?? '') + text);
  if (typeof requestAnimationFrame === 'function') {
    if (_outputRaf == null) _outputRaf = requestAnimationFrame(flushPendingOutput);
  } else {
    flushPendingOutput(); // no rAF (tests / non-browser) → behave exactly like the old sync append
  }
}

// ───────────────────────────── SSE lifecycle ─────────────────────────────
let teardown: (() => void) | null = null;

function openStream(taskId: string): void {
  teardown?.();
  teardown = connectSSE(taskId, {
    // On (re)connect, re-fetch the authoritative state so a missed gate is restored (AC #22).
    onInit: () => {
      void api.getTask(taskId).then(applyTask).catch(() => {});
    },
    onTaskUpdate: applyTask,
    onPhaseOutput: (d) => applyOutput(d.phase, d.text),
    onConnect: () => {
      connected.value = true;
    },
    onDisconnect: () => {
      connected.value = false;
    },
  });
}

// ───────────────────────────── actions ─────────────────────────────
/** Surface an action error: a turn-collision 409 with a `holder` arms the "open it" jump (Lát 6); any
 *  other error is a plain message. Clears `busyHolder` when the failure is not a turn collision. */
function surfaceError(e: unknown): void {
  if (e instanceof ApiError) {
    startError.value = e.message;
    busyHolder.value = e.status === 409 && e.holder ? e.holder : null;
  } else {
    startError.value = String(e);
    busyHolder.value = null;
  }
}

function clearErrors(): void {
  startError.value = null;
  busyHolder.value = null;
}

export async function loadTree(): Promise<void> {
  try {
    tree.value = (await api.tree()).projects;
  } catch {
    /* tree is best-effort */
  }
}

/** Fetch the in-progress builds for the sidebar (load-recovery + post-action refresh, Lát 6). */
export async function loadActive(): Promise<void> {
  try {
    active.value = (await api.active()).active;
  } catch {
    /* active list is best-effort */
  }
}

export async function loadSeeds(): Promise<void> {
  try {
    seeds.value = (await api.seeds()).seeds;
  } catch {
    seeds.value = [];
  }
}

/** Start a new build from the composer (AC #14 settings feed the body; turn-collision 409 → startError
 *  + busyHolder, AC #21). A parked build no longer blocks — only a running turn does. */
export async function start(requirement: string, images?: ImageAttachment[]): Promise<void> {
  clearErrors();
  const s = settings.value;
  thread.value = [{ id: uid(), kind: 'user', text: requirement }];
  task.value = null;
  try {
    const t = await api.createTask({
      requirement,
      workflow: s.workflow && s.workflow !== 'none' ? s.workflow : null,
      confirm_mode: confirmModeWire(s.confirm),
      deploy: s.deploy,
      seed: s.seed,
      ...(images && images.length ? { images } : {}),
    });
    applyTask(t);
    openStream(t.taskId);
    void loadTree();
    void loadActive();
  } catch (e) {
    surfaceError(e);
  }
}

/** Confirm a gate action (kind:'confirm'). Slug/name carried at the Spec gate (AC #18). */
export async function confirm(action: WireGateAction, extra?: { slug?: string; name?: string }): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    // Optimistic: close the gate; SSE opens the next-phase run item (no duplicate "Running").
    optimisticAdvance(await api.confirm(t.taskId, action.id, extra), action.label);
    void loadActive();
  } catch (e) {
    surfaceError(e);
  }
}

/** Within-phase change request (kind:'reply') or Retry-out-of-error (+ optional images, AC3). `label`
 *  is the chosen reply action's English label (spec 016 D4) so the resolved gate reads true (Edit spec /
 *  Keep trying); the free-form dock reply has no specific action → the generic 'Requested changes'. */
export async function reply(text: string, label?: string, images?: ImageAttachment[]): Promise<void> {
  const t = task.value;
  if (!t || !text.trim()) return;
  const items = thread.value.slice();
  items.push({ id: uid(), kind: 'user', text: text.trim() });
  thread.value = items;
  try {
    // Optimistic: close the gate; SSE re-opens the current phase as a fresh run (no duplicate).
    optimisticAdvance(await api.reply(t.taskId, text.trim(), images), label ?? 'Requested changes');
    void loadActive();
  } catch (e) {
    surfaceError(e);
  }
}

/** Abandon the OPEN build (kind:'cancel' gate action — the gate card's Discard/Abandon). */
export async function cancel(): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    applyTask(await api.cancel(t.taskId));
  } catch (e) {
    surfaceError(e);
  }
  void loadTree();
  void loadActive();
}

/** Reopen the OPEN cancelled build at the previous phase's gate (undo the Continue that advanced too
 *  far). Marks the trailing cancelled gate resolved so the rewound gate renders below it as history. */
export async function restore(): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    const restored = await api.restore(t.taskId);
    // Resolve the cancelled "Build abandoned" card (drop its Restore button). Target it by status, NOT
    // "the trailing unresolved gate": the backend's restore broadcast may have raced ahead over SSE and
    // already pushed the rewound spec gate, and resolving THAT by mistake would orphan the abandoned
    // card AND duplicate the spec gate (the bug this replaces).
    const items = thread.value.slice();
    for (let i = items.length - 1; i >= 0; i--) {
      const g = items[i];
      if (g.kind === 'gate' && !g.resolved && g.snapshot.status === 'cancelled') {
        items[i] = { ...g, resolved: 'Restored' };
        break;
      }
    }
    thread.value = items;
    // Idempotent for the rewound phase: pushes the spec gate, or refreshes it in place if the SSE
    // broadcast already opened it (same-phase unresolved gate) — so exactly one spec card results.
    applyTask(restored);
  } catch (e) {
    surfaceError(e);
  }
  void loadTree();
  void loadActive();
}

/** F1: cancel a build by id WITHOUT it being the open task (the sidebar hover-×). The open task's
 *  `cancel()` only touches `task.value`; this dismisses a parked/running build from the in-progress
 *  list directly. If it happens to be the open build, mirror the terminal state into the thread too. */
export async function cancelById(taskId: string): Promise<void> {
  try {
    const t = await api.cancel(taskId);
    if (task.value?.taskId === taskId) applyTask(t);
  } catch (e) {
    surfaceError(e);
  }
  void loadTree();
  void loadActive();
}

/** Map the backend's internal confirmMode → the composer's UI label (inverse of confirmModeWire). */
export function confirmModeLabel(mode: WireTask['confirmMode']): string {
  if (mode === 'auto') return 'auto';
  if (mode === 'spec_only') return 'spec only';
  return 'each step';
}

/** F2 (spec 010): live-patch the ACTIVE build's confirm-mode (the conversation-view confirm chip).
 *  PATCHes the running/parked task so the NEXT boundary honors it, AND updates `settings` so future
 *  builds inherit the choice. The open task's `confirmMode` is reflected optimistically (the chip
 *  reads it back); SSE also carries the authoritative `task:update`. */
export async function patchConfirmMode(taskId: string, uiLabel: string): Promise<void> {
  settings.value = { ...settings.value, confirm: uiLabel }; // future builds inherit
  try {
    const t = await api.patchTask(taskId, { confirm_mode: confirmModeWire(uiLabel) });
    if (task.value?.taskId === t.taskId) task.value = { ...task.value, confirmMode: t.confirmMode };
  } catch (e) {
    surfaceError(e);
  }
}

/** Save an in-place SPEC.md edit (AC #3). */
export async function saveSpec(content: string): Promise<void> {
  const t = task.value;
  if (!t) return;
  // C3 (spec 019): saveSpec was the one action with no error feedback — a failed PUT died in the console
  // with the user thinking the edit saved. Surface it like openTask/patchConfirmMode (additive; the
  // happy path and the void return type are unchanged).
  try {
    await api.putSpec(t.taskId, content);
  } catch (e) {
    surfaceError(e);
  }
}

/** Open an existing task from the sidebar: load state + stream it (history isn't persisted, so the
 *  thread starts from the requirement + current gate/run). */
export async function openTask(taskId: string): Promise<void> {
  clearErrors();
  try {
    const t = await api.getTask(taskId);
    thread.value = [{ id: uid(), kind: 'user', text: t.requirement }];
    task.value = null;
    applyTask(t);
    openStream(taskId);
  } catch (e) {
    surfaceError(e);
  }
}

/** Reset to the empty/new-task surface (keeps the stream torn down). */
export function resetToNew(): void {
  teardown?.();
  teardown = null;
  task.value = null;
  thread.value = [];
  // C2 (spec 019): also clear the reconnect rev-guard. Without this, `_appliedTaskId`/`_appliedRev`
  // survive the reset, so re-opening a build whose persisted `rev` is ≤ the last-applied rev is dropped
  // by `isFreshSnapshot` in `applyTask` → `task.value` stays null and the thread shows only the user
  // line (a blank thread). Resetting to the initial sentinels makes the next `applyTask` always apply.
  _appliedTaskId = null;
  _appliedRev = -1;
  clearErrors();
  connected.value = false;
}

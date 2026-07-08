/* ============================================================
   store.ts — slim @preact/signals store for the Lát 4 UI.
   NOT a copy of nexus's 981-LOC store: authored fresh. The store
   is DUMB — it never decides gate logic, it renders what the
   backend sends (task.json over SSE / GET). It mirrors the live
   task, builds the chat thread from SSE transitions, and exposes
   the action verbs the components call (start/confirm/reply/cancel/
   saveSpec/openTask). All gate/verify/phase logic stays backend-side.
   ============================================================ */
import { signal, computed, effect } from '@preact/signals';
import { api, confirmModeWire, ApiError, type Attachment } from './api';
import { serializeThread, parseThread, hydrateForReopen } from './lib/thread-persist';
import { connectSSE, type AskAnomalyFile } from './sse-client';
import { t as tr, tf } from './lib/i18n';
import type {
  WireTask,
  WireArtifacts,
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
  | { id: string; kind: 'gate'; phase: WirePhase; snapshot: WireTask; resolved?: string }
  /** spec 033: a conversational Ask exchange — message↔message, never re-runs the phase. `done` flips
   *  once the backend's `ask:done` settles (streaming stops; the "Answered" chrome renders).
   *  spec 034 §2: `seededFrom` (④/terminal Ask only) lists the sources folded into the fresh seed so a
   *  possibly-incomplete answer is visible rather than silently trusted; absent on a 033 phase Ask. */
  | { id: string; kind: 'qa'; question: string; answer: string; done: boolean; seededFrom?: string[] };

/** Run-settings shown below the input (AC #14): Workflow · Confirm · Fast build (spec 036 dropped
 *  Deploy + Test — deploy/testMode are decided at the test gate from reachable creds, not start-bound). */
export interface RunSettings {
  workflow: string; // 'none' = new workflow
  confirm: string; // 'each step' | 'spec only' | 'auto'
  seed: string | null; // selected seed id (degrades to none until Lát 5)
  fast: boolean; // spec 028: ⚡ Fast build (merge Analyze+Spec); backend force-offs it on seed/workflow/slug
  targetProject: string | null; // spec 030: the target PROJECT folder — the sidebar project-"+" folder, OR the parent project of a workflow-"+" edit. The build lands in projects/<targetProject>/.
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
export const settings = signal<RunSettings>({ workflow: 'none', confirm: 'each step', seed: null, fast: false, targetProject: null });

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
/** spec 033 FIX-H: `busy` is derived solely from status running/scaffolding — an Ask never sets those
 *  (D3), so it never flips `busy`. This independent signal tracks a LIVE Ask so the docked action bar
 *  (and the composer's send-readiness) can disable during one: `disabled={busy || asking}`. */
export const asking = signal(false);

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

/**
 * Assign the authoritative task signal, carrying the last-known `artifactContents` forward when the
 * incoming snapshot omits them. ONLY a GET `/api/tasks/:id` carries artifact contents; SSE
 * `task:update` AND the optimistic /confirm-/reply snapshots do NOT. A naive `task.value = t` would
 * blank the artifact panel (the spec/yaml/diff/report panes read `task.artifactContents`) for the whole
 * running phase — a running phase never hits the gate-branch re-fetch. Preserving them keeps the panel
 * showing what the last gate fetched; a fresh GET (gate re-fetch / reconnect) overrides with new
 * contents. Used by BOTH applyTask and optimisticAdvance so neither path can re-introduce the blank.
 */
function setTaskValue(t: WireTask): void {
  const prev = task.value;
  task.value = t.artifactContents
    ? t
    : { ...t, artifactContents: prev && prev.taskId === t.taskId ? prev.artifactContents : undefined };
}

/**
 * Recover artifactContents from a STALE-rev (same-task) GET that the freshness guard is about to drop.
 * The `auto` confirm-mode race: the Spec-gate enrichment GET fires at the gate, but auto-advance moves
 * on to a NEWER rev (Implement running) before that GET resolves — so `isFreshSnapshot` drops it and the
 * spec/yaml pane stays blank for the ENTIRE running phase (a running phase never re-fetches). Symptom:
 * opening SPEC during an auto Implement shows "SPEC.md はまだありません". artifactContents are ADDITIVE,
 * so we graft only the fields the live state is MISSING and NEVER touch phase/status/gate/rev — so a
 * cancelled/superseded gate can't be resurrected (the 014 D5 invariant the drop protects). No-op when
 * the GET has no contents, adds nothing new, or is a different task.
 */
function graftStaleArtifacts(t: WireTask): void {
  const cur = task.value;
  if (!t.artifactContents || !cur || cur.taskId !== t.taskId) return;
  const a = cur.artifactContents;
  const g = t.artifactContents;
  const merged: WireArtifacts = {
    spec: a?.spec ?? g.spec ?? null,
    yaml: a?.yaml ?? g.yaml ?? null,
    report: a?.report ?? g.report ?? null,
    diff: a?.diff ?? g.diff ?? null,
  };
  if (a && merged.spec === a.spec && merged.yaml === a.yaml && merged.report === a.report && merged.diff === a.diff) {
    return; // the live state already has everything this GET could add — no signal churn
  }
  task.value = { ...cur, artifactContents: merged };
}

/** Apply an authoritative task snapshot: set the signal, then extend the chat thread on transition. */
export function applyTask(t: WireTask): void {
  // spec 040 D4: remember the active task's prior status so we can refresh the sidebar "In progress"
  // list on a genuine transition (captured BEFORE setTaskValue below overwrites it).
  const prevStatus = task.value?.taskId === t.taskId ? task.value.status : undefined;
  // 017 D6: drain any buffered streaming fragments onto the still-running run item BEFORE this
  // snapshot mutates the thread (a gate transition finalizes the run → unflushed text would be lost).
  flushPendingOutput();
  // 014 D5 / R8: never let a late (older-rev) reconnect GET revert a newer applied state — but a stale
  // same-task GET can still carry artifactContents the live state lacks (the auto-mode Spec-gate race),
  // so graft those (contents only, never phase/gate) before dropping the snapshot.
  if (!isFreshSnapshot(t, _appliedTaskId, _appliedRev)) {
    graftStaleArtifacts(t);
    return;
  }
  _appliedTaskId = t.taskId;
  _appliedRev = t.rev ?? 0;
  setTaskValue(t);
  // spec 040 D4: on a real status transition (running→gate arrives via SSE with no user action; or
  // →done/cancelled), refresh the sidebar list so its hint isn't stale and a finished build leaves it.
  // Gated on the change so it fires a handful of times per build, not on every streaming rev.
  if (prevStatus !== t.status) void loadActive();
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
    // Refresh the parked gate in place on a reconnect/re-emit. The trailing item is NOT necessarily the
    // gate: an Ask (spec 033/034) pushes `user`+`qa` items AFTER the gate card, so a plain `items[len-1]`
    // check would miss the still-parked gate on a reconnect GET (onInit → getTask → applyTask) and push a
    // DUPLICATE gate card below the Q&A — visibly wrong, and at a ④/terminal gate the duplicate carries
    // live action buttons. Scan back past qa/user items for the unresolved same-phase gate instead; stop at
    // a `run` (a gate before it belongs to a prior phase). Mirrors the run-branch's own backward scan above.
    let refreshed = false;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'run') break;
      if (it.kind === 'gate' && !it.resolved && it.phase === t.phase) {
        items[i] = { ...it, snapshot: t }; // refresh the active gate (reconnect)
        refreshed = true;
        break;
      }
    }
    if (!refreshed) {
      // Terminal echo of a just-resolved gate: a TERMINAL confirm at ④ (e.g. "Accept result",
      // "Skip import") returns an optimistic `running` snapshot (optimisticAdvance pushes NO run item)
      // and the backend then emits the authoritative `done` with NO intervening running phase. The scan
      // above can't reuse the gate the user just resolved, so a naive push spawns a SECOND, identical
      // terminal card BELOW it — the visible "duplicate Test passed" report. When the trailing item is
      // already a RESOLVED gate for THIS phase and the snapshot is terminal, refresh that card in place
      // (keep it resolved) instead of duplicating. A genuine re-run always emits an intermediate
      // `running` first (→ a run item sits between), so this never suppresses a legitimately-new card.
      const tail = items[items.length - 1];
      const terminal = t.status === 'done' || t.status === 'cancelled' || t.status === 'error';
      if (terminal && tail && tail.kind === 'gate' && tail.resolved && tail.phase === t.phase) {
        items[items.length - 1] = { ...tail, snapshot: t };
      } else {
        items.push({ id: uid(), kind: 'gate', phase: t.phase, snapshot: t });
      }
    }
    // SSE task:update carries no artifact contents — re-fetch once at a gate so the panel is fresh.
    if (!t.artifactContents) {
      void api.getTask(t.taskId).then(applyTask).catch(() => {});
    }
  }
  // Invariant: the builder runs one phase at a time (turn-locked), so only the TRAILING run item may be
  // active. An out-of-order / auto-advance / reconnect snapshot can leave an EARLIER run still `running`
  // (e.g. a duplicate "Running ②" after the spec gate); the gate/cancel branch only finalizes the trailing
  // item, so that orphan spins forever (visible after /cancel in auto mode). Close any non-trailing running
  // run — its phase already completed, so mark it done (running:false), NOT stopped.
  for (let i = 0; i < items.length - 1; i++) {
    const it = items[i];
    if (it.kind === 'run' && it.running) items[i] = { ...it, running: false };
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
  setTaskValue(t); // keep the gate-fetched artifactContents — /confirm's snapshot omits them (panel-blank fix)
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

/** Apply (and clear) any buffered fragments onto their phase's run item. Idempotent. */
export function flushPendingOutput(): void {
  if (_outputRaf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_outputRaf);
  _outputRaf = null;
  if (_pendingOutput.size === 0) return;
  const items = thread.value.slice();
  let changed = false;
  // C1 (spec 019): land each buffered phase's text on the MOST RECENT run item of THAT phase — even one
  // already finalized (running:false) once a gate sits after it. The old code only appended to the
  // trailing item when it was a *running* run, then `clear()`-ed ALL buffers — so a `phase:output`
  // straggler arriving after the run→gate boundary (trailing item now the gate) was dropped silently.
  // We instead find the run item by phase, and clear ONLY a key once it lands (no double-append); a
  // phase with no run item yet keeps its buffer (no live target), so an early fragment isn't dropped
  // before its run item exists either.
  for (const phase of [..._pendingOutput.keys()]) {
    const add = _pendingOutput.get(phase);
    if (!add) {
      _pendingOutput.delete(phase);
      continue;
    }
    let idx = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === 'run' && it.phase === phase) {
        idx = i;
        break;
      }
    }
    if (idx === -1) continue; // no live target for this phase yet → keep buffered (don't drop)
    const run = items[idx] as LiveThreadItem & { kind: 'run' };
    items[idx] = { ...run, output: run.output + add };
    _pendingOutput.delete(phase);
    changed = true;
  }
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

// ───────────────────────────── Ask streaming accumulation (spec 033 FIX-C) ──────────────────────
// A parallel rAF-coalesced buffer for `{kind:'qa'}` items — targeted by scanning for the trailing
// qa item with `done:false` (not a per-phase Map, unlike applyOutput above): the app-wide turn lock
// (server/lib/lock.ts) guarantees at most one turn — phase OR Ask — runs anywhere at a time, so there
// is never more than one qa item "in flight" at once; the scan is equivalent to (and simpler + more
// testable than) tracking a private current-item id, mirroring how `optimisticAdvance` already finds
// "the trailing unresolved gate" by scanning rather than tracking an id.
function findOpenAskIdx(items: LiveThreadItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === 'qa' && !it.done) return i;
  }
  return -1;
}

let _pendingAskText = '';
let _askRaf: number | null = null;

export function flushPendingAsk(): void {
  if (_askRaf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_askRaf);
  _askRaf = null;
  if (!_pendingAskText) return;
  const items = thread.value.slice();
  const idx = findOpenAskIdx(items);
  if (idx === -1) {
    _pendingAskText = '';
    return;
  }
  const qa = items[idx] as LiveThreadItem & { kind: 'qa' };
  items[idx] = { ...qa, answer: qa.answer + _pendingAskText };
  _pendingAskText = '';
  thread.value = items;
}

export function applyAskAnswer(text: string): void {
  _pendingAskText += text;
  if (typeof requestAnimationFrame === 'function') {
    if (_askRaf == null) _askRaf = requestAnimationFrame(flushPendingAsk);
  } else {
    flushPendingAsk();
  }
}

/** Render the layer-2 anomaly report (FIX-M: one or more files, not just the phase's own artifact) as
 *  a single `<c>mono</c>`-chip-bearing message for the reused ConfirmModal (D3 layer 2). */
export function describeAnomalyFiles(files: AskAnomalyFile[]): string {
  const KIND_WORD: Record<AskAnomalyFile['kind'], string> = {
    modified: tr('askAnomalyKindModified'),
    created: tr('askAnomalyKindCreated'),
    deleted: tr('askAnomalyKindDeleted'),
  };
  // review #4: a file the backend could NOT revert is flagged distinctly so a partial restore is visible.
  return files
    .map((f) => `<c>${f.path}</c> (${f.restoreFailed ? tr('askAnomalyRestoreFailed') : KIND_WORD[f.kind]})`)
    .join(', ');
}

export function applyAskDone(d: { ok: boolean; anomaly?: { files: AskAnomalyFile[] }; seededFrom?: string[] }): void {
  flushPendingAsk(); // land any trailing buffered fragment before finalizing (mirrors applyTask's rule)
  asking.value = false;
  const items = thread.value.slice();
  const idx = findOpenAskIdx(items);
  if (idx !== -1) {
    // spec 034 §2: fold `seededFrom` onto the qa item so QaAnswer can caption a ④/terminal answer with
    // the sources it was assembled from (absent → a 033 phase Ask, no caption).
    const qa = items[idx] as LiveThreadItem & { kind: 'qa' };
    items[idx] = { ...qa, done: true, ...(d.seededFrom && d.seededFrom.length > 0 ? { seededFrom: d.seededFrom } : {}) };
  }
  thread.value = items;
  // D3 layer 2 (FIX-M): layer 1 should make this unreachable — surface it verbatim via the EXISTING
  // ConfirmModal/askConfirm pattern (no new dialog component). Both buttons dismiss identically (D1):
  // there is no "keep this change" affordance — the restore already happened before this notice shows.
  if (!d.ok && d.anomaly && d.anomaly.files.length > 0) {
    void askConfirm({
      title: tr('askAnomalyTitle'),
      message: tf('askAnomalyMsg', { files: describeAnomalyFiles(d.anomaly.files) }),
      okLabel: tr('askAnomalyOk'),
      cancelLabel: tr('askAnomalyOk'),
    });
  }
}

// ───────────────────────────── thread persistence (client-side; D6-safe) ─────────────────────────────
// Persist the chat thread to localStorage so a HARD reload keeps the Q&A conversation (a soft SSE
// reconnect already preserves the in-memory thread). Client-only — no backend transcript, so 033 D6
// holds. Best-effort: every access is try/catch-guarded; slim/reconcile logic lives in thread-persist.ts.
const THREAD_KEY = (id: string): string => `builder.thread.${id}`;
const THREAD_INDEX = 'builder.thread.index';
const THREAD_MAX = 20; // LRU cap across builds
const LAST_TASK_KEY = 'builder.lastTask'; // spec 040 D3: the build under view, reopened on a hard reload
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _lastPersisted = ''; // dedupe: skip a write when the slim serialization is unchanged (stream churn)

function threadIndex(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(THREAD_INDEX) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

/** Write the current thread for the open task (deduped + LRU-bounded). Best-effort — quota/private-mode safe. */
function persistThreadNow(): void {
  const t = task.value;
  if (!t) return;
  try {
    const json = serializeThread(thread.value);
    if (json === _lastPersisted) return; // unchanged slim payload (e.g. run-output-only churn) → skip
    _lastPersisted = json;
    localStorage.setItem(THREAD_KEY(t.taskId), json);
    const idx = threadIndex().filter((x) => x !== t.taskId);
    idx.push(t.taskId);
    while (idx.length > THREAD_MAX) {
      const evict = idx.shift();
      if (evict) localStorage.removeItem(THREAD_KEY(evict));
    }
    localStorage.setItem(THREAD_INDEX, JSON.stringify(idx));
  } catch {
    /* storage disabled / quota exceeded — persistence is best-effort, never blocks the UI */
  }
}

/** Restore + reconcile a persisted thread for reopening `taskId`, or null if none/corrupt. */
function loadPersistedThread(taskId: string): LiveThreadItem[] | null {
  try {
    const items = parseThread(localStorage.getItem(THREAD_KEY(taskId)));
    return items ? hydrateForReopen(items) : null;
  } catch {
    return null;
  }
}

// Debounced write on any thread/task change (coalesces the qa-answer streaming churn to ~1 write/settle).
if (typeof localStorage !== 'undefined') {
  effect(() => {
    void thread.value;
    void task.value; // subscribe to both
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(persistThreadNow, 500);
  });

  void restoreLastTask();
}

/**
 * spec 040 D3 — reopen the build under view after a hard reload. Pre-CHECK existence via getTask so a
 * stale/deleted id degrades SILENTLY to the empty view — calling openTask() directly would run its own
 * `catch → surfaceError`, flashing an error banner on every load. openTask then restores the persisted
 * thread + re-subscribes SSE (a still-running build resumes live). Exported for the store unit test.
 */
export async function restoreLastTask(): Promise<void> {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_TASK_KEY);
  } catch {
    return;
  }
  if (!last) return;
  try {
    await api.getTask(last); // exists? (throws on 404) — only THEN reopen, so a missing build is silent
    await openTask(last);
  } catch {
    try {
      localStorage.removeItem(LAST_TASK_KEY);
    } catch {
      /* ignore */
    }
  }
}

// ───────────────────────────── SSE lifecycle ─────────────────────────────
let teardown: (() => void) | null = null;

function openStream(taskId: string): void {
  // spec 040 D3: remember the build under view so a hard reload can reopen it. Written at the ONE choke
  // point both entry paths (start / openTask) share; cleared in resetToNew. Guarded for no-localStorage envs.
  try {
    localStorage.setItem(LAST_TASK_KEY, taskId);
  } catch {
    /* ignore */
  }
  teardown?.();
  teardown = connectSSE(taskId, {
    // On (re)connect, re-fetch the authoritative state so a missed gate is restored (AC #22).
    onInit: () => {
      // spec 033 FIX-H reconnect guard: a reconnect that spans an Ask's `ask:done` would DROP it (the
      // client's waitingForInit guard suppresses replayed events until init, and onAskDone honors it), so
      // `asking` could stick true forever → the docked bar + composer stay disabled with no recovery. On
      // every (re)connect, finalize any still-open qa item + clear `asking` (idempotent no-op on the very
      // first connect, when nothing is open). A still-running turn's post-init live events are unaffected.
      if (asking.value || findOpenAskIdx(thread.value) !== -1) applyAskDone({ ok: true });
      void api.getTask(taskId).then(applyTask).catch(() => {});
    },
    onTaskUpdate: applyTask,
    onPhaseOutput: (d) => applyOutput(d.phase, d.text),
    onAskAnswer: (d) => applyAskAnswer(d.text),
    onAskDone: (d) => applyAskDone(d),
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

/** Map a createProject failure to the modal's inline-error shape (spec 031 D3/D4). A 409 carries the
 *  existing slug so the modal can offer an [Open] jump; any other error is a plain message. */
export function mapCreateError(e: unknown): { error: string; existing?: string } {
  if (e instanceof ApiError) {
    return { error: e.message, ...(e.status === 409 && e.existing ? { existing: e.existing } : {}) };
  }
  return { error: String(e) };
}

/** spec 031 D5: create an empty project by name, refresh the tree (it now shows), and pre-target it so
 *  the next from-scratch build lands inside `projects/<slug>/`. Reuses 029's `targetProject`. On failure
 *  the settings are left untouched and the error shape is returned for the modal to render inline. */
export async function createProject(
  name: string
): Promise<{ project: string } | { error: string; existing?: string }> {
  try {
    const r = await api.createProject(name);
    await loadTree(); // the empty project is now visible in the sidebar (buildTree emits it)
    settings.value = { ...settings.value, targetProject: r.project, workflow: 'none', seed: null };
    return { project: r.project };
  } catch (e) {
    return mapCreateError(e);
  }
}

/** spec 051 D5: import a standalone YAML as a local edit-existing base. On success, refresh the tree
 *  FIRST (so the new workflow row exists before it is selected — the createProject precedent), then
 *  return the resolved `{ project, workflow, slugNote? }` so the caller can auto-select it via
 *  `newTask({ baseWorkflow })`. On failure the error shape is returned for the modal to render inline
 *  (a 400 carries the linter's verbatim message; a size/extension reject its own). */
export async function importBase(
  body: { yaml: string; name?: string; project?: string; fileName?: string }
): Promise<{ project: string; workflow: string; slugNote?: string; probeNote?: string } | { error: string }> {
  try {
    const r = await api.importBase(body);
    await loadTree(); // the new base is now visible in the sidebar + the ワークフロー selector
    return r;
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : String(e) };
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

/** spec 030: parse the Workflow run-setting into an edit-existing target. 'none'/'' → null (from-scratch);
 *  a compound `project/workflow` → `{ project, workflow }`; a bare legacy value → workflow-only (project
 *  falls back to the sidebar target / `_drafts`). Exported for the store unit tests. */
export function splitWorkflowSetting(workflow: string | null | undefined): { project?: string; workflow: string } | null {
  if (!workflow || workflow === 'none') return null;
  const slash = workflow.indexOf('/');
  if (slash === -1) return { workflow };
  return { project: workflow.slice(0, slash), workflow: workflow.slice(slash + 1) };
}

/** Start a new build from the composer (AC #14 settings feed the body; turn-collision 409 → startError
 *  + busyHolder, AC #21). A parked build no longer blocks — only a running turn does. */
export async function start(requirement: string, files?: Attachment[]): Promise<boolean> {
  clearErrors();
  _lastPersisted = ''; // fresh build — reset the persistence dedupe so the new task.json persists cleanly
  const s = settings.value;
  thread.value = [{ id: uid(), kind: 'user', text: requirement }];
  task.value = null;
  // spec 030: the Workflow setting is either 'none' or a COMPOUND `project/workflow` (the composer
  // dropdown / sidebar workflow-"+" both use it). Split it into the bare workflow + its parent project.
  const editing = splitWorkflowSetting(s.workflow);
  // The target PROJECT folder: an edit-existing build uses the edited workflow's project; a from-scratch
  // build uses the sidebar project-"+" target (`targetProject`). null ⇒ the backend resolves `_drafts` (D5).
  const project = editing?.project ?? s.targetProject ?? null;
  try {
    const t = await api.createTask({
      requirement,
      workflow: editing?.workflow ?? null,
      confirm_mode: confirmModeWire(s.confirm),
      seed: s.seed,
      // spec 028: fast build is from-scratch single-LLM only — send it only when no seed/workflow is
      // chosen (the backend force-offs it regardless; this keeps the wire honest). Slug is proposed by
      // the build, not set here, so no slug guard is needed at this seam.
      ...(s.fast && !s.seed && !editing ? { fast_mode: true } : {}),
      // spec 036: `deploy`/`test_mode` are NO LONGER sent — createTask defaults deploy:'none',
      // testMode:'static'; both are stamped at gate-time (test_live dispatch / static→Import park / the
      // done-state live action) from what creds are reachable, not declared here.
      ...(project ? { project } : {}),
      ...(files && files.length ? { files } : {}),
    });
    applyTask(t);
    openStream(t.taskId);
    void loadTree();
    void loadActive();
    return true; // spec 040 D2: signal success so the composer clears (a 409 returns false → draft kept)
  } catch (e) {
    surfaceError(e);
    return false;
  }
}

/** spec 052 — start a "Promote to pattern" build from a resolved on-disk workflow (the header pill). Opens
 *  the promote build in the conversation view exactly like `start` (applyTask + SSE), so its B1/distill/
 *  review gates render in the thread. A 400/404 (bad source) surfaces via the shared error banner. */
export async function promote(project: string, workflow: string): Promise<boolean> {
  clearErrors();
  try {
    // POST FIRST — a 400/404 (ineligible / bad source) must NOT wipe the current build's view (the pill is
    // clicked from a done conversation view, not only the empty surface — unlike `start`). Reset + open the
    // promote build only once the backend accepted it.
    const t = await api.promote({ project, workflow });
    _lastPersisted = '';
    thread.value = [{ id: uid(), kind: 'user', text: tf('promoteThreadOpen', { project, workflow }) }];
    task.value = null;
    applyTask(t);
    openStream(t.taskId);
    void loadTree();
    void loadActive();
    return true;
  } catch (e) {
    surfaceError(e);
    return false;
  }
}

/** Confirm a gate action (kind:'confirm'). Slug/name carried at the Spec gate (AC #18); spec 036
 *  `keepCurrent` carried on a `cleanup_apps` delete (delete only OLD test apps vs all). */
export async function confirm(action: WireGateAction, extra?: { slug?: string; name?: string; keepCurrent?: boolean }): Promise<void> {
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
export async function reply(text: string, label?: string, files?: Attachment[]): Promise<boolean> {
  const t = task.value;
  if (!t || !text.trim()) return false;
  const items = thread.value.slice();
  items.push({ id: uid(), kind: 'user', text: text.trim() });
  thread.value = items;
  try {
    // Optimistic: close the gate; SSE re-opens the current phase as a fresh run (no duplicate).
    optimisticAdvance(await api.reply(t.taskId, text.trim(), files), label ?? 'Requested changes');
    void loadActive();
    return true; // spec 040 D2
  } catch (e) {
    surfaceError(e);
    return false;
  }
}

/**
 * spec 033 — a conversational Ask at a parked gate (chat, no phase re-run, answer-only). Pushes the
 * question as a plain user item + a fresh `{kind:'qa'}` item locally (optimistic), sets `asking` true
 * synchronously (before the POST even resolves — D3/§1: the response carries no status/gate snapshot to
 * key off), then relies entirely on the `ask:answer`/`ask:done` SSE events (§2) to stream + finalize it.
 */
export async function ask(text: string): Promise<boolean> {
  const t = task.value;
  if (!t || !text.trim()) return false;
  // FIX-C/H defense-in-depth: never open a 2nd qa item while one is already in flight. The composer is
  // disabled during a live Ask (App: disabled={asking}), so this is belt-and-suspenders — but it also
  // guarantees the single-open-qa invariant `findOpenAskIdx` relies on, regardless of how ask() is
  // reached. A concurrent Ask would 409 on the global turn lock anyway.
  if (asking.value) return false;
  const items = thread.value.slice();
  items.push({ id: uid(), kind: 'user', text: text.trim() });
  const qaId = uid();
  items.push({ id: qaId, kind: 'qa', question: text.trim(), answer: '', done: false });
  thread.value = items;
  asking.value = true;
  try {
    await api.ask(t.taskId, text.trim());
    return true; // spec 040 D2
  } catch (e) {
    // The POST itself failed (400/409/500) — no turn was ever dispatched, so no ask:done will ever
    // arrive to settle this. Finalize the qa item locally with the error, matching surfaceError's shape.
    asking.value = false;
    const cur = thread.value.slice();
    const idx = cur.findIndex((it) => it.id === qaId);
    if (idx !== -1) {
      cur[idx] = { ...(cur[idx] as LiveThreadItem & { kind: 'qa' }), answer: String(e instanceof Error ? e.message : e), done: true };
      thread.value = cur;
    }
    surfaceError(e);
    return false;
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

/** spec 036 D5: run a live workflow test from a terminal `done` autonomous build (the done-state "Run
 *  test with workflow" foot — its only live path). Optimistically resolves the done gate (the button
 *  disappears, `busy` flips) with the action label; SSE then carries done→running→test_result→done. A
 *  409 (the gate no longer holds — creds gone, or a turn is running) surfaces via the shared error banner. */
export async function liveTest(): Promise<void> {
  const t = task.value;
  if (!t) return;
  // Discoverability change: the "Run test with workflow" foot is always shown for a done autonomous build
  // (gate-foot.ts no longer gates it on self-host creds), so the self-host target is validated HERE, on
  // click. No creds → a specific, localized message telling the user to configure the self-host URL + key,
  // instead of firing a request the server would 409 with a generic error. The server still re-guards.
  if (!t.liveTargets?.selfhost) {
    busyHolder.value = null;
    startError.value = tr('liveTestNeedsSelfhost');
    return;
  }
  try {
    // The POST returns a running(④) snapshot; optimisticAdvance marks the trailing (done) gate resolved
    // WITHOUT pushing a run item — the authoritative SSE task:update opens the correct "Running ④ Test".
    optimisticAdvance(await api.liveTest(t.taskId), tr('runTestWithWorkflow'));
    void loadActive();
  } catch (e) {
    surfaceError(e);
  }
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

/**
 * On-demand artifact enrichment for the OPEN task: re-read its SPEC.md / main.yml / report / diff from
 * disk (`GET /api/tasks/:id` returns them fresh via readArtifactContents). WHY this exists: in `auto`
 * confirm-mode the Spec gate is auto-confirmed, so the client never hits the gate branch that inlines
 * SPEC.md — the panel then shows "No SPEC.md yet" during Implement even though the file is already on
 * disk. The panel calls this when it opens so the contents are pulled regardless of whether a gate
 * re-fetch ever fired. applyTask's rev-guard keeps it safe: a fresh GET applies fully; a stale one only
 * GRAFTS the missing artifact contents (never phase/gate). Best-effort — a failure leaves the panel as-is.
 */
export async function refreshArtifacts(): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    applyTask(await api.getTask(t.taskId));
  } catch {
    /* enrichment is best-effort — the panel keeps whatever it has */
  }
}

/** Open the OS file manager (Finder) at the task's workflow YAML file. Fire-and-forget; a failure
 *  (file not scaffolded yet, launcher error) surfaces via the shared error banner. */
export async function revealWorkflow(taskId: string): Promise<void> {
  try {
    await api.reveal(taskId);
  } catch (e) {
    surfaceError(e);
  }
}

/** Open an existing task from the sidebar: load state + stream it (history isn't persisted, so the
 *  thread starts from the requirement + current gate/run). */
export async function openTask(taskId: string): Promise<void> {
  clearErrors();
  // spec 033 FIX-I: a live Ask belongs to the PREVIOUS task's stream — switching tasks must not leave
  // the new view's composer stuck "disabled".
  asking.value = false;
  _lastPersisted = ''; // task switch — force a re-persist for the newly-opened build (dedupe reset)
  try {
    const t = await api.getTask(taskId);
    // Restore the client-side conversation (Q&A + resolved history) if we persisted it across a reload
    // (D6-safe — client-only). hydrateForReopen already dropped any stale unresolved gate, so the ONE
    // live gate comes fresh + authoritative from applyTask below — no phantom buttons for a phase the
    // build advanced past while the tab was closed.
    const restored = loadPersistedThread(taskId);
    thread.value = restored ?? [{ id: uid(), kind: 'user', text: t.requirement }];
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
  // spec 040 D3: the empty/new-task surface has no build under view — forget the persisted one.
  try {
    localStorage.removeItem(LAST_TASK_KEY);
  } catch {
    /* ignore */
  }
  task.value = null;
  thread.value = [];
  // spec 033 FIX-I: same reset as openTask — a new/empty view must never inherit a stuck `asking`.
  asking.value = false;
  // C2 (spec 019): also clear the reconnect rev-guard. Without this, `_appliedTaskId`/`_appliedRev`
  // survive the reset, so re-opening a build whose persisted `rev` is ≤ the last-applied rev is dropped
  // by `isFreshSnapshot` in `applyTask` → `task.value` stays null and the thread shows only the user
  // line (a blank thread). Resetting to the initial sentinels makes the next `applyTask` always apply.
  _appliedTaskId = null;
  _appliedRev = -1;
  // A new task starts from scratch: clear the "base on existing workflow / seed app" selectors so the
  // prior build's choice doesn't silently carry over (it's start-bound, and the dropdown's `none` reset
  // can be hard to reach). Fast build (spec 028) is likewise a per-build shape assertion — reset it so a
  // trivial build's `⚡` doesn't silently carry into a possibly non-trivial next one. targetProject (spec
  // 030) is a per-build target project folder — reset it too so a stale one can't survive "New task". The
  // "+"-launched non-clobber is achieved by App.newTask re-applying opts AFTER this reset, not by making
  // this conditional. Confirm-mode is a general preference and intentionally persists. (spec 036: deploy
  // is no longer a setting — it is decided at the test gate from reachable creds.)
  settings.value = { ...settings.value, workflow: 'none', seed: null, fast: false, targetProject: null };
  clearErrors();
  connected.value = false;
}

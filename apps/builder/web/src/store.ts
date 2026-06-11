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
import { api, confirmModeWire, ApiError } from './api';
import { connectSSE } from './sse-client';
import type {
  WireTask,
  WireTreeProject,
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
  | { id: string; kind: 'run'; phase: WirePhase; running: boolean; output: string }
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
/** A "build already running" (409) or other start error to surface in the UI (AC #21). */
export const startError = signal<string | null>(null);
export const settings = signal<RunSettings>({ workflow: 'none', confirm: 'each step', deploy: 'none', seed: null });

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

/** Apply an authoritative task snapshot: set the signal, then extend the chat thread on transition. */
function applyTask(t: WireTask): void {
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
    if (last && last.kind === 'run' && last.running) items[items.length - 1] = { ...last, running: false };
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

function applyOutput(phase: string, text: string): void {
  const items = thread.value.slice();
  const last = items[items.length - 1];
  if (last && last.kind === 'run' && last.running && last.phase === phase) {
    items[items.length - 1] = { ...last, output: last.output + text };
    thread.value = items;
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
export async function loadTree(): Promise<void> {
  try {
    tree.value = (await api.tree()).projects;
  } catch {
    /* tree is best-effort */
  }
}

export async function loadSeeds(): Promise<void> {
  try {
    seeds.value = (await api.seeds()).seeds;
  } catch {
    seeds.value = [];
  }
}

/** Start a new build from the composer (AC #14 settings feed the body; 409 → startError, AC #21). */
export async function start(requirement: string): Promise<void> {
  startError.value = null;
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
    });
    applyTask(t);
    openStream(t.taskId);
    void loadTree();
  } catch (e) {
    startError.value = e instanceof ApiError ? e.message : String(e);
  }
}

/** Confirm a gate action (kind:'confirm'). Slug/name carried at the Spec gate (AC #18). */
export async function confirm(action: WireGateAction, extra?: { slug?: string; name?: string }): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    // Optimistic: close the gate; SSE opens the next-phase run item (no duplicate "Running").
    optimisticAdvance(await api.confirm(t.taskId, action.id, extra), action.label);
  } catch (e) {
    startError.value = e instanceof ApiError ? e.message : String(e);
  }
}

/** Within-phase change request (kind:'reply') or Retry-out-of-error. */
export async function reply(text: string): Promise<void> {
  const t = task.value;
  if (!t || !text.trim()) return;
  const items = thread.value.slice();
  items.push({ id: uid(), kind: 'user', text: text.trim() });
  thread.value = items;
  try {
    // Optimistic: close the gate; SSE re-opens the current phase as a fresh run (no duplicate).
    optimisticAdvance(await api.reply(t.taskId, text.trim()), 'Requested changes');
  } catch (e) {
    startError.value = e instanceof ApiError ? e.message : String(e);
  }
}

/** Abandon the build (kind:'cancel'). */
export async function cancel(): Promise<void> {
  const t = task.value;
  if (!t) return;
  try {
    applyTask(await api.cancel(t.taskId));
  } catch (e) {
    startError.value = e instanceof ApiError ? e.message : String(e);
  }
  void loadTree();
}

/** Save an in-place SPEC.md edit (AC #3). */
export async function saveSpec(content: string): Promise<void> {
  const t = task.value;
  if (!t) return;
  await api.putSpec(t.taskId, content);
}

/** Open an existing task from the sidebar: load state + stream it (history isn't persisted, so the
 *  thread starts from the requirement + current gate/run). */
export async function openTask(taskId: string): Promise<void> {
  startError.value = null;
  try {
    const t = await api.getTask(taskId);
    thread.value = [{ id: uid(), kind: 'user', text: t.requirement }];
    task.value = null;
    applyTask(t);
    openStream(taskId);
  } catch (e) {
    startError.value = e instanceof ApiError ? e.message : String(e);
  }
}

/** Reset to the empty/new-task surface (keeps the stream torn down). */
export function resetToNew(): void {
  teardown?.();
  teardown = null;
  task.value = null;
  thread.value = [];
  startError.value = null;
  connected.value = false;
}

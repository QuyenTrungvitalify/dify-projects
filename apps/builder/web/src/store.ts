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
import { recoverOpenAsk } from './lib/ask-recovery';
import { connectSSE, type AskAnomalyFile } from './sse-client';
import { t as tr, tf } from './lib/i18n';
import { notifyTransition, notifyAskDone, maybeNudge } from './lib/notify';
import type {
  WireTask,
  WireArtifacts,
  WireTreeProject,
  WireTreeTask,
  WirePhase,
  WireStatus,
  WireGate,
  WirePromoteShare,
  WirePhaseCost,
  Seed,
  WireGateAction,
} from './types';

let _uid = 0;
const uid = (): string => 'i' + ++_uid;

/** Composer attachments → the slim history shape (drops nothing the bubble needs; see ThreadAttachment). */
const attsOf = (files?: Attachment[]): ThreadAttachment[] | undefined =>
  files && files.length ? files.map((f) => ({ name: f.name, mime: f.mime, dataUrl: f.dataUrl })) : undefined;

/** Stamp the server-side indices (`uploads`, echoed by the POST) onto the user bubble we pushed
 *  optimistically — that is what makes the files survive a reload. A no-op when the message carried no
 *  files or the item is gone (e.g. the thread was replaced by a task switch mid-POST). */
function stampUploads(itemId: string, uploads?: number[]): void {
  if (!uploads || !uploads.length) return;
  const cur = thread.value.slice();
  const i = cur.findIndex((it) => it.id === itemId);
  if (i === -1) return;
  const it = cur[i];
  if (it.kind !== 'user' || !it.atts) return;
  cur[i] = { ...it, atts: it.atts.map((a, n) => (uploads[n] === undefined ? a : { ...a, idx: uploads[n] })) };
  thread.value = cur;
}

export type UiPhaseState = 'pending' | 'running' | 'awaiting' | 'done' | 'error';
const PHASE_ORDER: WirePhase[] = ['analyze', 'spec', 'implement', 'test'];

/** Live chat-thread items, built client-side from SSE transitions (the backend stores no chat log). */
/** One file the user attached to a message, as the HISTORY needs it (the chat used to forget them the
 *  moment the message was sent). Two ways to show the same file, and both are needed:
 *   - `dataUrl` — the composer's in-memory copy, so the bubble renders the thumbnail INSTANTLY on send,
 *     before the POST even answers. Stripped when the thread is persisted (one screenshot as base64
 *     would eat the ~5MB localStorage quota on its own).
 *   - `idx` — where the server put it (`task.attachments[idx]`, echoed back as `uploads`), addressable
 *     as `GET /api/tasks/:id/uploads/:idx`. This is what SURVIVES a reload, so the reopened build still
 *     shows the files it was given. */
export interface ThreadAttachment {
  name: string;
  mime: string;
  dataUrl?: string;
  idx?: number;
}

export type LiveThreadItem =
  | { id: string; kind: 'user'; text: string; atts?: ThreadAttachment[] }
  /** `cost` is the DEV read-out for THIS run: what the turn(s) behind this one disclosure cost. Summed
   *  across attempts, because a run that failed and retried cost you both — see `applyPhaseCost`. */
  | { id: string; kind: 'run'; phase: WirePhase; running: boolean; output: string; stopped?: boolean; cost?: WirePhaseCost }
  | { id: string; kind: 'gate'; phase: WirePhase; snapshot: WireTask; resolved?: string }
  /** spec 033: a conversational Ask exchange — message↔message, never re-runs the phase. `done` flips
   *  once the backend's `ask:done` settles (streaming stops; the "Answered" chrome renders).
   *  spec 034 §2: `seededFrom` (④/terminal Ask only) lists the sources folded into the fresh seed so a
   *  possibly-incomplete answer is visible rather than silently trusted; absent on a 033 phase Ask. */
  /** `cost` is the DEV read-out (model/tokens/duration of the turn that answered), folded on at settle
   *  from `ask:done`. It rides along into localStorage with the rest of the qa item and is restored on a
   *  hard reload. It also rides the server transcript (`chat.jsonl`), which is what a CONSULT rebuilds
   *  from — that rebuild wins over localStorage, so without the disk copy a chat lost its tip on every
   *  reload while a build kept it. It is NOT written to `task.json`: an ask has no phase slot, and a
   *  per-message number in the build's cost table would read as a phase's. */
  | { id: string; kind: 'qa'; question: string; answer: string; done: boolean; seededFrom?: string[]; cost?: WirePhaseCost; sessionReset?: boolean }
  /** spec 082 S3: a YAML report card — the no-LLM machine checks on a consult-attached .yml (lint /
   *  preflight / source-contract; `note` names any tool that could not run — never silently clean). */
  | { id: string; kind: 'card'; file: string; lint: string[]; preflight?: string; contract?: string; note?: string };

/** Run-settings shown below the input (AC #14): Workflow · Confirm · Fast build (spec 036 dropped
 *  Deploy + Test — deploy/testMode are decided at the test gate from reachable creds, not start-bound). */
export interface RunSettings {
  workflow: string; // 'none' = new workflow
  confirm: string; // 'each step' | 'spec only' | 'auto'
  seed: string | null; // selected seed id (degrades to none until Lát 5)
  fast: boolean; // spec 028: ⚡ Fast build (merge Analyze+Spec); backend force-offs it on seed/workflow/slug
  targetProject: string | null; // spec 030: the target PROJECT folder — the sidebar project-"+" folder, OR the parent project of a workflow-"+" edit. The build lands in projects/<targetProject>/.
  /** spec 082 §4.5: the composer's entry mode — 'consult' (chat-first, the default per the user's call)
   *  vs 'build' (the ①②③④ pipeline as today). Entry-only: inside a task the kind is fixed. Remembered
   *  across reloads (localStorage) so a build-heavy user isn't re-flipping it every time. */
  mode: 'consult' | 'build';
  /** spec 096: which model every turn of the task spawns with, as a CLI family alias. The alias (not a
   *  pinned id) is deliberate — `claude --model opus` means "the newest Opus this environment can
   *  reach", so the list never goes stale behind a release. START-BOUND per task like `fast`/`workflow`:
   *  picked with the first message, then fixed, so all four phases are the same bet. Remembered across
   *  reloads, because a team that wants Opus wants it every time. */
  model: string;
  /** The language the MODEL replies in — 'auto' (infer from what the user writes), 'vi', or 'ja'.
   *  Sent with every new task/chat and remembered across reloads: the team is Vietnamese, so picking
   *  `vi` once must hold forever. NOT the same as i18n's `lang` (the UI chrome's language), and NOT a
   *  composer chip — it lives on the header beside the 🌐/theme pills. */
  chatLang: ChatLang;
}

/** 'auto' | 'vi' | 'ja' — mirrors the server's `ChatLang` (server/lib/language.ts). */
export type ChatLang = 'auto' | 'vi' | 'ja';

/** Endonyms — a language's own name reads the same whatever the UI chrome is set to, so these are NOT
 *  i18n keys. 'auto' has no endonym; it renders from a translated label instead. */
export const CHAT_LANG_NAME: Record<ChatLang, string> = { auto: '', vi: 'Tiếng Việt', ja: '日本語' };

/** The header pill cycles through the three values in this order. */
export function nextChatLang(cur: ChatLang): ChatLang {
  return cur === 'auto' ? 'vi' : cur === 'vi' ? 'ja' : 'auto';
}

/** Attach the chat-language setting to an outgoing create-a-task body. Omitted while 'auto', so a user
 *  who never picks a language sends the exact same request they always did (the server reads a missing
 *  field as 'auto'). Every door that mints a task goes through here — build, chat, and distill. */
function withChatLang<T extends object>(body: T): T & { chat_lang?: string } {
  const l = settings.value.chatLang;
  return l === 'auto' ? body : { ...body, chat_lang: l };
}

/** spec 096 — the offered models, newest-capability first; MUST mirror the server's MODEL_CHOICES
 *  (state/task.ts), which is where an unknown value is dropped. `opus` leads because ③ Implement is
 *  where the graph, the cost and the risk are. */
export const MODEL_OPTIONS = ['opus', 'sonnet', 'haiku', 'fable'] as const;
const MODEL_KEY = 'builder.model';
function initialModel(): string {
  try {
    const saved = localStorage.getItem(MODEL_KEY);
    return (MODEL_OPTIONS as readonly string[]).includes(saved ?? '') ? saved! : MODEL_OPTIONS[0];
  } catch {
    return MODEL_OPTIONS[0];
  }
}
export function rememberModel(model: string): void {
  try {
    localStorage.setItem(MODEL_KEY, model);
  } catch {
    /* private mode / quota — the in-memory signal still holds for this session */
  }
}
/** spec 096: ride the same seam as withChatLang — one place, so a new create path cannot forget it. */
function withModel<T extends object>(body: T): T & { model?: string } {
  const m = settings.value.model;
  return m ? { ...body, model: m } : body;
}

/** spec 082: the remembered composer mode (best-effort localStorage; default 'consult' — user's call). */
const MODE_KEY = 'builder.composerMode';
function initialMode(): RunSettings['mode'] {
  try {
    return localStorage.getItem(MODE_KEY) === 'build' ? 'build' : 'consult';
  } catch {
    return 'consult';
  }
}
export function rememberMode(mode: RunSettings['mode']): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode / quota — the default just reapplies next load */
  }
}

/** The remembered chat language (same best-effort localStorage pattern as the mode above). Default
 *  'auto' — nobody's behavior changes until they pick a language. */
const CHAT_LANG_KEY = 'builder.chatLang';
function initialChatLang(): ChatLang {
  try {
    const saved = localStorage.getItem(CHAT_LANG_KEY);
    return saved === 'vi' || saved === 'ja' ? saved : 'auto';
  } catch {
    return 'auto';
  }
}
export function setChatLang(next: ChatLang): void {
  settings.value = { ...settings.value, chatLang: next };
  try {
    localStorage.setItem(CHAT_LANG_KEY, next);
  } catch {
    /* private mode / quota — the pick still holds for this session */
  }
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
export const settings = signal<RunSettings>({ workflow: 'none', confirm: 'each step', seed: null, fast: false, targetProject: null, mode: initialMode(), chatLang: initialChatLang(), model: initialModel() });
/** spec 082: the consult chats for the sidebar's own section (GET /api/consults, newest first). */
export const consults = signal<WireTreeTask[]>([]);
/** spec 084 S1.5: the distill/promote tasks for the sidebar's own "蒸留" section (GET /api/promotes,
 *  newest first) — ALL of them (incl. done/shared) as history; the tray only shows in-session ones. */
export const promotes = signal<WireTreeTask[]>([]);

// ───────────────────────────── spec 084: background distill tray ─────────────────────────────
/** spec 084 (DEV): when on, new distills are dispatched as `test` — a dry-run that never auto-finalizes
 *  (writes nothing to the shelf) and is clearable from the tray. A persisted switch in the ⚙ dev settings
 *  ("turn it on and every distill is a test"): survives reload via localStorage. */
const TEST_DISTILL_KEY = 'builder:testDistill';
function initTestMode(): boolean {
  try {
    return localStorage.getItem(TEST_DISTILL_KEY) === '1';
  } catch {
    return false;
  }
}
export const bgTestMode = signal<boolean>(initTestMode());
export function setBgTestMode(on: boolean): void {
  bgTestMode.value = on;
  try {
    localStorage.setItem(TEST_DISTILL_KEY, on ? '1' : '0');
  } catch {
    /* private mode / quota — the in-memory signal still applies for this session */
  }
}

/** The promote-request body a queued distill retries with (mirrors api.promote's two doors). */
export type BgDistillReq =
  | { project: string; workflow: string; test?: boolean }
  | { origin: 'paste'; yaml: string; sourceLabel?: string; license?: string; fileName?: string; test?: boolean };

/** One background distill in the corner tray (spec 084). It never hijacks `task.value`: promote/
 *  promoteExternalYaml push here and a POLL loop (§3 — SSE is single-stream) keeps it fresh. `status`
 *  adds a synthetic 'queued' for the single-write-lane wait (§2): a 409 at dispatch parks the request
 *  here and the poll retries it when the lane frees. */
export interface BgDistill {
  /** stable local key for rendering (survives queued→dispatched, before a taskId exists). */
  key: string;
  /** set once the backend minted the promote task; absent while `queued`. */
  taskId?: string;
  slug: string;
  status: WireStatus | 'queued';
  gate?: WireGate;
  /** the distilled pattern's output path (mini-summary), from promote.target/staged. */
  target?: string;
  /** spec 081 share state — present once the share turn ran; `pushed` hides [Undo] (§4 S2.3). */
  share?: WirePromoteShare;
  sourceKind: 'local' | 'external';
  /** the original request, replayed by the poll loop when a `queued` item's lane frees. */
  req: BgDistillReq;
  /** spec 084 (DEV): a test/dry-run distill — badged in the tray + wiped by clearTestDistills(). */
  test?: boolean;
}
export const bgDistills = signal<BgDistill[]>([]);

let _bgUid = 0;
const bgKey = (): string => 'bg' + ++_bgUid;

/** A bg distill is terminal when its promote task finished (done) or died (error/cancelled). A parked
 *  gate (awaiting_confirm — review/collision/distill_failed/share_offer) is NON-terminal: still pollable
 *  and actionable from the tray. */
export function isBgTerminal(b: BgDistill): boolean {
  return b.status === 'done' || b.status === 'error' || b.status === 'cancelled';
}

function upsertBg(key: string, patch: Partial<BgDistill>): void {
  bgDistills.value = bgDistills.value.map((b) => (b.key === key ? { ...b, ...patch } : b));
}
/** Remove a tray item (the [Close] on a terminal one, or a superseded queued entry). */
export function removeBg(key: string): void {
  bgDistills.value = bgDistills.value.filter((b) => b.key !== key);
}

/** Fold an authoritative promote task snapshot into its tray item (never touches `task.value`). */
function bgFieldsFromTask(t: WireTask, prevSlug: string): Partial<BgDistill> {
  return {
    taskId: t.taskId,
    slug: t.promote?.slug ?? prevSlug,
    status: t.status,
    gate: t.gate,
    target: t.promote?.target ?? t.promote?.staged,
    share: t.promote?.share,
    test: t.promote?.test, // authoritative: the backend only honors `test` under BUILDER_DEV
  };
}

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
  // spec 082: a consult's thread is driven ENTIRELY by the ask machinery (user/qa/card items) — never
  // by status transitions. Without this return, the born-`done` snapshot walks the gate branch below
  // and pushes a phantom resolved gate card ("Test passed") into a chat that has no gates.
  if (t.kind === 'consult') return;
  // spec 040 D4: on a real status transition (running→gate arrives via SSE with no user action; or
  // →done/cancelled), refresh the sidebar list so its hint isn't stale and a finished build leaves it.
  // Gated on the change so it fires a handful of times per build, not on every streaming rev.
  if (prevStatus !== t.status) {
    void loadActive();
    // spec 088: badge the tab / fire a notification when a phase settles while the tab is hidden.
    // Guards (run-ish prev only, no cancelled, hidden-only) live in notify.ts.
    notifyTransition(prevStatus, t);
  }
  const items = thread.value.slice();
  const last = items[items.length - 1];

  if (coarse(t.status) === 'run') {
    // spec 088: a build is running — the moment notifications become valuable. Offer the
    // enable-notifications nudge (all show/suppress conditions live in notify.ts; cheap + idempotent).
    maybeNudge();
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

/**
 * Fold one ATTEMPT's cost onto the run item currently showing that phase.
 *
 * Targets the LAST run item of the phase — the same rule `phase:output` uses, so the number lands on the
 * same disclosure as the text it paid for. A `/reply` fix round opens its own run item (gate → running
 * pushes a new one), which is what makes per-round numbers possible at all.
 *
 * ACCUMULATES rather than replaces: one run item can span an error→retry, and both attempts were billed.
 * Showing only the retry would understate what the round cost — quietly, which is the worst way to be
 * wrong about money. Token/price/duration/turn fields add up; `model` takes the latest, since a run that
 * changed model mid-way is rare and the alternative (a list) is noise on a one-line meter.
 */
export function applyPhaseCost(phase: string, cost: WirePhaseCost): void {
  const items = thread.value.slice();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind !== 'run' || it.phase !== phase) continue;
    const prev = it.cost;
    const add = (a: number | undefined, b: number | undefined): number | undefined =>
      a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
    items[i] = {
      ...it,
      cost: prev
        ? {
            ...prev,
            ...cost,
            inputTokens: add(prev.inputTokens, cost.inputTokens),
            outputTokens: add(prev.outputTokens, cost.outputTokens),
            cacheReadTokens: add(prev.cacheReadTokens, cost.cacheReadTokens),
            cacheCreationTokens: add(prev.cacheCreationTokens, cost.cacheCreationTokens),
            totalCostUsd: add(prev.totalCostUsd, cost.totalCostUsd),
            numTurns: add(prev.numTurns, cost.numTurns),
            durationMs: add(prev.durationMs, cost.durationMs),
          }
        : cost,
    };
    thread.value = items;
    return;
  }
  // No run item yet (the cost arrived before `task:update` opened one) — dropping it is right: there is
  // nothing to attach it to, and inventing an item would put a meter under output nobody has seen.
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

/** Drop any buffered fragment WITHOUT landing it. Called when the view changes task (openTask /
 *  resetToNew): the buffer is module state, so a chunk that arrived within a frame of the switch would
 *  otherwise be flushed onto the NEXT task's open bubble — the previous task's words under this task's
 *  question. Also keeps a transcript-recovered answer (ask-recovery) from getting a stale tail appended
 *  by `applyAskDone`'s flush. */
export function resetAskBuffer(): void {
  if (_askRaf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(_askRaf);
  _askRaf = null;
  _pendingAskText = '';
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

/**
 * Whether a (re)connect must close a leftover open Q&A. Pure so the three cases stay pinned:
 *  - `reconnected` → FIX-H: the reconnect may have spanned the `ask:done`, so finalize (unchanged).
 *  - `turnRunning === false` → a fresh connect with nothing live: the answer died (server restart) or
 *    landed during the reload. Nothing will ever close it, and an open qa renders "Answering…" through
 *    every later reload.
 *  - `turnRunning === true` (or ABSENT, i.e. an older server) → leave it open. A live answer keeps
 *    streaming onto the restored item over this very connection, and closing it would discard the rest.
 *    The absent case deliberately falls back to the pre-existing reconnect-only behavior — an unknown
 *    is never treated as "not running".
 */
export function shouldSettleOpenAsk(d: { reconnected: boolean; turnRunning?: boolean }): boolean {
  return d.reconnected || d.turnRunning === false;
}

export function applyAskDone(d: {
  ok: boolean;
  anomaly?: { files: AskAnomalyFile[] };
  seededFrom?: string[];
  /** dev tip only — see the `cost` note on the qa thread item. */
  cost?: WirePhaseCost;
  /** this turn dropped its session history to keep the cost bounded (terminal ask only). */
  sessionReset?: boolean;
}): void {
  flushPendingAsk(); // land any trailing buffered fragment before finalizing (mirrors applyTask's rule)
  asking.value = false;
  notifyAskDone(task.value?.name ?? undefined); // spec 088: hidden-tab badge/notification (guards inside)
  const items = thread.value.slice();
  const idx = findOpenAskIdx(items);
  // spec 082 §4.4: an armed graduate captures the finished distill answer for the App's prefill.
  // Consumed exactly once; a failed distill (ok:false) disarms without prefilling garbage.
  if (_graduateArmed) {
    _graduateArmed = false;
    if (d.ok && idx !== -1) {
      const answer = (items[idx] as LiveThreadItem & { kind: 'qa' }).answer.trim();
      if (answer) graduateDraft.value = answer;
    }
  }
  if (idx !== -1) {
    // spec 034 §2: fold `seededFrom` onto the qa item so QaAnswer can caption a ④/terminal answer with
    // the sources it was assembled from (absent → a 033 phase Ask, no caption).
    const qa = items[idx] as LiveThreadItem & { kind: 'qa' };
    items[idx] = {
      ...qa,
      done: true,
      ...(d.seededFrom && d.seededFrom.length > 0 ? { seededFrom: d.seededFrom } : {}),
      ...(d.cost ? { cost: d.cost } : {}),
      ...(d.sessionReset ? { sessionReset: true } : {}),
    };
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
    if (json === _lastPersisted) return; // unchanged slim payload (re-render with no thread change) → skip
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

/** Flush the thread to localStorage RIGHT NOW: drain the rAF output buffer first, cancel the debounce,
 *  write synchronously. Two callers: (a) the unload path — during a streaming phase `thread.value`
 *  changes many times per second, so the 500ms debounce below is perpetually reset and NEVER fires
 *  (starvation); a mid-run reload then restored a thread from BEFORE the stream started, which read as
 *  "output lost on reload" even after the capped-persist fix. `localStorage.setItem` is synchronous, so
 *  a pagehide/beforeunload write is safe. (b) the max-wait tick below. Exported for the store unit test. */
export function persistThreadImmediately(): void {
  if (_persistTimer) {
    clearTimeout(_persistTimer);
    _persistTimer = null;
  }
  flushPendingOutput(); // land any buffered stream fragments on the run item BEFORE serializing
  persistThreadNow();
}

// Debounced write on any thread/task change (coalesces the qa-answer streaming churn to ~1 write/settle) —
// with a MAX-WAIT: continuous streaming resets the debounce forever, so if nothing has been written for
// PERSIST_MAX_WAIT_MS we persist immediately instead of re-arming. Keeps a crash/kill mid-stream from
// losing more than a few seconds; the unload listeners below make a normal reload lose nothing at all.
const PERSIST_MAX_WAIT_MS = 3_000;
let _lastPersistWriteAt = 0;
if (typeof localStorage !== 'undefined') {
  effect(() => {
    void thread.value;
    void task.value; // subscribe to both
    if (_persistTimer) clearTimeout(_persistTimer);
    if (Date.now() - _lastPersistWriteAt >= PERSIST_MAX_WAIT_MS) {
      _lastPersistWriteAt = Date.now();
      _persistTimer = setTimeout(persistThreadImmediately, 0); // out-of-effect: no signal writes inside effect
    } else {
      _persistTimer = setTimeout(() => {
        _lastPersistWriteAt = Date.now();
        persistThreadNow();
      }, 500);
    }
  });

  // A hard reload/close mid-stream must not lose the buffered output (see persistThreadImmediately).
  // `pagehide` is the reliable modern signal (fires on reload/close/bfcache); `beforeunload` is the
  // belt-and-braces fallback for older engines. Both write synchronously.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', persistThreadImmediately);
    window.addEventListener('beforeunload', persistThreadImmediately);
  }

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
    onInit: (d) => {
      // spec 033 FIX-H reconnect guard: a reconnect that spans an Ask's `ask:done` would DROP it (the
      // client's waitingForInit guard suppresses replayed events until init, and onAskDone honors it), so
      // `asking` could stick true forever → the docked bar + composer stay disabled with no recovery.
      // spec 082: gated on `reconnected` — startConsult legitimately arms an OPEN qa BEFORE the stream's
      // very first init (the first turn is dispatched by POST /api/consult itself), and the unguarded
      // finalize was closing it as an empty "Answered" + dropping the whole streamed answer. A true
      // reconnect still finalizes (FIX-H's actual target); the first connect never spans an ask:done.
      // A FRESH connect settles a leftover open qa too — but ONLY when the server reports no turn holds
      // this task (`turnRunning`). A hard reload restores the persisted thread with its open qa still open
      // (thread-persist decision #2), and that is correct while an answer is still streaming: this new
      // stream keeps delivering ask:answer/ask:done straight onto that item. When the turn is GONE,
      // though — the answer died with a server restart, or finished during the reload — nothing will ever
      // close it, and it rendered "Answering…" through every reload after, reading as a hung build.
      // `turnRunning` is the only honest discriminator: an Ask never changes `status`, so the two cases
      // are identical over GET /api/tasks/:id. Older servers omit the field → undefined → fresh connects
      // behave exactly as before (reconnect-only), never closing a live answer on a stale build.
      // Before settling an orphan, try to FINISH it from the backend transcript (`lastAsk`, recorded by
      // the server since the ask paths persist their answers). This is the whole point of that record: the
      // answer that streamed while the user was on another task is unrecoverable from the wire, so
      // without it this settle closed an empty bubble as a successful "Answered". `recoverOpenAsk` returns
      // null when it cannot honestly say anything (no record, or it belongs to a different question) —
      // then this behaves exactly as it did before. Its `ok` is authoritative where the old hardcoded
      // `true` was a guess: a real ok:false settle no longer reads as success.
      if (shouldSettleOpenAsk(d) && (asking.value || findOpenAskIdx(thread.value) !== -1)) {
        const rec = recoverOpenAsk(thread.value, task.value?.lastAsk);
        if (rec) thread.value = rec.items;
        applyAskDone({ ok: rec?.ok ?? true });
      }
      void api.getTask(taskId)
        .then((t) => {
          applyTask(t);
          // Second pass, for the AUTO-RECONNECT case only in practice: the settle above runs BEFORE this
          // authoritative snapshot exists, so on a reconnect `task.value` still predates the ask and
          // carried no `lastAsk` — the bubble closed empty and nothing would ever fill it. Now the record
          // is here, so complete the text of the bubble that just settled. Read from `t` rather than
          // `task.value`: applyTask's rev guard may drop a stale snapshot, but the transcript is the
          // server's truth either way. Same question match, same never-shorten rule; a no-op on every
          // normal connect (the client already has the full answer).
          const late = recoverOpenAsk(thread.value, t.lastAsk, true);
          if (late) thread.value = late.items;
        })
        .catch(() => {});
    },
    onTaskUpdate: applyTask,
    onPhaseOutput: (d) => applyOutput(d.phase, d.text),
    onPhaseCost: (d) => applyPhaseCost(d.phase, d.cost),
    onAskAnswer: (d) => applyAskAnswer(d.text),
    // spec 082 S3: insert the YAML report card BEFORE the open qa item (it was emitted before the turn
    // spawned, and should read that way — machine facts first, then the model's take).
    onAskCard: (card) => {
      const items = thread.value.slice();
      const idx = findOpenAskIdx(items);
      const item: LiveThreadItem = { id: uid(), kind: 'card', ...card };
      if (idx === -1) items.push(item);
      else items.splice(idx, 0, item);
      thread.value = items;
    },
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

/** spec 082: refresh the sidebar's consult list (best-effort, like loadActive). */
export async function loadConsults(): Promise<void> {
  try {
    consults.value = (await api.consults()).consults;
  } catch {
    /* consult list is best-effort */
  }
}

/** spec 084 S1.5: refresh the sidebar's "蒸留" section (the promote/distill task history). */
export async function loadPromotes(): Promise<void> {
  try {
    promotes.value = (await api.promotes()).promotes;
  } catch {
    /* promote list is best-effort */
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
  const userItemId = uid();
  thread.value = [{ id: userItemId, kind: 'user', text: requirement, atts: attsOf(files) }];
  task.value = null;
  // spec 030: the Workflow setting is either 'none' or a COMPOUND `project/workflow` (the composer
  // dropdown / sidebar workflow-"+" both use it). Split it into the bare workflow + its parent project.
  const editing = splitWorkflowSetting(s.workflow);
  // The target PROJECT folder: an edit-existing build uses the edited workflow's project; a from-scratch
  // build uses the sidebar project-"+" target (`targetProject`). null ⇒ the backend resolves `_drafts` (D5).
  const project = editing?.project ?? s.targetProject ?? null;
  try {
    const t = await api.createTask(withModel(withChatLang({
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
    })));
    stampUploads(userItemId, t.uploads); // the saved copies — what the history shows after a reload
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

/** spec 082 — start a consult chat from the composer's Trao đổi mode. Mirrors {@link start}: seeds the
 *  thread with the user bubble + an open qa item (the first answer streams over ask:answer exactly like
 *  an Ask), opens the task view + SSE. Runs on the backend's CHAT lane, so a running build never 409s it. */
export async function startConsult(text: string, files?: Attachment[]): Promise<boolean> {
  clearErrors();
  _lastPersisted = '';
  try {
    const t = await api.createConsult(withModel(withChatLang({ text, ...(files && files.length ? { files } : {}) })));
    thread.value = [
      // the POST already answered here, so the upload indices land straight on the bubble
      { id: uid(), kind: 'user', text, atts: attsOf(files)?.map((a, n) => ({ ...a, idx: t.uploads?.[n] })) },
      { id: uid(), kind: 'qa', question: text, answer: '', done: false },
    ];
    task.value = null;
    asking.value = true; // the first turn is already dispatched server-side — mirror ask()'s signal
    applyTask(t);
    openStream(t.taskId);
    void loadConsults();
    return true;
  } catch (e) {
    surfaceError(e);
    return false;
  }
}

// ───────────────────────────── spec 082 · graduate (consult → build) ─────────────────────────────
// The "Bắt đầu build" bridge: send a canned distill prompt through the NORMAL ask machinery (it shows
// in the chat like any exchange), and when its ask:done{ok:true} lands, hand the full answer to the App
// as `graduateDraft` — the App opens the new-task surface in build mode with the requirement prefilled.
// Armed per-request; a failed distill (ok:false) simply disarms (no prefill of garbage — 082 §4.4).
export const graduateDraft = signal<string | null>(null);
let _graduateArmed = false;

/** The canned distill prompt (EN instruction — the turn's langPin + the instruction itself steer the
 *  ANSWER into the user's own language, which is what gets prefilled). */
export const GRADUATE_PROMPT =
  'Summarize our conversation so far into one complete, self-contained requirement for building this ' +
  'Dify workflow. Reply with ONLY the requirement text, no preamble, in the language I have been using.';

export async function graduate(): Promise<boolean> {
  _graduateArmed = true;
  const ok = await ask(tr('graduatePromptText'));
  if (!ok) _graduateArmed = false; // the POST itself failed — nothing will stream
  return ok;
}

/** spec 084 — dispatch a distill into the BACKGROUND tray (was spec 052/070 foreground: task.value=null +
 *  openStream, which hijacked the whole view). Mints the promote task and parks it in `bgDistills`; the
 *  user stays on their current screen. A 409 (single write-lane busy, §2) does NOT surface as an error —
 *  the item parks `queued` and the poll loop retries when the lane frees. `provisionalSlug` labels the
 *  tray until the backend resolves the real slug. Returns the tray key. */
function startBgDistill(req: BgDistillReq, sourceKind: 'local' | 'external', provisionalSlug: string): string {
  const key = bgKey();
  const test = req.test === true;
  bgDistills.value = [{ key, slug: provisionalSlug, status: 'queued', sourceKind, req, ...(test ? { test: true } : {}) }, ...bgDistills.value];
  void dispatchBgDistill(key);
  startBgPoll();
  return key;
}

/** POST the promote request for a `queued` tray item. Success → adopt the minted task's id/status/gate.
 *  409 (lane busy) → stay `queued` (the poll retries). A 400 (bad external YAML) is terminal — surface it
 *  on the item so the tray shows the reason rather than spinning forever. */
async function dispatchBgDistill(key: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (!item || item.taskId || item.status !== 'queued') return; // already dispatched / gone
  try {
    const t = await api.promote(withChatLang(item.req));
    upsertBg(key, bgFieldsFromTask(t, item.slug));
    void loadTree();
    void loadPromotes(); // S1.5: surface the new distill in the sidebar section immediately
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return; // lane busy — stay queued, poll retries
    // 400/404/other — terminal: mark the item errored (the tray renders [Details] on it).
    upsertBg(key, { status: 'error' });
  }
}

/** spec 052 → 084 — distill a resolved on-disk workflow into a pattern, in the BACKGROUND tray. Returns
 *  the tray key (never hijacks the current view). */
export function promote(project: string, workflow: string): string {
  return startBgDistill({ project, workflow, ...(bgTestMode.value ? { test: true } : {}) }, 'local', workflow);
}

/** spec 070 → 084 — distill an EXTERNAL (pasted/uploaded) YAML into a pattern, in the BACKGROUND tray. The
 *  backend still validates the bytes inline: a 400 (bad YAML / linter reject) is caught at the modal BEFORE
 *  this is called (via api.promote in the modal path), OR surfaces on the tray item. To keep the modal's
 *  inline-error UX (spec 070), this variant awaits the FIRST POST and returns `{error}` on a 400; a 409
 *  (lane busy) still parks `queued`. */
export async function promoteExternalYaml(
  body: { yaml: string; sourceLabel?: string; license?: string; fileName?: string }
): Promise<true | { error: string }> {
  const label = body.sourceLabel || body.fileName || 'external YAML';
  const test = bgTestMode.value;
  const req: BgDistillReq = { origin: 'paste', ...body, ...(test ? { test: true } : {}) };
  const key = bgKey();
  bgDistills.value = [{ key, slug: label, status: 'queued', sourceKind: 'external', req, ...(test ? { test: true } : {}) }, ...bgDistills.value];
  startBgPoll();
  try {
    const t = await api.promote(withChatLang(req));
    upsertBg(key, bgFieldsFromTask(t, label));
    void loadTree();
    return true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return true; // lane busy — parked queued, poll retries
    // 400 (bad YAML) is terminal — drop the tray item and hand the message to the modal for inline display.
    removeBg(key);
    if (e instanceof ApiError && e.status === 400) return { error: e.message };
    surfaceError(e);
    return { error: e instanceof ApiError ? e.message : String(e) };
  }
}

// ── bg poll loop (§4 S1.2 — POLL, not a 2nd SSE stream) ───────────────────────────────────────────
let _bgPollTimer: ReturnType<typeof setInterval> | null = null;
export const BG_POLL_MS = 2000;

/** One poll tick (exported for the unit test): refresh each active bg task, and re-dispatch AT MOST ONE
 *  queued item (a burst of POSTs would all 409 but one). Terminal items are skipped. */
export async function pollBgTick(): Promise<void> {
  const items = bgDistills.value;
  let dispatchedQueued = false;
  await Promise.all(
    items.map(async (b) => {
      if (isBgTerminal(b)) return;
      if (b.status === 'queued' || !b.taskId) {
        if (dispatchedQueued) return; // one retry per tick
        dispatchedQueued = true;
        await dispatchBgDistill(b.key);
        return;
      }
      try {
        const t = await api.getTask(b.taskId);
        upsertBg(b.key, bgFieldsFromTask(t, b.slug));
      } catch {
        /* transient GET failure — next tick retries */
      }
    }),
  );
  // spec 084 S1.5: keep the sidebar "蒸留" history in sync with the live distill lifecycle (a small GET;
  // the poll only runs while a distill is active, so this is at most every ~2s during one).
  void loadPromotes();
  // Stop the interval once nothing is left to watch (all terminal / tray emptied).
  if (!bgDistills.value.some((b) => !isBgTerminal(b))) stopBgPoll();
}

export function startBgPoll(): void {
  if (_bgPollTimer !== null) return;
  _bgPollTimer = setInterval(() => void pollBgTick(), BG_POLL_MS);
}
export function stopBgPoll(): void {
  if (_bgPollTimer !== null) {
    clearInterval(_bgPollTimer);
    _bgPollTimer = null;
  }
}

/** spec 084 §7 Q2 — rebuild the tray on load from the NON-TERMINAL promote tasks (parked at review /
 *  collision / distill_failed / share). `/api/active` carries no `kind`, so GET each and keep the promote
 *  ones that are still in-flight — a reload never strands a parked distill. Terminal (done/auto-approved)
 *  tasks are intentionally NOT restored: [Undo] is "instant regret", session-scoped, not a permanent bin.
 *  Best-effort + idempotent (skips ids already in the tray). */
export async function restoreBgDistills(): Promise<void> {
  try {
    const { active } = await api.active();
    const known = new Set(bgDistills.value.map((b) => b.taskId).filter(Boolean));
    const restored: BgDistill[] = [];
    for (const a of active) {
      if (known.has(a.id)) continue;
      let t: WireTask;
      try {
        t = await api.getTask(a.id);
      } catch {
        continue;
      }
      if (t.kind !== 'promote') continue;
      if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') continue;
      const external = t.promote?.project === '(external)';
      restored.push({
        key: bgKey(),
        taskId: t.taskId,
        slug: t.promote?.slug ?? t.workflowSlug ?? 'pattern',
        status: t.status,
        gate: t.gate,
        target: t.promote?.target ?? t.promote?.staged,
        share: t.promote?.share,
        sourceKind: external ? 'external' : 'local',
        ...(t.promote?.test ? { test: true } : {}),
        // `req` only feeds the queued-retry path; a restored item already has a taskId, so it never dispatches.
        req: external
          ? { origin: 'paste', yaml: '' }
          : { project: t.promote?.project ?? '', workflow: t.promote?.workflow ?? '' },
      });
    }
    if (restored.length) {
      bgDistills.value = [...restored, ...bgDistills.value];
      startBgPoll();
    }
  } catch {
    /* best-effort — a failed restore just means no tray until the next distill */
  }
}

// ── tray gate actions (§2 — act on the BACKGROUND task, never `task.value`) ────────────────────────
/** Confirm a gate action on a background distill (Approve / Overwrite / Save-as-new / Share / Keep local).
 *  Unlike {@link confirm} this targets a specific taskId and does NOT optimisticAdvance `task.value`; the
 *  poll loop folds the resulting next-gate back into the tray item. */
export async function confirmBg(key: string, actionId: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (!item?.taskId) return;
  try {
    const t = await api.confirm(item.taskId, actionId);
    upsertBg(key, bgFieldsFromTask(t, item.slug));
    if (task.value?.taskId === item.taskId) applyTask(t); // keep an open-in-foreground copy in sync
    void loadTree();
  } catch (e) {
    surfaceError(e);
  }
}

/** [Resend] on a distill_failed tray item — re-run the distill turn with NO note (a note-less reply). */
export async function resendBg(key: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (!item?.taskId) return;
  try {
    const t = await api.reply(item.taskId, ''); // empty note → clean re-run (promoteReply → runDistillTurn)
    upsertBg(key, bgFieldsFromTask(t, item.slug));
    if (task.value?.taskId === item.taskId) applyTask(t);
  } catch (e) {
    surfaceError(e);
  }
}

/** [Close] on a tray item. Terminal → just drop it (the shelf file is untouched). Non-terminal → cancel
 *  the promote task first (kills a running turn / discards a parked gate), then drop it. A queued item
 *  (no taskId yet) is dropped locally. The confirm dialog for the non-terminal case is the caller's. */
export async function closeBg(key: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (!item) return;
  if (item.taskId && !isBgTerminal(item)) {
    try {
      await api.cancel(item.taskId);
      if (task.value?.taskId === item.taskId) applyTask(await api.getTask(item.taskId));
    } catch (e) {
      surfaceError(e);
    }
    void loadTree();
    void loadActive();
    void loadPromotes(); // S1.5: a cancelled distill drops out of the sidebar section
  }
  removeBg(key);
}

/** [Xem report] / [Chi tiết] — open the background distill in the FOREGROUND conversation view (the only
 *  place it hijacks `task.value`, on explicit user request). Leaves the tray item in place. */
export async function openBg(key: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (item?.taskId) await openTask(item.taskId);
}

/** spec 084 (DEV) — wipe every TEST distill from the tray: undo any that finalized (unlink + rebuild
 *  index; no-op if dry-run never wrote), cancel any still in-flight, then drop the item. Reuses the
 *  existing undo/cancel routes — no new endpoint. Only ever called from the dev-gated tray control. */
export async function clearTestDistills(): Promise<void> {
  const tests = bgDistills.value.filter((b) => b.test);
  for (const b of tests) {
    if (b.taskId) {
      if (b.status === 'done') await api.undoPromote(b.taskId).catch(() => {}); // unlink if it was approved
      else if (!isBgTerminal(b)) await api.cancel(b.taskId).catch(() => {}); // kill a running / parked one
    }
    removeBg(b.key);
  }
  if (tests.length) {
    void loadTree();
    void loadActive();
    void loadPromotes(); // S1.5: cleared test distills drop out of the sidebar section
  }
}

/** spec 084 S2 — [Undo] on a promoted tray item: unlink the shelf file + rebuild index (no git), then
 *  drop the item. Only offered pre-Share (a pushed pattern can't be recalled from Drive/PR — §4 S2.3). */
export async function undoBg(key: string): Promise<void> {
  const item = bgDistills.value.find((b) => b.key === key);
  if (!item?.taskId) return;
  try {
    await api.undoPromote(item.taskId);
    void loadTree();
  } catch (e) {
    surfaceError(e);
  }
  removeBg(key);
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
  if (!t) return false;
  const trimmed = text.trim();
  // spec 053: empty text is a valid reply ONLY as a Retry-out-of-error (a text-less one-click re-run of
  // the failed phase — the button fires store.reply('', 'Retry phase', …)). Everywhere else it is a no-op.
  if (!trimmed && t.status !== 'error') return false;
  const items = thread.value.slice();
  // No empty user bubble on a text-less retry; a steered reply still shows the user's message.
  const userItemId = uid();
  if (trimmed) items.push({ id: userItemId, kind: 'user', text: trimmed, atts: attsOf(files) });
  thread.value = items;
  try {
    // Optimistic: close the gate; SSE re-opens the current phase as a fresh run (no duplicate).
    const res = await api.reply(t.taskId, trimmed, files);
    stampUploads(userItemId, res.uploads);
    optimisticAdvance(res, label ?? 'Requested changes');
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
export async function ask(text: string, files?: Attachment[]): Promise<boolean> {
  const t = task.value;
  if (!t || !text.trim()) return false;
  // FIX-C/H defense-in-depth: never open a 2nd qa item while one is already in flight. The composer is
  // disabled during a live Ask (App: disabled={asking}), so this is belt-and-suspenders — but it also
  // guarantees the single-open-qa invariant `findOpenAskIdx` relies on, regardless of how ask() is
  // reached. A concurrent Ask would 409 on the global turn lock anyway.
  if (asking.value) return false;
  const items = thread.value.slice();
  const userItemId = uid();
  items.push({ id: userItemId, kind: 'user', text: text.trim(), atts: attsOf(files) });
  const qaId = uid();
  items.push({ id: qaId, kind: 'qa', question: text.trim(), answer: '', done: false });
  thread.value = items;
  asking.value = true;
  try {
    stampUploads(userItemId, (await api.ask(t.taskId, text.trim(), files)).uploads);
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

/** spec 084 follow-up — PERMANENTLY delete a task record (its .runs/<id> dir), the sidebar row-× on the
 *  Chat / Distill / Build / Project lists ("user muốn tự control"). Refreshes every list; if it was the
 *  open task, resets to the empty surface; if it was a tray distill, drops it there too. A 409 (turn
 *  running) / other error surfaces via the shared banner — the caller confirms before calling this. */
export async function removeTask(taskId: string): Promise<void> {
  try {
    await api.deleteTask(taskId);
  } catch (e) {
    surfaceError(e);
    return;
  }
  const bg = bgDistills.value.find((b) => b.taskId === taskId);
  if (bg) removeBg(bg.key);
  if (task.value?.taskId === taskId) resetToNew();
  void loadTree();
  void loadActive();
  void loadConsults();
  void loadPromotes();
}

/** spec 084 follow-up — PERMANENTLY delete a whole project (folder + all its build records). The sidebar
 *  ProjectRow ×. Refreshes the tree; if the open task belonged to this project, resets to the empty
 *  surface. A 400 (_drafts) / 409 (turn running) surfaces via the shared banner — caller confirms first. */
export async function removeProject(project: string): Promise<void> {
  try {
    await api.deleteProject(project);
  } catch (e) {
    surfaceError(e);
    return;
  }
  if (task.value && task.value.project === project) resetToNew();
  void loadTree();
  void loadActive();
  void loadPromotes(); // a promoted build from this project drops out of the 蒸留 section too
}

/** spec 084 follow-up — PERMANENTLY delete ONE workflow (folder + its build records). The Build/`_drafts`
 *  rows are workflows, so this is the "delete a junk build" door. Refreshes the tree; if the open task
 *  belonged to this workflow, resets. A 409 (turn running) surfaces via the shared banner. */
export async function removeWorkflow(project: string, workflow: string): Promise<void> {
  try {
    await api.deleteWorkflow(project, workflow);
  } catch (e) {
    surfaceError(e);
    return;
  }
  if (task.value && task.value.project === project && task.value.workflowSlug === workflow) resetToNew();
  void loadTree();
  void loadActive();
  void loadPromotes();
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

/**
 * spec 096 — switch the model of a RUNNING task. Takes effect from the next turn; phases already run
 * keep their own recorded model, so the dossier still reads correctly. Mirrors patchConfirmMode: the
 * new value also becomes the default future builds inherit, because changing it here is a statement
 * about what you want, not a one-off.
 */
export async function patchModel(taskId: string, model: string): Promise<void> {
  settings.value = { ...settings.value, model };
  rememberModel(model);
  try {
    const t = await api.patchTask(taskId, { model });
    if (task.value?.taskId === t.taskId) task.value = { ...task.value, model: t.model };
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
/** spec 082 (rev) — rebuild a consult chat thread from the backend transcript (`t.chat`): each user
 *  line → a user bubble, each assistant line → a finalized qa answer. This is AUTHORITATIVE for a
 *  consult (survives a cleared cache / another browser), replacing the localStorage restore for chats. */
function consultThreadFromChat(chat: NonNullable<WireTask['chat']>): LiveThreadItem[] {
  return chat.map((m) =>
    m.role === 'user'
      ? // the transcript carries each user message's files (name/mime/idx) — without them a reopened
        // chat would forget every attachment, since this restore WINS over the persisted thread
        { id: uid(), kind: 'user' as const, text: m.text, atts: m.files?.length ? m.files.map((f) => ({ ...f })) : undefined }
      : { id: uid(), kind: 'qa' as const, question: '', answer: m.text, done: true, ...(m.cost ? { cost: m.cost } : {}), ...(m.sessionReset ? { sessionReset: true } : {}) }
  );
}

/** spec 084 — rebuild a promote task's thread from the persisted distill log when there's no client-side
 *  history (a bg distill opened AFTER it finished): the user bubble + the distill turn's output disclosure.
 *  applyTask then appends the current/terminal gate card below it, so opening reads "report + what the
 *  distill did" rather than just the terminal card. */
function promoteThreadFromLog(t: WireTask): LiveThreadItem[] {
  return [
    { id: uid(), kind: 'user', text: t.requirement },
    { id: uid(), kind: 'run', phase: 'test', running: false, output: t.promote!.distillLog! },
  ];
}

export async function openTask(taskId: string): Promise<void> {
  clearErrors();
  // spec 033 FIX-I: a live Ask belongs to the PREVIOUS task's stream — switching tasks must not leave
  // the new view's composer stuck "disabled".
  asking.value = false;
  resetAskBuffer(); // …and its half-arrived words must not land on the task we are opening
  _lastPersisted = ''; // task switch — force a re-persist for the newly-opened build (dedupe reset)
  try {
    const t = await api.getTask(taskId);
    // spec 082 (rev): a consult restores from the BACKEND transcript (authoritative — survives a cleared
    // cache / another machine); fall back to the localStorage thread, then the bare requirement bubble.
    // A build restores the client-side conversation from localStorage (D6-safe — client-only);
    // hydrateForReopen drops any stale unresolved gate so the ONE live gate comes fresh from applyTask.
    // spec 084: a promote task opened AFTER a background distill has no localStorage thread — synthesize
    // one from the persisted distill log (user bubble + the turn's output disclosure) so the reasoning is
    // replayed, not just the terminal card. A foreground/already-opened promote keeps its persisted thread.
    const restored =
      t.kind === 'consult' && t.chat && t.chat.length
        ? consultThreadFromChat(t.chat)
        : loadPersistedThread(taskId) ??
          (t.kind === 'promote' && t.promote?.distillLog ? promoteThreadFromLog(t) : null);
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
  resetAskBuffer();
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

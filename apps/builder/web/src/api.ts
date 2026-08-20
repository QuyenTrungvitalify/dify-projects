/* ============================================================
   api.ts — slim REST client for the Lát 4 UI (spec 009 Endpoints).
   Mines the request/qs shape from nexus's 688-LOC api.ts but is
   authored fresh: only the endpoints this dumb renderer calls.
   The UI never talks to Dify or `claude` — every call is to the
   builder backend, which owns all I/O (token never reaches here).
   ============================================================ */
import type { WireTask, WireTreeProject, WireTreeTask, Seed, WireConfirmMode } from './types';
import type { ShelfResponse } from './lib/shelf';
import type { TranscriptLine } from './lib/ask-backfill';

/** Thrown on a non-2xx response; carries the HTTP status so callers can branch (e.g. 409 busy), the
 *  `holder` taskId from a turn-collision 409 body (offer "open the running build"), and `existing` from
 *  a project-create 409 body (spec 031 D4 — offer "open the existing project"). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public holder?: string | null,
    public existing?: string | null
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, headers: {} };
  if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, init);
  if (!res.ok) {
    let msg = `${method} ${path} → ${res.status}`;
    let holder: string | null | undefined;
    let existing: string | null | undefined;
    try {
      const j = await res.json();
      if (j && typeof j.error === 'string') msg = j.error;
      if (j && typeof j.holder === 'string') holder = j.holder;
      if (j && typeof j.existing === 'string') existing = j.existing;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg, holder, existing);
  }
  // Some endpoints (PUT spec) return small JSON; tolerate empty bodies.
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/** A file attached in the composer (spec 012 → 025): base64 data-URL rides the JSON body, no multipart. */
export interface Attachment {
  name: string;
  mime: string;
  dataUrl: string;
}

export interface CreateTaskBody {
  requirement: string;
  workflow?: string | null;
  confirm_mode?: string;
  deploy?: string;
  slug?: string | null;
  name?: string | null;
  seed?: string | null;
  /** spec 028: `⚡ Fast build` — merge Analyze+Spec (from-scratch single-LLM only; backend force-offs
   *  on seed/workflow/slug). Sent only when the toggle is on and no seed/workflow is chosen. */
  fast_mode?: boolean;
  /** spec 032: Phase ④ test mode — 'static' | 'live' (backend force-offs to static unless selfhost). */
  test_mode?: string;
  /** spec 012/025: 1–3 files attached at build start; backend saves them + injects their paths (AC2). */
  files?: Attachment[];
  /** The chat-language setting: 'vi' | 'ja'. Omitted ⇒ the server reads 'auto' (infer from the text),
   *  which is exactly what every client did before the setting existed. */
  chat_lang?: string;
  /** spec 096: the model family alias (`opus`/`sonnet`/`haiku`/`fable`) every turn of this task spawns
   *  with. Omitted ⇒ the server passes no `--model` and the CLI picks, as it did before 096. */
  model?: string;
}

/** The four file-accepting POSTs echo back WHERE each file landed: indices into `task.attachments`,
 *  addressable as `GET /api/tasks/:id/uploads/:idx`. The chat history stores those indices on the user
 *  bubble so a reopened build can still render the files it was given (data-URLs are far too big to
 *  persist). Absent when the request carried no files. */
export interface UploadIdx {
  uploads?: number[];
}

export const api = {
  /** POST /api/tasks → start a build (run-lock; 409 surfaces as ApiError.status===409, AC #21). */
  createTask: (body: CreateTaskBody): Promise<WireTask & UploadIdx> => request('POST', '/api/tasks', body),
  /** GET /api/tasks/:id → authoritative state + artifact contents (the reconnect re-fetch, AC #22). */
  getTask: (id: string): Promise<WireTask> => request('GET', `/api/tasks/${encodeURIComponent(id)}`),
  /** GET /api/tasks/:id/chat → the persisted ask transcript (spec 099 S1), read back when a build's
   *  localStorage thread is gone: LRU eviction, a cleared cache, another machine. SEPARATE from getTask
   *  on purpose — that snapshot is re-fetched on every SSE reconnect and must stay light. `have` = how
   *  many `qa` bubbles this browser already holds; a disagreement with disk records ONE diagnostic line
   *  server-side, which is the measurement the 099 investigation had to beg from a console paste.
   *
   *  `report` (spec 099 S2′) piggybacks a "this browser could not persist" note onto that same one
   *  request — no extra round trip, and no new write route. */
  getTaskChat: (
    id: string,
    have: number,
    report?: { at: number; taskId: string; chars: number; reason: string }
  ): Promise<{ chat: TranscriptLine[]; dropped?: number }> => {
    const q = new URLSearchParams({ have: String(have) });
    if (report) {
      // `persistFailed` carries CHARACTERS (UTF-16 units), the unit the browser's own quota is measured
      // in — not UTF-8 bytes. The server names it `chars=` in the timeline for the same reason.
      q.set('persistFailed', String(Math.max(0, Math.round(report.chars))));
      q.set('pfReason', report.reason === 'quota' ? 'quota' : 'other');
      q.set('pfAt', String(Math.max(0, Math.round(report.at))));
      if (report.taskId) q.set('pfTask', report.taskId);
    }
    return request('GET', `/api/tasks/${encodeURIComponent(id)}/chat?${q}`);
  },
  /** POST /api/tasks/:id/confirm → advance the gate (carries the chosen action id, + slug/name at ②, or
   *  spec 036 `keepCurrent` on a `cleanup_apps` delete — delete only OLD test apps vs all). */
  confirm: (id: string, actionId: string, extra?: { slug?: string; name?: string; keepCurrent?: boolean }): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/confirm`, { actionId, ...extra }),
  /** POST /api/tasks/:id/reply → within-phase change request / Retry-out-of-error (+ optional files, AC3). */
  reply: (id: string, text: string, files?: Attachment[]): Promise<WireTask & UploadIdx> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/reply`, {
      text,
      ...(files && files.length ? { files } : {}),
    }),
  /** spec 033: POST /api/tasks/:id/ask → conversational Q&A at a parked gate — no phase re-run, no
   *  gate/status change. Responds `{ok:true}` immediately; the answer streams over SSE (ask:answer/done).
   *  spec 089: carries optional files, so a chat can take a document on any message, not just its first. */
  ask: (id: string, text: string, files?: Attachment[]): Promise<{ ok: boolean } & UploadIdx> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/ask`, {
      text,
      ...(files && files.length ? { files } : {}),
    }),
  /** spec 082: POST /api/consult → start a `kind:'consult'` chat task (chat lane; a running build never
   *  blocks it). `text` is the first message; every later message is a plain api.ask(id, text). */
  createConsult: (body: { text: string; files?: Attachment[]; chat_lang?: string; model?: string }): Promise<WireTask & UploadIdx> =>
    request('POST', '/api/consult', body),
  /** spec 082: GET /api/consults → the consult chats (newest first) for the sidebar's own section. */
  consults: (): Promise<{ consults: WireTreeTask[] }> => request('GET', '/api/consults'),
  /** spec 084 S1.5: GET /api/promotes → the distill/promote tasks (newest first) for the sidebar's own
   *  "蒸留" section. Shows ALL (incl. done/shared) as history; excluded from /api/tree. */
  promotes: (): Promise<{ promotes: WireTreeTask[] }> => request('GET', '/api/promotes'),
  /** PATCH /api/tasks/:id → live-patch a build's settings: confirm_mode (409 once terminal — no next
   *  boundary to honor it), or model / chat_lang (still patchable on a finished build, whose Ask turns
   *  read both). All three 409 while THIS build's turn is running. */
  patchTask: (id: string, patch: { confirm_mode?: string; model?: string; chat_lang?: string }): Promise<WireTask> =>
    request('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch),
  /** POST /api/tasks/:id/cancel → abandon: kill child, terminal status, release lock (AC #24). */
  cancel: (id: string): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/cancel`),
  /** spec 084 follow-up: DELETE /api/tasks/:id → permanently remove the task record (.runs/<id>). 409 if
   *  its turn is running (cancel first); 404 if already gone. */
  deleteTask: (id: string): Promise<{ ok: boolean }> =>
    request('DELETE', `/api/tasks/${encodeURIComponent(id)}`),
  /** POST /api/tasks/:id/restore → reopen a cancelled build at the previous phase's gate (undo Continue). */
  restore: (id: string): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/restore`),
  /** spec 084 S2: POST /api/tasks/:id/undo-promote → gỡ an auto-approved pattern (unlink + rebuild index,
   *  no git). Idempotent — a missing file responds `{ok:true, removed:false}`. */
  undoPromote: (id: string): Promise<{ ok: boolean; removed: boolean }> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/undo-promote`),
  /** spec 036 D5: POST /api/tasks/:id/live-test → run a live workflow test from a terminal `done`
   *  autonomous build (the done-state "Run test with workflow" foot). 409 if the gate no longer holds. */
  liveTest: (id: string): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/live-test`),
  /** GET /api/tasks/:id/spec → current SPEC.md content for the editable panel. */
  getSpec: (id: string): Promise<{ content: string }> =>
    request('GET', `/api/tasks/${encodeURIComponent(id)}/spec`),
  /** PUT /api/tasks/:id/spec → persist an in-place SPEC.md edit (last-writer, AC #3). */
  putSpec: (id: string, content: string): Promise<{ ok: boolean }> =>
    request('PUT', `/api/tasks/${encodeURIComponent(id)}/spec`, { content }),
  /** POST /api/tasks/:id/reveal → open the OS file manager (Finder) at the task's workflow YAML. */
  reveal: (id: string): Promise<{ ok: boolean; path: string }> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/reveal`),
  /** spec 062 follow-up: POST /api/tasks/:id/export-drive → upload the run dossier zip to the team Drive
   *  (exports/). 409 (no drop configured) → the caller falls back to the plain download. */
  exportToDrive: (id: string): Promise<{ ok: boolean; path?: string; unconfirmed?: boolean }> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/export-drive`),
  /** POST /api/projects → scaffold an empty project tier (spec 031). 409 (dup) surfaces as
   *  ApiError.status===409 with `existing` set; 400 name_charset/name_required is a plain message. */
  createProject: (name: string): Promise<{ project: string; name: string }> =>
    request('POST', '/api/projects', { name }),
  /** spec 084 follow-up: DELETE /api/projects/:project → permanently remove a whole project (folder + all
   *  its build records). 400 (_drafts / bad slug), 404 (missing), 409 (a build's turn is running). */
  deleteProject: (project: string): Promise<{ ok: boolean; tasksRemoved: number }> =>
    request('DELETE', `/api/projects/${encodeURIComponent(project)}`),
  /** spec 084 follow-up: DELETE /api/projects/:project/workflows/:workflow → remove ONE workflow (folder +
   *  its build records). The "delete a junk build" door for the Build/`_drafts` rows. 400/404/409 as above. */
  deleteWorkflow: (project: string, workflow: string): Promise<{ ok: boolean; tasksRemoved: number }> =>
    request('DELETE', `/api/projects/${encodeURIComponent(project)}/workflows/${encodeURIComponent(workflow)}`),
  /** POST /api/bases → import one standalone YAML as a local edit-existing base (spec 051 D1). Returns
   *  the resolved `{ project, workflow }` (+ an optional `slugNote` when a collision was auto-suffixed);
   *  400 (bad YAML / limits / linter reject) surfaces as ApiError with the verbatim message. */
  importBase: (body: { yaml: string; name?: string; project?: string; fileName?: string }): Promise<{ project: string; workflow: string; slugNote?: string; probeNote?: string }> =>
    request('POST', '/api/bases', body),
  /** spec 052/070: POST /api/promote → start a `kind:'promote'` build (distill a source into a
   *  templates/patterns/ pattern behind the B1 gate → distill turn → review → Approve pipeline). Returns
   *  the promote Task (opened in the conversation view like a build); 400/404 (bad source) → ApiError.
   *  Two source doors: a LOCAL project workflow `{project, workflow}` (source=original), or spec 070's
   *  EXTERNAL pasted/uploaded YAML `{origin:'paste', yaml, ...}` (stamped source=external). */
  promote: (body:
    | { project: string; workflow: string; test?: boolean; chat_lang?: string }
    | { origin: 'paste'; yaml: string; sourceLabel?: string; license?: string; fileName?: string; test?: boolean; chat_lang?: string }
  ): Promise<WireTask> =>
    request('POST', '/api/promote', body),
  /** GET /api/tree → the Project ▸ Workflow ▸ Task sidebar tree (AC #13). */
  tree: (): Promise<{ projects: WireTreeProject[] }> => request('GET', '/api/tree'),
  /** GET /api/active → the in-progress (non-terminal) builds, newest first (Lát 6 load-recovery). */
  active: (): Promise<{ active: WireTreeTask[] }> => request('GET', '/api/active'),
  /** GET /api/seeds → seed-picker apps (degrades to [] until Lát 5, AC #2). */
  seeds: (): Promise<{ seeds: Seed[]; note?: string }> => request('GET', '/api/seeds'),
  /** spec 059 dev-only (BUILDER_DEV=1): rebuild server+web then hot-restart. Throws ApiError(404) when
   *  the flag is off, ApiError(409) when a build turn is running; a failed BUILD returns `{ok:false,log}`. */
  devRebuild: (): Promise<{ ok: boolean; restarting?: boolean; phase?: string; log?: string; reason?: string }> =>
    request('POST', '/api/dev/rebuild', {}),
  /** user-facing update & restart (git pull + install/build + restart) — mounted for every run,
   *  409 {reason:'turn_running'|'update_running'} when blocked. */
  /** `step:'branch'` is a DECLINE, not a failure: HEAD is not main, so nothing ran and `log` holds the
   *  branch name. (It replaced `'checkout'` — the update no longer switches branches; switching on a
   *  clean tree was silent, so a branch under test was rebuilt as main with nothing to show for it.) */
  /** GET /api/dev/build-info — which code is running (BUILDER_DEV only; 404 otherwise). Answers the
   *  one question a dev panel can answer and a terminal cannot do from inside the app: am I testing
   *  the branch I think I am? */
  devBuildInfo: (): Promise<{ gitBranch: string | null; gitSha: string | null; builderVersion: string | null }> =>
    request('GET', '/api/dev/build-info'),

  update: (): Promise<{ ok: boolean; restarting?: boolean; step?: 'branch' | 'pull' | 'setup'; log?: string }> =>
    request('POST', '/api/update', {}),
  /** spec 080 dev-only (BUILDER_DEV=1): the shelf dashboard feed — `catalog.py stats --json`
   *  passthrough. Throws ApiError(404) when the server runs without BUILDER_DEV. */
  devShelf: (): Promise<ShelfResponse> => request('GET', '/api/dev/shelf'),
  /** spec 083 dev-only (BUILDER_DEV=1): the settings registry + per-machine local overrides
   *  (secrets masked). Throws ApiError(404) when the server runs without BUILDER_DEV. */
  devSettings: (): Promise<DevSettingsResponse> => request('GET', '/api/dev/settings'),
  /** spec 083 dev-only: apply a validated patch to the local override file; returns the fresh view.
   *  A 400 (bad value / unknown key) surfaces as ApiError with the verbatim message. */
  devSaveSettings: (patch: { values?: Record<string, string | number>; clearSecrets?: string[] }): Promise<DevSettingsResponse> =>
    request('POST', '/api/dev/settings', patch),
};

/** One settable field as the ⚙ modal sees it (mirrors server ResolvedField). */
export interface DevSettingField {
  key: string;
  label: string;
  help: string;
  type: 'text' | 'password' | 'number';
  section: string;
  placeholder?: string;
  secret: boolean;
  value: string | number | null;
  set: boolean;
  fallback: string;
}
export interface DevSettingsResponse {
  ok: boolean;
  fields: DevSettingField[];
}

/** Map the UI's public Confirm-mode label → the backend's verbose `confirm_mode` value (AC #15). */
export function confirmModeWire(label: string): string {
  if (label === 'auto') return 'auto';
  if (label === 'spec only' || label === 'at spec only') return 'confirm at spec only';
  return 'confirm each step';
}

export type { WireConfirmMode };

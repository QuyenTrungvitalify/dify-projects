/* ============================================================
   api.ts — slim REST client for the Lát 4 UI (spec 009 Endpoints).
   Mines the request/qs shape from nexus's 688-LOC api.ts but is
   authored fresh: only the endpoints this dumb renderer calls.
   The UI never talks to Dify or `claude` — every call is to the
   builder backend, which owns all I/O (token never reaches here).
   ============================================================ */
import type { WireTask, WireTreeProject, WireTreeTask, Seed, WireConfirmMode } from './types';

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
}

export const api = {
  /** POST /api/tasks → start a build (run-lock; 409 surfaces as ApiError.status===409, AC #21). */
  createTask: (body: CreateTaskBody): Promise<WireTask> => request('POST', '/api/tasks', body),
  /** GET /api/tasks/:id → authoritative state + artifact contents (the reconnect re-fetch, AC #22). */
  getTask: (id: string): Promise<WireTask> => request('GET', `/api/tasks/${encodeURIComponent(id)}`),
  /** POST /api/tasks/:id/confirm → advance the gate (carries the chosen action id, + slug/name at ②). */
  confirm: (id: string, actionId: string, extra?: { slug?: string; name?: string }): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/confirm`, { actionId, ...extra }),
  /** POST /api/tasks/:id/reply → within-phase change request / Retry-out-of-error (+ optional files, AC3). */
  reply: (id: string, text: string, files?: Attachment[]): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/reply`, {
      text,
      ...(files && files.length ? { files } : {}),
    }),
  /** PATCH /api/tasks/:id → live-patch confirm_mode on a non-terminal build (spec 010 F2; 409 if terminal). */
  patchTask: (id: string, patch: { confirm_mode: string }): Promise<WireTask> =>
    request('PATCH', `/api/tasks/${encodeURIComponent(id)}`, patch),
  /** POST /api/tasks/:id/cancel → abandon: kill child, terminal status, release lock (AC #24). */
  cancel: (id: string): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/cancel`),
  /** POST /api/tasks/:id/restore → reopen a cancelled build at the previous phase's gate (undo Continue). */
  restore: (id: string): Promise<WireTask> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/restore`),
  /** GET /api/tasks/:id/spec → current SPEC.md content for the editable panel. */
  getSpec: (id: string): Promise<{ content: string }> =>
    request('GET', `/api/tasks/${encodeURIComponent(id)}/spec`),
  /** PUT /api/tasks/:id/spec → persist an in-place SPEC.md edit (last-writer, AC #3). */
  putSpec: (id: string, content: string): Promise<{ ok: boolean }> =>
    request('PUT', `/api/tasks/${encodeURIComponent(id)}/spec`, { content }),
  /** POST /api/tasks/:id/reveal → open the OS file manager (Finder) at the task's workflow YAML. */
  reveal: (id: string): Promise<{ ok: boolean; path: string }> =>
    request('POST', `/api/tasks/${encodeURIComponent(id)}/reveal`),
  /** POST /api/projects → scaffold an empty project tier (spec 031). 409 (dup) surfaces as
   *  ApiError.status===409 with `existing` set; 400 name_charset/name_required is a plain message. */
  createProject: (name: string): Promise<{ project: string; name: string }> =>
    request('POST', '/api/projects', { name }),
  /** GET /api/tree → the Project ▸ Workflow ▸ Task sidebar tree (AC #13). */
  tree: (): Promise<{ projects: WireTreeProject[] }> => request('GET', '/api/tree'),
  /** GET /api/active → the in-progress (non-terminal) builds, newest first (Lát 6 load-recovery). */
  active: (): Promise<{ active: WireTreeTask[] }> => request('GET', '/api/active'),
  /** GET /api/seeds → seed-picker apps (degrades to [] until Lát 5, AC #2). */
  seeds: (): Promise<{ seeds: Seed[]; note?: string }> => request('GET', '/api/seeds'),
};

/** Map the UI's public Confirm-mode label → the backend's verbose `confirm_mode` value (AC #15). */
export function confirmModeWire(label: string): string {
  if (label === 'auto') return 'auto';
  if (label === 'spec only' || label === 'at spec only') return 'confirm at spec only';
  return 'confirm each step';
}

export type { WireConfirmMode };

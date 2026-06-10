# Implementation Prompt — Spec 009, Lát 4: UI — SSE + 3 regions (copy/adapt nexus)

> Copy-paste vào fresh session.

---

You are implementing **Lát 4 — UI (SSE + 3 regions; copy/adapt nexus)** for the dify-projects repo. This is the first slice with a browser: a Preact+Vite+TS **"dumb" SPA** that renders the backend's stream and posts confirm/reply/spec — it adds **no** build logic. Everything generating/gating/verifying already exists from Lát 1–3; the UI only orchestrates and renders.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST** (the parts your slice touches):
  - [docs/specs/009-implementation-plan.md](../../009-implementation-plan.md) → **"### Lát 4 — UI"** (goal/scope/files/commands/acceptance/gotchas/spec-update), plus **"Cross-cutting decisions"** and the **"Spec-update ledger"** row for Lát 4.
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) → **§B (3 regions)**, **§C (4-phase table)**, **§D (gating + inline buttons)**, **§Revision 2026-06-10 → Frontend model**, **Endpoints table** (`/api/tree`, `/api/tasks/:id/spec`, `/api/tasks/:id/stream`), **Acceptance #1, #2(UI half), #3, #4(render), #13, #14, #16, #22**.
  - [docs/specs/009-spike-findings.md](../../009-spike-findings.md) → §5 (the permission **MODEL C** the backend already uses — you do not touch spawning here, but `/health` must still gate on `.venv/`+`skills/`).
  - [docs/specs/prompts/009/lat0-spike.md](lat0-spike.md) — house-style exemplar.
  - **[lat4-design.md](lat4-design.md) + [docs/design/](../../../design/)** — the **VISUAL source of truth** (bespoke design: `surface-blocks.css` tokens + 7 ported prototype components). Do **lat4-design first**; it builds the static shell. **This prompt (lat4-ui) wires that shell to the backend** — it does **not** re-derive the look from nexus.
  - nexus copy-targets — used here as a **LOGIC reference only** (SSE reconnect, diff *parsing*, markdown rendering, draft persistence, SSE transport), **not** for visuals (the look comes from `docs/design/`). Read the real files before copying logic: `src/client/{sse-client.ts,store.ts,api.ts}`, `src/client/hooks/useChatReply.ts`, `src/client/lib/{diff-parser,markdown}.ts`, `src/server/plugins/{sse.ts,sse-origin-check.ts}`, `vite.config.ts`, `tsconfig.{base,client}.json`, `package.json`. (Component files `ChatMessage/SplitDiffView/PipelineTimeline/InlinePermissionPrompt/TaskList/ChatInputBar` are a *behavioral* reference; their markup/CSS are superseded by `docs/design/`.) Root: `/Users/quyenbt/Desktop/MyProjects/claude-nexus`.

## Why this matters

Lát 1–3 made the backend drive a full gated 4-phase build over curl. This slice is the **human surface**: a 3-region SPA (sidebar tree · chat + settings-below-input + inline gate buttons · artifact/diff panel) wired to the SSE stream and the confirm/reply/spec endpoints. It is deliberately a **thin renderer** — the gate, verify, and phase logic stay in the backend (the dedicated-app guarantee). Most of it is *copy* from nexus; the load-bearing net-new is the SSE plugin strip, the 4-phase timeline rewrite, the `project.group` sidebar tree, and the SPEC.md editor → `PUT`.

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                          # clean-ish; note pre-existing unrelated changes, do not revert them
git log --oneline -5
# Prior-slice artifacts MUST exist (Lát 1–3). If any are missing, STOP — this slice builds on them:
ls apps/builder/headless-settings.json              # Lát 1 (model-C settings the backend spawns with)
ls apps/builder/package.json apps/builder/tsconfig.json apps/builder/server/index.ts
ls apps/builder/server/lib/claude-session.ts apps/builder/server/lib/post-turn.ts
ls apps/builder/server/lib/phases.ts apps/builder/server/lib/orchestrator.ts        # Lát 2 chain
ls apps/builder/server/routes/tasks.ts apps/builder/server/lib/gate.ts apps/builder/server/lib/lock.ts  # Lát 3 gate
ls .claude/skills/dify-build/SKILL.md               # engine (Lát 0.5)
ls .venv/bin/python skills/mango-svip/scripts/generate_id.py   # repo bootstrap (run ./scripts/setup.sh if .venv missing)
node --version ; npm --version                      # Node 20+ required (Fastify + Vite)
```

If the Lát 1–3 backend files are absent, **STOP and report** — do not re-implement them; this slice is UI-only on top of an existing backend. (Exact filenames may differ slightly from the list above; the requirement is that a backend exposing `POST /api/tasks`, `/confirm`, `/reply`, `/cancel`, and SSE per phase already exists. Confirm by reading `apps/builder/server/routes/tasks.ts`.)

## Mission

Stand up `apps/builder/web` (Preact+Vite+TS) plus the two backend endpoints the UI needs (`/api/tree`, `PUT /api/tasks/:id/spec`) and the SSE plugin (`server/plugins/sse.ts` + a `/api/tasks/:id/stream` route), by **copying/adapting nexus** per the exact verdicts below. End state: `npm run build` then `npm start` boots and serves the built SPA; the 3 regions render; a full 4-phase run (driven by clicking inline gate buttons) is visible end-to-end; the SPEC.md panel edits round-trip through `PUT`; SSE reconnect restores the gate. **No build logic in the UI** (AC: §H integration).

## Tasks

> **⚠ DESIGN OVERRIDE — read before the tasks.** The visual shell (markup, class names,
> layout, CSS) is built by **[lat4-design.md](lat4-design.md)** from **`docs/design/`**, and is
> assumed to exist when you start this prompt. Wherever a task below says "copy/keep the **nexus
> component's visual shell**" (tasks 5, 7, 9, 10, 11, 12), that means: **render into the
> `docs/design` component that already exists** (`GateCard`, `PhaseTrack`, `Composer`, `Sidebar`,
> `ArtifactPanel`, `DiffTab`, …) and take from nexus **only the logic** (parsing, reconnect,
> draft persistence, the diff-row model, the markdown renderer). Do **not** introduce nexus's
> CSS/markup or restyle the design. If `docs/design`/lat4-design hasn't been ported yet, do that
> first.

Do these in order. Each names exact files and the precise **copy vs adapt vs rewrite vs net-new** verdict for the **logic/data** (the look is fixed by `docs/design`).

### 1. Toolchain — lift + prune (do NOT copy nexus's multi-target setup wholesale)

nexus has 5 tsconfigs + a mobile vite target + `concurrently`/`set -a; . ./.env.dev`. **Strip all of that.** Create:

- `apps/builder/web/package.json` — deps: `preact`, `@preact/signals`; devDeps: `vite`, `@preact/preset-vite`, `typescript`. **Do NOT add** `marked`, `dompurify`, `highlight.js`, `uplot`, `better-sqlite3` (nexus deps you are not bringing — see task 8). Scripts: `"dev": "vite"`, `"build": "tsc --noEmit && vite build"`, `"preview": "vite preview"`.
- `apps/builder/web/vite.config.ts` — adapt nexus's: keep `preact()` plugin, `root: 'src'` (your web src), `build.outDir` → a dir the Fastify server statically serves (e.g. `../dist` resolved to `apps/builder/web/dist`), `server.proxy` for `/api/` + `^/health$` → the builder backend port (read `BUILDER_PORT`, default **4123**, per spec §F). **Drop** `manualChunks` for `vendor-markdown`/`vendor-uplot` (you don't ship those), the `visualizer`/`ANALYZE` block, and the mobile config.
- `apps/builder/web/tsconfig.json` — merge nexus `tsconfig.base.json` + `tsconfig.client.json` into ONE file (no `extends` chain): `"jsx": "preserve"`, `"jsxImportSource": "preact"`, `"moduleResolution": "Bundler"`, `"strict": true`, `"types": ["vite/client"]`, `lib: ["ES2022","DOM","DOM.Iterable"]`, `noEmit: true`.
- `apps/builder/web/src/index.html`, `apps/builder/web/src/main.tsx` (mount `<App/>`).
- Wire the **server** to serve the built SPA: ensure `apps/builder/server` serves `web/dist` at `/` (add `@fastify/static` if not already present, or a minimal static handler). The server's existing `BUILDER_PORT` binding stays `127.0.0.1` (hardcoded — spec §J, do not make it env-overridable).

Verify the toolchain in isolation before writing components:
```bash
npm --prefix apps/builder/web install
npm --prefix apps/builder/web run build      # must produce apps/builder/web/dist with the toolchain only (App can be a stub first)
```

### 2. Backend SSE plugin — `apps/builder/server/plugins/sse.ts` (ADAPT nexus `sse.ts`)

Copy nexus `src/server/plugins/sse.ts` and **strip** the nexus wiring; **keep** the transport core. Concretely:

- **KEEP**: `reply.hijack()` + the `writeHead(200, {text/event-stream, no-cache, keep-alive, 'X-Accel-Buffering':'no'})`; the per-client **backpressure queue** (`flushQueue`, `MAX_QUEUE_SIZE`, the `'drain'` re-entry guard via the `flushing` flag); the **heartbeat** `setInterval` (`: heartbeat\n\n`); `cleanup()` idempotency on `close`/`error`; the **Last-Event-ID replay** (the `RingBuffer` + `eventBuffer.filter(e => e.id > lastEventId)` batch replay) — this is what AC #22 leans on.
- **STRIP**: `opts.container` Container DI and everything it destructures (`authToken`, `taskManager`, `evaluator`); `extractAuthToken` + the `token !== authToken` 401 (this app is localhost single-user, no token auth); the `init` event payload that ships `taskManager.list()`/`evaluator.getPendingRequests()`/`getRestartStatus()` — replace `init` with a **minimal** payload (e.g. `{ reconnected: bool }`); `onClientClose`/`clientId` visibility correlation.
- The state factory `createSSEState()` (clients Set + RingBuffer + `broadcast`) is **kept near-verbatim** — but its `broadcast` excludes only large output events from the buffer (nexus excludes `task:output`); keep that policy (exclude your high-volume `phase:output` event from the replay buffer, buffer the lightweight `phase`/`status`/`gate` events).
- **Origin check**: copy `sse-origin-check.ts` near-verbatim, but **point the default allowlist at the builder's own origin** (`http://127.0.0.1:${BUILDER_PORT}`, `http://localhost:${BUILDER_PORT}`) instead of nexus's `3001/3002`. Apply it on the SSE route (and reuse it on the mutating POSTs — spec §J Origin/same-origin check).
- Route: register `GET /api/tasks/:id/stream` (spec Endpoints) that hooks a client into the broadcast for that task. The orchestrator (Lát 2/3) must `broadcast(...)` phase/status/gate transitions + streamed Claude output; if it currently emits nothing, add the minimal `sse.broadcast(...)` calls at the existing transition points (do not restructure the state machine).

### 3. SSE client — `apps/builder/web/src/sse-client.ts` (COPY + prune nexus `sse-client.ts`)

Copy the connect/reconnect machinery **verbatim** (the `EventSource`, `onopen` reset-delay, `onerror` exponential backoff **with jitter** `reconnectDelay * (0.7 + Math.random()*0.6)`, `waitingForInit` stale-suppression guard, the returned teardown closure). **Prune** the ~21 nexus-only event listeners (`restart:*`, `pipeline:*`, `workflow:progress`, `session:sync-status`, `dev:build:*`, `git:status-changed`, `permission:*`, `task:handoff`) down to **this app's events only**: `init`, `task:update` (status/phase/gate), `phase:output` (streamed Claude text), and `gate` (inline-button actions) — match whatever event names task 2's `broadcast` emits, keep them consistent. Drop `withCredentials`/`clientId`/cookie auth (no auth layer here). On reconnect, after `init`, the store re-fetches `GET /api/tasks/:id` (AC #22) — wire that in the store, not here.

### 4. Slim store + api client — `apps/builder/web/src/{store.ts,api.ts}` (MINE fragments, ~250–350 + ~150–200 LOC)

Do **not** copy nexus's 981-LOC `store.ts` / 688-LOC `api.ts`. Author a slim signals store + api client:
- `api.ts`: `request()`/`qs()` helpers; `createTask(body)` → `POST /api/tasks`; `getTask(id)` → `GET /api/tasks/:id`; `confirm(id, actionId)` → `POST /api/tasks/:id/confirm`; `reply(id, text)` → `POST /api/tasks/:id/reply`; `cancel(id)` → `POST /api/tasks/:id/cancel`; `putSpec(id, content)` → `PUT /api/tasks/:id/spec`; `tree()` → `GET /api/tree`; `seeds()` → `GET /api/seeds`. A `409` from `createTask` must surface as a "build already running" UI state (AC #21 — backend half exists from Lát 3; render it here).
- `store.ts`: `@preact/signals` for `tree`, `activeTask`, `messages`, `phase`, `gate`, `connected`. Wire `connectSSE` handlers → signal updates. On `onReconnect`/disconnect-recover, call `api.getTask(activeTask.id)` and overwrite phase/status/gate from the authoritative response (AC #22). Keep it dumb: the store never decides gate logic, it renders what the backend sends.

### 5. Chat region (center) — copy near-verbatim

- `ChatMessage.tsx` — copy + adapt. **Keep** the bubble/activity-bar shell. **Drop** synced-IDE/file-link/pins imports (`openFileInIDE`, `renderTextWithFileLinks`, `getTaskPinnedChips`, `BlockToolbar`, `QuoteChips`, `TaskEventLog`) — they pull in nexus store + types you don't have. **Swap** the `renderMarkdownHtml` import (from `lib/markdown.ts`) for the slim renderer from task 8.
- Input host = the design's **`Composer`** (DESIGN OVERRIDE), which puts the `SettingChip` row **below** the input (AC #14) — **not** nexus `ChatInputBar.topSlot` (that renders *above*). Take from nexus `_chat/ChatInputBar.tsx` only the **controlled-input logic** (`value/onChange/onSend/sendDisabled`); the markup/placement come from `Composer`. Drop the `image`/multimodal props.
- `hooks/useChatReply.ts` — **copy near-verbatim**; **drop** the `UploadedImage`/`revokeImagePreviews`/`image-upload` pieces (no image upload in this app) — keep text draft persistence keyed by task id.
- Inline **gate buttons** (render into the design's **`GateCard`** — DESIGN OVERRIDE): render the backend's `gate.actions[] = {id,label,kind,route}` (spec §D) as a button row inside the thread at `awaiting_confirm`. Map **all three** `kind` values Lát 3 emits: `kind:'confirm'` → `api.confirm(id, action.id)`; `kind:'reply'` (composer-focus) → focus the input → `api.reply(id, text)`; **`kind:'cancel'`** (e.g. the still-failing gate's **Abandon**) → `api.cancel(id)`. Phase-④ **Import** button only shows when `deploy≠none` (AC #16; backend sends the action — just render it).

### 6. Run-settings-below-input + seed/workflow picker — NET-NEW (spec §B region 2, AC #14)

This is **not** in nexus (its run settings live in a modal). It is the design's `SettingChip` row **inside the `Composer`, below the input** (DESIGN OVERRIDE / AC #14 — not above via `topSlot`):
- Three selectors only: `Workflow ▾` (default `none`; lazily lists this project's workflows from `/api/tree` when opened — `none` = new workflow), `Confirm mode ▾` (default `confirm each step` | `confirm at spec only` | `auto`), `Deploy ▾` (default `none` | `selfhost` | `cloud`). **No model picker, no pattern picker** (AC #14 — explicitly forbidden).
- **Seed picker**: a list from `api.seeds()` (`GET /api/seeds`). The backend (`/api/seeds`) lands fully in Lát 5; until then it **degrades to an empty list** (the endpoint returns `{seeds:[], note:...}` when creds absent — spec Endpoints). Build the UI to render empty gracefully; do not block on Lát 5.

### 7. Phase timeline — REWRITE `PipelineTimeline.tsx` (NOT a copy)

nexus's `PipelineTimeline.tsx` is **poll-driven** (it calls `api.tasks.pipelineTimeline(taskId)` every 5s and renders a variable-length `data.phases[]`, 5-phase doc example). Rewrite it as **SSE-driven, fixed 4-phase**:
- Reuse the **visual** `PhaseBlock` render + `formatDuration` helper (copy those two), but the data source is the store's `phase` signal (fed by SSE `task:update`), **not** a polling `useEffect`/`setInterval` fetch.
- Fixed 4 phases: `① Analyze · ② Spec · ③ Implement · ④ Test` (spec §C). Map the backend phase id → one of these 4 fixed blocks; mark current/done/error from the SSE status. Delete the `api.tasks.pipelineTimeline` call and the 5s poll entirely.

### 8. Markdown — SWAP `markdown.ts` (do NOT bring the 888-LOC renderer)

nexus `lib/markdown.ts` is **888 LOC** and imports `marked` + `DOMPurify` + `highlight.js` (verified). **Do not bring it or those deps.** Write `apps/builder/web/src/lib/markdown.ts`, **~80–150 lines**, that renders the streamed Claude text the chat shows: paragraphs, fenced code blocks, inline code, bold/italic, headings, lists, links. Escape HTML by default (no DOMPurify needed if you build the DOM via text nodes / a tiny escaper rather than `innerHTML` of untrusted input). Expose the call shape `ChatMessage` expects — nexus's `renderMarkdownHtml(text, workingDir)` is **2-arg** (ChatMessage.tsx calls it with `workingDir` at ~:147/:155), so make the slim renderer `renderMarkdownHtml(text: string, _workingDir?: string): string` (accept and **ignore** the 2nd param — the file-link feature that used it is dropped), so the ChatMessage copy compiles unchanged. (Or drop the `workingDir` arg from ChatMessage's two call sites.)

### 9. Diff panel — copy near-verbatim

- `lib/diff-parser.ts` (327 LOC) — **copy verbatim** (`parsePatch`, `buildSplitRows`, `computeWordDiff`, the `ParsedDiff`/`DiffHunk`/`SplitRow` types). Pure, language-agnostic.
- `SplitDiffView.tsx` (~120 LOC) — **copy verbatim**; it imports `FileChange` from nexus `shared/types.ts` → define a local `FileChange` type `{path,status,additions,deletions,diff,oldPath?}` (verified shape) in your web `src/types.ts` and point the import there.
- The backend produces the diff `{path, diff}` in **Lát 5**; until then the panel renders only when a diff payload is present (degrade to "no diff yet"). AC #4's render half lives here; the diff *producer* is Lát 5.

### 10. Inline permission prompt — REWIRE `InlinePermissionPrompt.tsx`

Copy the **visual shell** (header / risk class / live elapsed timer / expand-command / the `approval-menu-btn` 2-col button grid). **Rewire the actions**: nexus calls `approvePermission`/`denyPermission`/`sessionApprovePermission` from its store (an **in-band** gate-token model that does NOT apply here — spec References). Under **MODEL C** the backend spawns with `--permission-mode acceptEdits`, so routine tool calls never prompt (AC #16). This component is used **only** for the app's **out-of-band gate** (and the Phase-④ Import confirm): wire its approve/deny buttons to `api.confirm(taskId, actionId)` / focus-composer → `api.reply`. Strip `store.js` permission imports entirely.

### 11. Sidebar tree — NET-NEW (`TaskList.tsx` grouping is a reference, not a copy) + `/api/tree`

- **Backend** `GET /api/tree` (spec Endpoints): scan `projects/*/.dify-workspace.yaml`, read the **`project.group`** sub-key inside the `project:` mapping (spec §Data model). Group `projects/<slug>/` folders sharing the same `group` under one **Project** row; **ungrouped → each slug is its own Project row** (group defaults to the slug — §Revision Frontend model). Under each Workflow (`projects/<slug>/`), list its Tasks from `apps/builder/.runs/`. Return a 3-level tree. **Read `.dify-workspace.yaml` with a YAML parser; treat `project:` as a mapping** — never write a scalar `project:` (it crashes `regen_vscode_settings.py`, spec §Data model; you only **read** here so this is just a caution).
- **Frontend** sidebar: reuse nexus `TaskList.tsx`'s **expand/collapse + grouping render pattern** (`groupByConversation`/`groupByProject` shape) as a structural reference, but **rewrite the grouping key** from nexus's `conversation_id`/`working_dir`/worktree classification to **`project.group → projects/<slug>/ → .runs task`**. Strip all worktree/issue/git refs. Hovering a Project row shows **only a "+" (New task)** — no gear (AC #13). Clicking a task opens its conversation; a **static breadcrumb** shows project (new task) or `project ▸ workflow ▸ title` (reopened) — not auto-updated mid-run.

### 12. Artifact panel (right) + SPEC.md editor — NET-NEW + `PUT /api/tasks/:id/spec`

- **Backend** `PUT /api/tasks/:id/spec` (spec Endpoints + §Revision Cleanups): persist an in-place `SPEC.md` edit. Write to `.runs/<taskId>/SPEC.md` (no-slug task, pre-scaffold) or `projects/<slug>/SPEC.md` (slug known) — **same path the §A gate-check uses**. Explicit Save, **last-writer** policy: Implement (③) re-reads `SPEC.md` at phase start, so a manual edit wins (AC #3 tail). The `PUT` body is the raw markdown content.
- **Frontend** artifact panel (slides in): renders `SPEC.md` (phase ②, **editable in place** with an explicit Save → `api.putSpec`), `main.yml` + lint results (phase ③), the diff (`SplitDiffView`, task 9), and the final report (phase ④, with `app_url` when deploy≠none). The SPEC.md editor is a plain `<textarea>` + Save button (no rich editor — keep it minimal).

### 13. `/health` gate (AC #1) — confirm/extend

`/health` must return **non-OK with a clear message** if `${DIFY_PROJECTS_DIR}/.venv/bin/python` or `skills/` is missing (spec §F, AC #1). This likely exists from Lát 1; if not, add it. Do not duplicate — read `apps/builder/server` first.

### 14. Build, boot, verify

```bash
npm --prefix apps/builder install                 # backend deps (if new ones added, e.g. @fastify/static)
npm --prefix apps/builder/web install
npm --prefix apps/builder/web run build           # produces web/dist (tsc --noEmit passes)
# boot the server (it serves web/dist at /):
BUILDER_PORT=4123 npm --prefix apps/builder start &   # or the repo's documented start cmd
sleep 2
curl -sS localhost:4123/health                    # OK (since .venv + skills exist); kill .venv path mentally to confirm the non-OK branch
curl -sS localhost:4123/api/tree | head -c 400     # 3-level tree grouped by project.group
```
Then open `http://127.0.0.1:4123` and walk a full 4-phase run by clicking the inline gate buttons (Confirm mode = `confirm each step`, Deploy = `none`); confirm the 3 regions render, the timeline advances through ①–④, the SPEC.md panel edits round-trip via `PUT` and the edit is reflected in Implement, and dropping/reopening the SSE stream restores the current phase/gate.

Dev loop (optional, for iterating): `npm --prefix apps/builder/web run dev` (Vite on its own port, proxying `/api` → 4123).

## Acceptance

Map each to the spec's AC #N (verify before committing):

- [ ] **AC #1** — `cd apps/builder && npm install && (cd web && npm install && npm run build) && npm start` boots and serves the **built** UI (dev: `npm run dev`); `/health` returns **non-OK with a clear message** if `.venv/` or `skills/` is missing.
- [ ] **AC #2 (UI half)** — a seed picker UI lists apps from `/api/seeds` and feeds Phase ① on selection (degrades to empty list until the Lát 5 backend; UI renders empty gracefully).
- [ ] **AC #3** — Phase ② SPEC.md renders in the artifact panel, is **editable in place**, Save → `PUT /api/tasks/:id/spec` persists it, and a manual edit is reflected in Implement (last-writer).
- [ ] **AC #4 (render half)** — Phase ③ shows `main.yml` + lint results and a diff (`SplitDiffView`); when no seed, the full `main.yml` / pattern diff (diff producer is Lát 5 — render-only here).
- [ ] **AC #13** — sidebar = `projects/` as a **Project ▸ Workflow ▸ Task** tree grouped by `project.group` (ungrouped = own row); hovering a Project shows **only "+"**; breadcrumb is static.
- [ ] **AC #14** — run settings sit **below the chat input** (no modal): **Workflow / Confirm mode / Deploy only** — no model picker, no pattern picker; correct defaults (`none` / `confirm each step` / `none`); `Workflow` lazy-lists.
- [ ] **AC #16** — every confirm/approve is an **inline gate button** in the thread; routine repo tools don't prompt (model C), while **Phase-④ Import keeps an explicit button when deploy≠none** (except `auto`).
- [ ] **AC #22** — dropping and re-opening `/stream` mid-build **restores the current phase/status/gate** via re-fetching `GET /api/tasks/:id` without losing the gate.
- [ ] A full 4-phase run is visible end-to-end through the UI (`confirm each step`, `deploy=none`).
- [ ] **No build logic in the UI** (spec §H) — the SPA only orchestrates/renders; all generate/validate/import stays backend-side.
- [ ] `npm --prefix apps/builder/web run build` passes `tsc --noEmit` (the build-time-safety reason Q2 chose this stack).
- [ ] No runtime dependency on claude-nexus — all copied code is **vendored** into `apps/builder/` (AC #11; you only copy, never import from the nexus checkout).

## On blocker

- **Lát 1–3 backend files missing/incompatible** (no `POST /api/tasks`/`/confirm`/`/reply` or no SSE hook) → STOP and report; do not re-implement the backend. This slice assumes the gated 4-phase backend exists.
- **`sse.ts` strip leaves a dangling Container/auth reference** → remove the whole DI surface; the builder is single-user localhost — there is no token to check. If unsure what an event payload field was for, drop it (the spec's `init` is minimal: `{reconnected}` + a `getTask` re-fetch).
- **A nexus component pulls a deep dependency chain** (store types, `shared/types.ts`, `event-format`, `file-links`) → prefer **dropping the feature** over vendoring the chain (e.g. drop pins/IDE/quote-chips from `ChatMessage`). Keep the vendored surface minimal.
- **`/api/seeds` or the diff producer isn't ready** (they're Lát 5) → render the empty/absent state gracefully; do not block this slice on Lát 5.
- **Vite/tsc strict errors from the copied nexus TS** → fix types locally (define the small local `FileChange`/event types in `web/src/types.ts`); do not loosen `strict` or add `// @ts-nocheck`.

## Guardrails

- **UI is a dumb renderer.** No gate decisions, no verify, no phase logic, no `claude` spawning, **no `sync.py`** in the frontend or its endpoints — Dify I/O stays backend-owned (token never reaches the browser or any UI endpoint).
- **All copied nexus code is vendored** into `apps/builder/` — never import across the repo boundary into `/Users/quyenbt/Desktop/MyProjects/claude-nexus` (AC #11). nexus is COPY-source, not a dependency.
- **Bind `127.0.0.1` only** (hardcoded; only `BUILDER_PORT` configurable) and apply the Origin/same-origin check on mutating POSTs (spec §J) — do not regress this from Lát 1–3.
- **Do not bring** `marked`/`DOMPurify`/`highlight.js`/`uplot`/the 888-LOC `markdown.ts` — the ~80–150-line renderer replaces them.
- **Confinement is unchanged**: your only new writes are under `apps/builder/`. Do not touch `tools/`, `skills/`, `.venv/`, `.claude/`, or any `projects/<slug>/` file except via the backend `PUT /api/tasks/:id/spec` path (which writes `SPEC.md` to the spec-defined location). Run `git status --porcelain` before committing and ensure every new path is under `apps/builder/`.
- **Spec-update ledger (Lát 4 row):** Lát 4 introduces no new ledger drift, but the plan's ledger says **"Confirm AC #13/#14 wording"** — if the implemented sidebar/settings UX diverges from the spec's AC #13/#14 text, update [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) to match (repo forbids silent drift). Also flip the `lat4-ui.md` row in [docs/specs/prompts/009/README.md](README.md) status to done.
- **Commit LOCAL only** after the acceptance checkboxes pass: branch first if on `main`, `git add apps/builder` (+ any spec/README ledger edits), commit. **Do NOT push. Do NOT `--no-verify`.** End the commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
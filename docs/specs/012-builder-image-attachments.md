# Spec 012 — Builder Image Attachments (Approach A: path-injection)

> Status: **Approved** · Owner: builder · Depends on: Spec 009 (Lát 0–6, merged), Spec 010 · Date: 2026-06-18 (rev. 2026-06-18 — open questions resolved, see §Open questions)
>
> Source: a user request to attach images to the builder's chat input — both when starting a build and
> when replying at a gate — so a screenshot (e.g. a desired workflow, a spreadsheet layout, a reference
> diagram) can be used to **confirm/clarify intent visually**. This spec scopes the **low-risk path-injection**
> approach (Approach A), deliberately *not* the full stream-json multimodal protocol (Approach B).

---

## Context

The builder's composer is a plain `<textarea>` ([web/src/components/Chat.tsx:330](../../apps/builder/web/src/components/Chat.tsx#L330));
the only payload sent is `requirement: string` ([web/src/api.ts:47](../../apps/builder/web/src/api.ts#L47)),
and the backend feeds the prompt to `claude` as **plain text over stdin**
([server/lib/claude-session.ts:116](../../apps/builder/server/lib/claude-session.ts#L116)). Multimodal was
**deliberately stripped** when porting from nexus — *"STRIPPED (not needed here): multimodal/images,
--input-format stream-json"* ([server/lib/claude-session.ts:16](../../apps/builder/server/lib/claude-session.ts#L16)).

Two approaches were evaluated:

- **Approach A (this spec)** — save the dropped image to the task's working dir and inject its **path** into
  the prompt. `claude` runs with `cwd = repo root` and `--permission-mode acceptEdits`, so it can `Read` the
  image file itself. No change to the SDK stdin protocol. ~1–1.5 day, low risk.
- **Approach B (deferred)** — restore the stripped `--input-format stream-json` multimodal content-block path
  (base64 image blocks), as nexus had it. Correct/canonical but reopens the deliberately-simplified
  spawn/stream core → regression risk. ~2–3 days. Out of scope here; see Non-goals.

Favorable facts that make A cheap: every task already owns a private dir
`apps/builder/.runs/<taskId>/` ([server/state/task.ts:140](../../apps/builder/server/state/task.ts#L140)),
and request bodies are already JSON — so small images can ride as base64 data-URLs with **no multipart**.

## Goals

- Attach 1–N images to a build via **drag-drop, paste, or file-picker** in the composer, with inline preview
  chips and per-image remove.
- Images flow on **two** turns: the initial build (`POST /api/tasks`) and the in-phase reply
  (`POST /api/tasks/:id/reply`) — the latter is what enables "confirm via image" at a gate.
- The backend persists each image under `.runs/<taskId>/uploads/` and injects its path into the prompt so
  the Analyze/Spec/Implement/reply turn can read it.
- No change to the `claude` stdin protocol; no new heavy dependency.

## Non-goals

- **Approach B** (stream-json base64 content blocks). Deferred; revisit only if inline multi-turn image
  reasoning is needed without files-on-disk.
- Image attachments on `POST /confirm` (the gate-advance turn carries no free text → no natural place for an
  image; use `reply` to attach + re-run instead).
- Server-side image processing (resize/OCR/thumbnails). The preview is a client-side `object-URL` only.
- Non-image attachments (PDF, etc.).

## Design

### Data flow (create + reply)

```
Composer (File[]) ──base64 data-URL──▶ api.createTask / api.reply
        │                                      │
   preview chips                         body.images: {name, mime, dataUrl}[]
        │                                      ▼
        └────────────────────────  POST /api/tasks  ·  POST /api/tasks/:id/reply
                                               │  (route: validate type/size/count)
                                               ▼
                              save → .runs/<taskId>/uploads/<n>_<safeName>
                                               │
                                    task.attachments: string[] (rel paths)
                                               ▼
                       phases.ts renderPrompt → append block to REQUIREMENT:
                       「添付画像:\n- <abs/rel path>\n…（必要なら Read で内容を確認）」
                                               ▼
                                   claude turn Reads the file(s)
```

### Touch points (6)

| # | File | Change |
|---|---|---|
| 1 | [web/src/components/Chat.tsx](../../apps/builder/web/src/components/Chat.tsx) `Composer` | drag-drop zone + `onPaste` + hidden `<input type=file>`; preview chips with remove; hold `File[]`→base64 |
| 2 | [web/src/store.ts](../../apps/builder/web/src/store.ts) / [App.tsx](../../apps/builder/web/src/components/App.tsx) | thread `images` through `send()` and `reply()` |
| 3 | [web/src/api.ts](../../apps/builder/web/src/api.ts) | add `images?: ImageAttachment[]` to `CreateTaskBody` and to `reply()` body |
| 4 | [server/routes/tasks.ts](../../apps/builder/server/routes/tasks.ts) | accept `images`, validate (type/size/count), save to `.runs/<taskId>/uploads/`, set `task.attachments` |
| 5 | [server/state/task.ts](../../apps/builder/server/state/task.ts) | add `attachments?: string[]` to `Task` |
| 6 | [server/lib/phases.ts](../../apps/builder/server/lib/phases.ts) | append `添付画像:` path block into the `REQUIREMENT` injection ([phases.ts:49](../../apps/builder/server/lib/phases.ts#L49)) |

### Decisions chosen (defaults; see Open questions for the few still open)

- **D1 Transport** — base64 data-URL inside the existing JSON body (no multipart). Per-image cap **10 MB**
  (aligned to Dify's image limit, Q1); reject larger with `400`. (Rationale: multipart adds a Fastify plugin
  for no gain; base64 inflates ~33% so a 10 MB image ≈ 13 MB body — keep Fastify's `bodyLimit` above that.)
- **D2 Flows** — `create` + `reply` only (not `confirm`).
- **D3 Prompt injection** — append a trailing block to `REQUIREMENT`:
  `添付画像:` then one bullet per saved path, with a one-line hint to `Read` the file if useful. Reply turns get
  the same block appended to the reply text.
- **D4 Accepted types + count** — `image/png`, `image/jpeg`, `image/webp`, `image/gif`; **max 3 images per turn**.
- **D5 Storage + lifecycle** — `.runs/<taskId>/uploads/<index>_<sanitized-name>`; lives and dies with the task
  dir (no separate cleanup job). Reply-turn images append (don't overwrite earlier ones).
- **D6 Filename safety** — sanitize to `[a-z0-9._-]`, prefix with a per-turn index to avoid collisions; never
  trust the client name for the path.

### Validation / failure modes

- Bad MIME, over-size, or >3 images → `400` with a clear `error` string (surfaced by `ApiError`).
- Image write failure → `500`; the task is **not** started (fail before `acquireTurn`).
- An empty `requirement` **with** images present is still rejected (text remains required) — images augment,
  not replace, the requirement. (Open Q2 may relax this.)

## Open questions

_All resolved 2026-06-18 → Status: Approved._

- **Q1 (resolved → 10 MB)** — Per-image cap aligned to Dify's image limit. Fastify `bodyLimit` must be raised
  to comfortably exceed `3 × 10 MB × 1.33` (base64 inflation) for the max 3-image turn.
- **Q2 (resolved → text still required)** — No image-only turn; images augment, never replace, the
  requirement/reply text, on every flow. Revisit only if it feels clunky in live testing.
- **Q3 (resolved → path list only)** — `task.json` stores just `attachments: string[]` (paths). Per-image
  size/mime metadata is YAGNI until there's a UI that needs it.

## Acceptance criteria

- **AC1** — Dragging an image onto the composer, pasting from clipboard, and the file-picker all produce a
  preview chip; each chip has a working remove.
- **AC2** — Starting a build with 1–3 images writes them to `.runs/<taskId>/uploads/` and the Analyze prompt
  contains the `添付画像:` path block; a manual run shows the model `Read` the file.
- **AC3** — Replying at a gate with an image re-runs the phase with the image path injected into the reply turn.
- **AC4** — Oversize / wrong-type / >3-images requests are rejected `400` with a readable message; the build
  does not start.
- **AC5** — Reconnect/refetch (`GET /api/tasks/:id`) still works; attachments survive a reload (paths persisted
  on the task).
- **AC6** — Unit tests: route validation (type/size/count → 400) and the `phases.ts` prompt-block injection are
  covered (extends the Spec 011 harness).

## References

- Spec 009 (browser workflow builder) — composer, gate, reply/confirm flows.
- Approach comparison (this conversation): A = path-injection (chosen), B = stream-json multimodal (deferred).
- nexus `claude-session` multimodal path — prior art for Approach B if/when revisited.

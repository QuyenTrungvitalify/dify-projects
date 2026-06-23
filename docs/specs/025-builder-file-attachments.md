# Spec 025 — Builder file attachments (generalize 012 image-attach to PDF + text family)

> Status: **Implemented** (2026-06-23 — open questions resolved per the recommendations below; see
> §Open questions) · Owner: builder · Depends on: [012](012-builder-image-attachments.md) (Approach A
> path-injection — this spec *generalizes* it), [015](015-builder-security-turn-sandbox.md) /
> [018](018-builder-turn-write-allowlist.md) (the PreToolUse hook + write-allowlist that bound an
> attached file's blast radius) · Effort: **S** · Date: 2026-06-23
>
> Source: a user request to extend the composer's attach feature beyond images — "kéo thêm các file khác"
> — so a reference can be a **PDF / CSV / text** file, not only a screenshot. Spec 012 deliberately listed
> *"Non-image attachments (PDF, etc.)"* as a **Non-goal** ([012:51](012-builder-image-attachments.md#L51));
> this spec closes that deferral.

---

## Context

Spec 012 shipped **Approach A (path-injection)**: the composer base64-encodes a dropped/pasted/picked file
into the existing JSON body; the route validates + writes it to `apps/builder/.runs/<taskId>/uploads/<n>_<safeName>`
and records the repo-relative path on `task.attachments`; the orchestrator appends those paths into the turn
prompt via `attachmentBlock`, and the `claude` turn (`cwd = repo root`, `--permission-mode acceptEdits`)
**`Read`s the file itself** ([server/lib/attachments.ts](../../apps/builder/server/lib/attachments.ts),
[orchestrator.ts:256](../../apps/builder/server/lib/orchestrator.ts#L256)).

The crucial observation: **this mechanism is type-agnostic.** The file's bytes never enter the prompt — only
its *path* does, and `claude`'s `Read` tool already parses far more than images:

- **text family** — `.txt`, `.csv`, `.tsv`, `.md`, `.json`, `.yaml`/`.yml`, `.log` → read as text;
- **PDF** — read via `Read`'s page-range support;
- images — already covered by 012.

So almost everything in 012 is reusable as-is. Only **four** things are image-specific today:

1. the accept-check keys on a fixed image-MIME allowlist
   ([attachments.ts:32](../../apps/builder/server/lib/attachments.ts#L32),
   [web/lib/attachments.ts:14](../../apps/builder/web/src/lib/attachments.ts#L14));
2. the extension is derived from a MIME→ext map ([attachments.ts:49](../../apps/builder/server/lib/attachments.ts#L49));
3. the composer preview renders `<img src={dataUrl}>` ([Chat.tsx:397](../../apps/builder/web/src/components/Chat.tsx#L397));
4. the injected header says `Attached images:` ([attachments.ts:157](../../apps/builder/server/lib/attachments.ts#L157)).

> **The one design wrinkle:** for non-image files the browser's `File.type` is **unreliable** — `.md` is often
> `''` or `text/markdown`, `.csv` can be `text/csv` *or* `application/vnd.ms-excel` *or* `''`, `.json` may be
> `''`. MIME-only validation (012's key) breaks. The fix is to **validate by file extension** (an allowlist)
> for non-images, keeping the proven MIME key for images. This is the bulk of the new logic.

## Goals

- Accept **PDF + the text family** (above) in the composer alongside images, via the *same* drag-drop / paste /
  file-picker, with a non-image **file chip** (icon + name) in the preview.
- Reuse 012's pipeline end-to-end: same JSON-body transport, same `.runs/<taskId>/uploads/` storage, same
  `task.attachments` paths, same `attachmentBlock` injection, same two flows (`create` + `reply`).
- Generalize the accept-check to **extension-allowlist (non-images) OR MIME-allowlist (images)**; derive the
  saved extension from the (sanitized, allowlisted) original filename when it is not an image.
- Generalize the injected header to `Attached files:` and keep the untrusted-DATA caveat (§Security).
- No change to the `claude` stdin protocol; no multipart; no new dependency.

## Non-goals

- **Binary office formats** — `.docx`, `.xlsx`, `.pptx`. `Read` cannot parse them (they are zipped XML), so
  path-injection yields nothing readable. They need server-side extraction → out of scope (revisit as a
  separate spec if requested; would be Approach-B-shaped effort).
- **Server-side processing** — no OCR, no PDF-text-extraction, no CSV parsing on the server. The turn does its
  own reading, exactly as 012.
- **Attachments on `POST /confirm`** — unchanged from 012 (gate-advance carries no free text; use `reply`).
- **`--input-format stream-json` multimodal blocks** (012's deferred Approach B) — still deferred.
- Re-architecting the wire field name *as a blocker* — see Open Q1 (a clean optional rename, not required to ship).

## Design

### Data flow

Identical to 012 — only the *gates* widen. The `Composer (File[]) → base64 → validate → save → path-inject →
claude Reads` chain is unchanged; the validator now admits PDF/text by extension and the prompt header is generic.

### Touch points (≈6, all existing 012 seams)

| # | File | Change |
|---|---|---|
| 1 | [server/lib/attachments.ts](../../apps/builder/server/lib/attachments.ts) | add an **extension allowlist** + `accept(name, mime)` = image-MIME-ok OR ext-in-allowlist; derive `ext` from the original name for non-images; `attachmentBlock` header → `Attached files:` (+ a one-line "for PDFs, use Read's page range" hint). Per-file cap + count stay; rename internal `*Image*` → `*Attachment*` symbols (D-rename). |
| 2 | [server/routes/tasks.ts:137,294](../../apps/builder/server/routes/tasks.ts#L137) | none structurally — just the renamed validator name; the 400/500 handling is unchanged. |
| 3 | [web/src/lib/attachments.ts](../../apps/builder/web/src/lib/attachments.ts) | mirror the accept-check (ext OR image-MIME) for the immediate client guard; keep `dataUrl` transport. |
| 4 | [web/src/components/Chat.tsx:392-440](../../apps/builder/web/src/components/Chat.tsx#L392) | `<input accept>` += the new types; preview chip: image → thumbnail, else → **file icon + name** (no `<img>`); drop-hint/aria/i18n text "images" → "files". |
| 5 | [web/src/api.ts:48](../../apps/builder/web/src/api.ts#L48) | (optional, Open Q1) rename `ImageAttachment`→`Attachment` / `images`→`files`; otherwise no change. |
| 6 | [apps/builder/test/attachments.test.ts](../../apps/builder/test/attachments.test.ts) | **update** the `unsupported MIME (pdf …) → error` case (pdf is now *accepted*; keep `''`/disallowed-ext rejected) + add: accept-by-ext (pdf/csv/txt/md), reject-by-ext (exe/zip), non-image ext-derivation. |

### Decisions (defaults; the few open ones are below)

- **D1 Accept set** — images (unchanged MIME allowlist) **+ extension allowlist** `pdf, txt, csv, tsv, md,
  markdown, json, yaml, yml, log`. Rationale: exactly the set `claude`'s `Read` can turn into useful tokens.
- **D2 Validation key** — *non-images validate by the original filename's extension* (lower-cased, allowlisted),
  not by MIME (unreliable, §Context). Images keep the MIME key. A file matching neither → `400`.
- **D3 Extension derivation** — for an image, the MIME→ext map (unchanged); for a non-image, the allowlisted
  extension parsed off the (sanitized) original name. `sanitizeName` already strips paths / forces a final
  extension — generalize it to take the derived ext instead of an image-only one.
- **D4 Caps** — keep **per-file 10 MB** and **max 3 files per turn** (012's `MAX_IMAGES`→`MAX_ATTACHMENTS`).
  `BODY_LIMIT_BYTES` (64 MiB) already dominates `3 × 10 MB × 4/3` with headroom — unchanged; the existing
  unit-pin in `attachments.test.ts` still holds.
- **D5 Prompt block** — `Attached files:` + per-path bullets + the `Read` hint; append a clause: *"for a PDF,
  pass a page range to `Read`."* The untrusted-DATA caveat is **kept and strengthened** (§Security).
- **D6 Storage / lifecycle / filename safety** — unchanged from 012 (`<index>_<safeName>`, append-on-reply,
  lives/dies with the task dir, never trust the client path).
- **D7 (rename)** — generalize `*Image*` identifiers to `*Attachment*`/`*File*`. Mechanical; no external API
  consumers (single-user localhost app; `task.attachments` is *already* generically named). See Open Q1.

### Validation / failure modes

- Disallowed extension / non-image-MIME-and-no-allowed-ext / oversize / >3 files → `400` with a readable
  `error` (same surface as 012, via `ApiError`).
- Write failure → `500`; the task is **not** started (fail before `acquireTurn`) — unchanged.
- Empty `requirement`/reply text with files present is still rejected (text remains required; 012 Q2) — files
  augment, never replace, the requirement.

## Security (why this needs an explicit note that 012 mostly elided)

A text/CSV/PDF attachment is **far more prompt-injectable** than an image: its full contents become readable
tokens the moment the turn `Read`s it (no OCR step to blunt it). So the untrusted-DATA framing matters more
here. As in [015](015-builder-security-turn-sandbox.md), **the framing is not the defense** — the PreToolUse
hook + the [018](018-builder-turn-write-allowlist.md) write-allowlist are: even a fully-steered turn cannot read
the deploy token or write outside its roots. This spec adds *no new capability* to the turn (it already runs
`acceptEdits` and can `Read` any file under the repo); it only adds a *convenient on-ramp* for the user to put a
chosen file in front of it. Net new attack surface ≈ the bytes the user themselves dropped. The caveat clause in
`attachmentBlock` stays, reworded for "files."

## Open questions

_All resolved 2026-06-23 → Status: Implemented (each took the recommended answer)._

- **Q1 (rename scope) → did the rename.** `ImageAttachment`→`Attachment`, the wire field `images`→`files`,
  `validateImages`→`validateAttachments`, `MAX_IMAGES`→`MAX_ATTACHMENTS`, `ComposerImage`→`ComposerAttachment`,
  `isAcceptedImage`→`isAcceptedFile`, i18n `attachImage`/`removeImage`/`dropImages`→`attachFile`/`removeFile`/
  `dropFiles`. No external consumers (single-user localhost), so client + server renamed together in one diff.
- **Q2 (per-type caps) → one 10 MB cap for all** (`MAX_ATTACHMENT_BYTES`). Bump only if a real PDF is rejected.
- **Q3 (text allowlist breadth) → shipped the D1 set** (`pdf, txt, csv, tsv, md, markdown, json, yaml, yml, log`).
  Widen on demand (`.html`/`.xml`/`.ipynb` are the obvious next candidates).
- **Q4 (svg) → left rejected.** `image/svg+xml` is not an accepted image MIME and `svg` is not in the ext
  allowlist, so it fails both keys (it can carry script and isn't a useful build reference).

## Acceptance criteria

- **AC1** — Dragging / pasting / picking a **PDF, CSV, TXT, or MD** file produces a non-image **file chip**
  (icon + name) with a working remove; an image still shows its thumbnail.
- **AC2** — Starting a build with a mixed set (e.g. 1 image + 1 CSV) writes both to `.runs/<taskId>/uploads/`,
  preserves each correct extension, and the Analyze prompt's `Attached files:` block lists both paths.
- **AC3** — Replying at a gate with a PDF re-runs the phase with the PDF path injected; a manual run shows the
  model `Read` it.
- **AC4** — A disallowed file (e.g. `.exe`, `.zip`, or an unknown-extension blob) and an oversize/>3-file turn
  are rejected `400` with a readable message; the build does not start.
- **AC5** — Reconnect/refetch (`GET /api/tasks/:id`) still works; attachments survive a reload.
- **AC6** — Unit tests updated + extended (touch-point 6): accept-by-ext for pdf/csv/txt/md, reject-by-ext for
  exe/zip, non-image ext-derivation, and the existing `BODY_LIMIT`/`sanitizeName` pins still pass.

## References

- [012](012-builder-image-attachments.md) — the image-attach spec this generalizes (Approach A path-injection);
  closes its "Non-image attachments (PDF, etc.)" Non-goal.
- [015](015-builder-security-turn-sandbox.md) / [018](018-builder-turn-write-allowlist.md) — the confinement
  that makes admitting more file types safe.
- `claude` `Read` tool — parses text, code, PDF (page-ranged), images, notebooks; *not* docx/xlsx/pptx (the
  Non-goal boundary).

# T01 — Smoke: boot, empty state, sidebar tree, run-settings defaults

> Single source of truth for every on-screen string: [00-README](00-README.md) (§4 String Dictionary). Assert dictionary values **verbatim** — never normalize the ellipsis `…`, middot `·`, arrow `▸`, em dash `—`, or `≠`.

| Field | Value |
|---|---|
| **ID** | T01 |
| **Title** | Smoke: boot, empty state, sidebar tree, run-settings defaults |
| **Traces to** | AC#1 (boots + serves built UI) · AC#13 (sidebar = `projects/` tree) · AC#14 (settings below input; Workflow/Confirm/Deploy only; no model/pattern picker; defaults) · AC#2 (seed picker empty-state) |
| **Priority** | P0 |
| **Cost** | 0 real build-turns (read-only — starts no build) |

This is a pure **read-only** smoke test. It clicks nothing that spawns a `claude` turn and starts no build, so there is no model spend and no per-turn waiting. It exists to certify the app boots, serves the built SPA, and renders the empty state, sidebar, and run-settings defaults correctly **before** any costly test runs.

---

## Preconditions

1. App is running and serving the built UI at **http://127.0.0.1:4123** (host is hardcoded to `127.0.0.1`; only the port is overridable via `BUILDER_PORT`). See [00-README](00-README.md) §1.1.
2. A clean app: **no build in progress**. On a clean checkout the sidebar should have **no** `In progress` section. If an `In progress` section is present, a prior test left a parked build — that is acceptable for this read-only test (it only changes the AC#13 expectation noted in Step 6), but record it.
3. The browser agent can already see the loaded SPA (Preact); there is **no login wall** (localhost single-user app).

> **STOP + report** if: the page fails to load, shows a blank screen, shows a raw JSON/error body, or shows a dev-server "module not found" overlay (that would mean the UI was **not** built — AC#1 fail). Capture a screenshot and the exact text seen.

> The `/health` half of AC#1 (non-OK when `.venv/`/`skills/` missing) is a CLI check — see **App‑CLI‑1** in the [00-README](00-README.md#appendix-not-browser-testable) appendix. This file covers the browser half: "boots + serves the built UI".

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. No step here advances a build turn, so timeouts are short (page render only).

### Step 1 — Boot & serve the built UI (AC#1)
1. **observe:** a fresh browser tab.
2. **act:** navigate to `http://127.0.0.1:4123`.
3. **wait (≤15 s):** until the SPA has rendered — i.e. the composer text area and the left sidebar are both visible.
4. **assert:**
   - The page rendered a real UI (not a blank page, not raw JSON, not a build-error overlay).
   - The top-bar header (empty state) shows the static label **`New task`** (rendered in `view !== 'conversation'`; App.tsx:149).
   - **STOP + report** if any of the boot-failure symptoms in Preconditions appear.

### Step 2 — Empty-state composer placeholder (AC#1 render)
1. **observe:** the central composer text area in the empty state.
2. **act:** none (read-only).
3. **wait (≤5 s):** until the text area is present.
4. **assert:** the composer placeholder is exactly:
   - `Describe the workflow or change…` (App.tsx:300 — note the trailing single-character ellipsis `…`, **not** three periods).

### Step 3 — Empty-state crumb (AC#13)
1. **observe:** the breadcrumb button directly above the composer in the empty state.
2. **assert:** the crumb shows exactly **`New task`** (App.tsx:295) — a single static crumb, with **no** Project/Workflow path segments (the empty-state crumb is static; AC#13).

### Step 4 — Run settings sit BELOW the input as three chips ONLY (AC#14)
1. **observe:** the row directly **below** the composer text area (the `composer-row`).
2. **act:** none yet.
3. **wait (≤5 s):** until the chip row renders below the input.
4. **assert — placement:** the settings chips are positioned **below** the chat input, not above it and not in a separate toolbar (AC#14: "settings below input").
5. **assert — exactly three setting chips, with these labels and default values:**

   | Chip label (verbatim) | Default value shown | Source |
   |---|---|---|
   | `Workflow` | `none (new)` | Chat.tsx:344, 334 |
   | `Confirm` | `each step` | Chat.tsx:347, 348 |
   | `Deploy` | `none` | Chat.tsx:351, 352 |

   The chip renders as `label:` + value (e.g. `Workflow:` then the value `none (new)`; App.tsx renders `{label}:`). Assert the **label** text and the **default value** text both match exactly.
6. **assert — Confirm options:** open the `Confirm` chip dropdown; it lists exactly three options, verbatim:
   - `each step` · `spec only` · `auto` (Chat.tsx:348). Default (pre-selected) is `each step`.
   - Then **close the dropdown without changing the selection** (read-only — do not pick a different option; leaving it changed would not start a build but would dirty the default for any later reuse).
7. **assert — Deploy options:** open the `Deploy` chip dropdown; it lists exactly three options, verbatim:
   - `none` · `selfhost` · `cloud` (Chat.tsx:352). Default is `none`.
   - **Close without changing the selection.**
8. **assert — Workflow options:** open the `Workflow` chip dropdown; the first/default option label is `none (new)` (Chat.tsx:334). On a fresh repo it may also lazily list existing workflow slugs from `/api/tree` (e.g. `workflow_start_node_one`) — those are data-dependent, so do **not** assert any specific slug; only assert the `none (new)` default option is present and selected. **Close without changing.**

### Step 5 — AC#14 NEGATIVE: no model picker, no pattern picker
1. **observe:** the entire composer area and the chip row.
2. **act:** none.
3. **assert (negative):** there is **NO** model picker and **NO** pattern (template) picker anywhere in the composer or its settings row. The only chips are the three named in Step 4 (`Workflow`, `Confirm`, `Deploy`).
   - Concretely: there is no chip/select labelled with a model name (e.g. no `Model`, `claude-…`, `Opus`/`Sonnet`/`Haiku`), and no chip/select labelled `Pattern`/`Template`.
   - **FAIL** if any fourth setting chip exists, or if any control offers a model or pattern choice. Capture a screenshot and quote the offending control's exact label.

### Step 6 — Sidebar tree (AC#13)
1. **observe:** the left sidebar (`aside.sidebar`).
2. **act:** none yet (no clicks that start a build).
3. **wait (≤5 s):** until the sidebar header and tree render.
4. **assert — header & actions (verbatim):**
   - Sidebar heading: `Projects` (Sidebar.tsx:161).
   - A top-level button **`New task`** (the `sb-newtask` button; Sidebar.tsx:168).
   - A **`New project`** action (icon button, `title="New project"`; Sidebar.tsx:163). Verify by reading its `title` attribute / hover tooltip — it shows `New project`.
5. **assert — tree shape (Project ▸ Workflow ▸ Task):**
   - The tree lists each folder under `projects/` as a **Project** row (folder icon).
   - Expanding a Project reveals **Workflow** rows; expanding a Workflow reveals its **Task** rows. This is the `Project ▸ Workflow ▸ Task` tree (the `▸` is the disclosure twist).
   - Do **not** assert specific project/workflow names (data-dependent on `projects/` contents). Only assert the **nesting shape** is Project → Workflow → Task.
6. **assert — hover reveals "New task in this workflow":**
   - Hover a **Workflow** row; a `+` icon button appears in its `row-actions` whose `title` is exactly `New task in this workflow` (Sidebar.tsx:50). Verify the tooltip/title text; **do not click it** (clicking opens a new-task composer but starts no turn — still, leave state untouched).
   - Hover a **Project** row; its `+` icon button `title` is exactly `New task` (Sidebar.tsx:79). (AC#13: project hover shows only `+` New task — no gear.)
7. **assert — empty states (where applicable):**
   - If there are **no** projects, the tree shows exactly `No projects yet` (Sidebar.tsx:173).
   - A Workflow with no tasks shows exactly `no tasks yet` (Sidebar.tsx:55).
   - (These render only when the corresponding collection is empty — assert only the one(s) that apply to the current `projects/` state; omit gracefully otherwise.)
8. **assert — In progress (clean app):** on a clean app there is **no** `In progress` section. If one **is** present (a parked build from a prior test), its header is exactly `In progress` (Sidebar.tsx:127) and each row shows the status hint `gate` (awaiting_confirm) or `running` (Sidebar.tsx:96, 132) with a hover-× whose title is `Cancel this build` (Sidebar.tsx:134). Record its presence but do **not** cancel it here (that is T08's job).

### Step 7 — Seed picker empty-state (AC#2)
1. **observe:** the `SEED FROM` section in the empty state (below the composer + start-error banner).
2. **act:** none.
3. **wait (≤5 s):** until the seed section renders.
4. **assert — section label:** exactly `SEED FROM` (App.tsx:307).
5. **assert — empty-state copy (no Dify creds):** when there are no seed apps, the section shows exactly:
   - `No seed apps — connect Dify to seed from a workspace app (Lát 5). New workflows start from scratch.` (App.tsx:310 — note the em dash `—`, the Vietnamese `Lát`, and the literal `(Lát 5)`).
   - In this empty case the `none` seed **chip is not rendered** (the chip list only renders when `seeds.length > 0`; App.tsx:312–321). So assert the empty copy is shown and a seed-chip list is **absent**.
6. **assert — Suggestions section:** below the seed picker, a section labelled exactly `TRY` (App.tsx:325). It lists suggestion rows whose **text is data-driven** (from `../data`) — do **NOT** assert any specific suggestion string (none is in the dictionary). Assert only that the `TRY` label is present and ≥1 suggestion row renders.

> **Note (App‑CLI‑2):** the *with-creds* case — where `SEED FROM` lists real Dify apps (a `none` chip plus one chip per app) — is verified by **App‑CLI‑2** in the [00-README](00-README.md#appendix-not-browser-testable) appendix, not here.

---

## Expected

All of the following hold simultaneously (every quoted string is **exact**, verbatim from the dictionary):

- **Boot (AC#1):** the app at `http://127.0.0.1:4123` serves a rendered SPA; empty-state header label is `New task`; no blank page / raw JSON / build-error overlay.
- **Composer (AC#1):** placeholder is `Describe the workflow or change…` (single `…`).
- **Crumb (AC#13):** static empty-state crumb is `New task`.
- **Settings (AC#14):** exactly three chips **below** the input — `Workflow` = `none (new)`, `Confirm` = `each step`, `Deploy` = `none`.
  - Confirm options: `each step` / `spec only` / `auto`.
  - Deploy options: `none` / `selfhost` / `cloud`.
  - Workflow default option: `none (new)`.
- **No pickers (AC#14 negative):** no model picker and no pattern picker anywhere; no fourth setting chip.
- **Sidebar (AC#13):** heading `Projects`; `New task` button; `New project` action; `Project ▸ Workflow ▸ Task` tree; workflow-row hover reveals `New task in this workflow`; project-row hover reveals `New task`; empty states `No projects yet` / `no tasks yet` where applicable.
- **Seed picker (AC#2):** label `SEED FROM`; no-creds copy `No seed apps — connect Dify to seed from a workspace app (Lát 5). New workflows start from scratch.`; suggestions label `TRY`.

---

## Negative / edge variants

1. **Reload persistence (empty state):** with no build in progress, reload the page (`http://127.0.0.1:4123`). **Wait (≤15 s)** for re-render. **Assert** the empty state renders again identically (composer placeholder `Describe the workflow or change…`, the three default chips, `SEED FROM`, `TRY`). The empty state is the default view on a clean app.
2. **Connection dot is conversation-only:** the connection dot with title `Live` / `Reconnecting…` (App.tsx:157) renders **only** when `view === 'conversation'` (an opened build). In the **empty state it is NOT present** — do **NOT** assert a `Live` dot on the empty-state smoke screen; asserting its presence here would be a false expectation. (Its `Live` value is asserted in the conversation-view tests, e.g. T02/T06, after a build is opened.)
   - TODO: if a future build wants a boot-time `Live`/online indicator on the empty state, no such string exists in the dictionary yet — omit rather than invent.
3. **Negative seed chip:** in the no-creds empty case, assert the `none` seed chip (App.tsx:314) is **absent** (chip list renders only when `seeds.length > 0`). Seeing a stray `none` chip alongside the "No seed apps" copy is a FAIL.
4. **No In-progress on clean app:** assert no `In progress` section on a clean app (see Step 6.8). If present from a prior test, it is informational only — do not cancel here.

---

## Pass / Fail

**PASS** — binary, all must hold:
- App boots and serves the rendered SPA at `http://127.0.0.1:4123` (no blank/JSON/build-error overlay).
- Every exact string in **Expected** matches character-for-character (including `…`, `—`, `▸`, `·`, `Lát`).
- Exactly three setting chips below the input with the stated defaults and options; **no** model picker and **no** pattern picker; no fourth chip.
- Sidebar shows `Projects`, `New task`, `New project`, the `Project ▸ Workflow ▸ Task` tree, hover tooltips `New task in this workflow` (workflow) and `New task` (project), and the correct empty states.
- Seed picker shows `SEED FROM` + the exact no-creds copy + `TRY`.
- Reload re-renders the empty state identically.

**FAIL** — any of:
- Boot failure (blank page, raw JSON, dev-server overlay → UI not built, AC#1 fail).
- Any quoted string differs (paraphrase, normalized punctuation, three-dot `...` instead of `…`, missing `Lát`, etc.).
- A model picker, pattern picker, or any fourth setting chip is present (AC#14 fail).
- Settings sit above the input rather than below it.
- Sidebar missing `Projects`/`New task`/`New project`, wrong tree nesting, or wrong/absent hover tooltips.
- Seed empty copy missing/wrong, or a stray `none` chip shown in the empty case.

**Evidence on FAIL:** capture a screenshot of the offending region and **quote the exact text seen vs expected**, e.g.:
- `Expected composer placeholder: "Describe the workflow or change…"  —  Seen: "Describe the workflow or change..."` (three-dot vs ellipsis).
- `Expected seed copy: "…connect Dify to seed from a workspace app (Lát 5)…"  —  Seen: "…connect Dify to seed from a workspace app (Lat 5)…"`.

---

## Cleanup

- **None required.** This test starts **no build**, spawns **no turn**, and opens **no task** in conversation view. It must leave the app exactly as found.
- During the run, **do not** click `New task`, `New task in this workflow`, any suggestion row, or the composer send — and **do not** confirm a different value on any setting chip dropdown (close each dropdown on the default). Leaving any of these changed could dirty the defaults that later reuse tests (BUILD‑A onward) depend on.
- If Step 6.8 found a pre-existing `In progress` parked build, leave it as-is (it is owned/cleaned by the test that created it, e.g. T08); only record that it was present.
- No filesystem cleanup: nothing under `projects/` or `apps/builder/.runs/` is created or modified by this test.

> Cross-reference: **App‑CLI‑1** (`/health`) in the [00-README](00-README.md#appendix-not-browser-testable) appendix covers the AC#1 health-check half (non-OK when `.venv/`/`skills/` missing); **App‑CLI‑2** covers the AC#2 real-seed-list case (with Dify creds).

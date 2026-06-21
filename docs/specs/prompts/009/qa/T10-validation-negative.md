# T10 — Validation / Negative / Regression

> Single source of truth for every quoted string: [00-README](00-README.md) §4 String Dictionary. Assert dictionary values **exactly** — including `…`, `·`, `▸`, `—`, `≠`. Do not normalize or paraphrase.

| Field | Value |
|---|---|
| **ID** | T10 |
| **Title** | Validation / negative / regression: empty requirement · no pickers · double-click gate · blank Spec save · dead-end composer · F4 slug collision |
| **Traces to** | AC#14 (no model/pattern picker), endpoint validation negatives (`requirement is required` / `SPEC.md cannot be empty` / confirm turn-lock), **F4** (slug auto-suffix), regression-of-dead-end-composer, regression-of-blank-spec |
| **Priority** | P0 (F4 step is P1) |
| **Cost** | ~3 real build-turns (BUILD‑E ①②③ for F4) + 0-cost negatives |

---

## Preconditions

1. App running and reachable at **http://127.0.0.1:4123** (host hardcoded to `127.0.0.1`; only the port is overridable). If the page does not load, **STOP and report** — do not proceed.
2. For the **dead-end-composer** check (Step 5): a build already in a terminal **Done** state must exist. Reuse **BUILD‑A** (finished to `done` per the run order in [00-README](00-README.md) §1.4). If no Done build exists, **STOP and report** — do not start a fresh build just for Step 5.
3. For the **blank Spec save** check (Step 4): a build that already has a `SPEC.md` (i.e. has passed the Spec phase). BUILD‑A satisfies this. If none exists, skip Step 4 and note it.
4. For **F4** (Step 6): the repo already contains BOTH `projects/workflow_start_node_one/` AND `projects/workflow_start_node_one_2/`, so a fresh derive of that slug collides and the first free suffix is **`_3`**. Confirm on disk before starting:
   ```bash
   ls -d projects/workflow_start_node_one projects/workflow_start_node_one_2
   ```
   If `projects/workflow_start_node_one_3/` ALREADY exists, the expected suffix will shift to `_4` — in that case **STOP and report** the mismatch rather than asserting `_3`.
5. No build turn is currently running anywhere (the turn-level lock is free). If the connection dot reads `Reconnecting…` instead of `Live` ([00-README](00-README.md) §4.2), wait until `Live` before acting.

> Reminder ([00-README](00-README.md) §1.3): a build turn is real model spend, up to ~5 min. After any act that starts/advances a turn, **poll** for a deterministic on-screen signal with a stated timeout (default **300 s**). **Never** double-click a gate to "hurry" it — that can 409 the turn-lock. (Step 3 deliberately double-clicks to *prove* the guard; that is the only place double-clicking is intentional.)

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**.

### Step 1 — EMPTY requirement is rejected (no build starts)
1. **Observe:** Open http://127.0.0.1:4123 on the empty-state screen. The composer placeholder reads `Describe the workflow or change…` ([00-README](00-README.md) §4.1, App.tsx:300). The empty-state crumb reads `New task` (App.tsx:295).
2. **Act:** Leave the composer text box **empty** (no characters, not even whitespace). Click **Send**.
3. **Wait (≤10 s):** Poll the page after the click.
4. **Assert:**
   - **NO** conversation/build view opens — the empty-state composer remains on screen.
   - The requirement is rejected by the backend with **HTTP 400** and `error` body `requirement is required` (tasks.ts:99, [00-README](00-README.md) §4.8). This surfaces inline (e.g. an inline validation/error indicator on the composer); it does **NOT** open a conversation and does **NOT** create a task in the sidebar.
   - The sidebar `In progress` count is **unchanged** (no new `running`/`gate` entry appears).
   - If Send is simply disabled while the box is empty (client-side guard) and no request is sent, that ALSO passes Step 1 — the binding requirement is **no build starts** and **no conversation opens**. Note which guard fired (client-disabled vs backend 400).

### Step 2 — NO model picker and NO pattern picker (AC#14)
1. **Observe:** On the empty-state composer, inspect the settings row **below** the input.
2. **Act:** Read every control in the settings row and any settings affordance reachable from the composer (do not open a build).
3. **Wait (≤5 s):** Settings render with the page; no waiting on a turn.
4. **Assert** the settings expose **only** these three chips ([00-README](00-README.md) §4.1):
   - `Workflow` (value when none: `none (new)`)
   - `Confirm` (options `each step` / `spec only` / `auto`)
   - `Deploy` (options `none` / `selfhost` / `cloud`)
   - There is **NO** model selector and **NO** pattern/template selector **anywhere** in the composer or its settings. (Source intent: Chat.tsx:8 "BELOW the input (AC #14) — no model/pattern picker.")
   - The only seed affordance present is the `SEED FROM` picker (App.tsx:307) with the `none` chip (App.tsx:314) — a *seed-app* picker is **not** a model or pattern picker and is allowed.

### Step 3 — DOUBLE-CLICK a gate is guarded (no double-advance, no crash)
1. **Observe:** Use a build that is **parked at a gate** (`awaiting_confirm`). Reuse a BUILD‑A gate if BUILD‑A is parked; otherwise any parked gate. Confirm the gate card shows its confirm button — e.g. the Analyze gate badge `Analyze complete`, title `Ready to write the spec`, with confirm button `Continue to Spec` ([00-README](00-README.md) §4.3/§4.4). The connection dot reads `Live`.
2. **Act:** Click the **confirm** button (e.g. `Continue to Spec`) **twice in rapid succession** (two clicks as fast as possible, before any signal returns). Do this exactly once — do not keep clicking.
3. **Wait (≤300 s):** Poll for the next deterministic signal: either the phase advances **once** (the running disclosure `Running` appears, then the next gate card), or an error banner appears. Allow up to the full per-turn timeout because the **first** click legitimately starts a real turn.
4. **Assert:**
   - Exactly **ONE** advance happens. The phase track does **not** skip two phases; only one new turn is spawned.
   - The **second** click is a no-op OR surfaces a backend message (HTTP 409), one of ([00-README](00-README.md) §4.8):
     - `a turn is already running — try again in a moment` (tasks.ts:43) — if the first click already acquired the turn, or
     - `'${actionId}' is not a current confirm action` (tasks.ts:168) — if the first click already consumed/cleared the action, or
     - `task is ${status}, not awaiting_confirm` (tasks.ts:162) — if the status already left `awaiting_confirm` (here `${status}` interpolates to e.g. `running`).
   - There is **NO** double-advance and **NO** crash/blank screen. The app stays responsive.
   - Quote the exact 409 `error` string observed (if any) and which of the three it matched.

### Step 4 — BLANK Spec save is rejected (regression-of-blank-spec)
1. **Observe:** Open a build that has a `SPEC.md` (BUILD‑A). Open the artifact panel and select the `Spec` tab (exact casing, ArtifactPanel.tsx:194) — title `SPEC.md` ([00-README](00-README.md) §4.5). The editor shows the current spec text.
2. **Act:** Clear **ALL** text in the Spec editor (select-all, delete — leave it completely empty). Click **`Save spec`** (ArtifactPanel.tsx:51).
3. **Wait (≤15 s):** Poll for the save result (the button may briefly read `Saving…`).
4. **Assert:**
   - The save is **REJECTED** with **HTTP 400** and `error` body `SPEC.md cannot be empty` (ui.ts:109, [00-README](00-README.md) §4.8).
   - The on-disk/server `SPEC.md` is **NOT** blanked — re-reading the Spec tab still shows the previous (non-empty) content; the save-status does not read `Saved · feeds Implement` for the empty payload.
   - Backstop file check (human/CLI, optional): `SPEC.md` for that build under `projects/<slug>/` is non-empty.

### Step 5 — DEAD-END composer starts a NEW build (regression-of-dead-end-composer)
1. **Observe:** Open the conversation of a **Done** build (BUILD‑A finished to `done`; gate card badge `Done`, title `Test passed — workflow updated`, [00-README](00-README.md) §4.3). The composer placeholder reads the **terminal-state** string `Describe another change to start a new build…` (App.tsx:217, [00-README](00-README.md) §4.1) — NOT the live-build placeholder.
2. **Act:** Type a new requirement into that composer (e.g. *"Add a second step that translates the summary to Japanese."*) and click **Send**.
3. **Wait (≤300 s):** Poll for the new build to begin — the running disclosure `Running` ([00-README](00-README.md) §4.2) and/or a fresh Analyze turn; a new entry appears under the sidebar `In progress` section.
4. **Assert:**
   - A **NEW** build starts (new task in the sidebar; Analyze turn begins).
   - The red error banner `task is ${status}; /reply needs awaiting_confirm or error` (tasks.ts:248, [00-README](00-README.md) §4.8) does **NOT** appear. (On a Done build `${status}` would interpolate to `done`.)
   - **If that error DOES appear, this is a regression of the dead-end-composer fix → FAIL.** Capture the screenshot and quote the exact banner text.
   - Discard this new build in Cleanup (it spends a turn) — do not advance it past Analyze.

### Step 6 — F4 SLUG COLLISION auto-suffix to `_3` (P1) — BUILD‑E
1. **Observe:** Return to the empty-state composer. Settings = `Workflow: none (new)`, `Confirm: each step`, `Deploy: none`.
2. **Act (start BUILD‑E):** Enter requirement **`R-existing`** — a requirement that derives the slug `workflow_start_node_one`, e.g. *"workflow start node one"* ([00-README](00-README.md) §1.4). Click **Send**.
3. **Wait (≤300 s):** Poll until the **Analyze** gate appears — badge `Analyze complete`, title `Ready to write the spec` ([00-README](00-README.md) §4.3).
4. **Act:** Click **`Continue to Spec`** (gate.ts:63). **Single click only.**
5. **Wait (≤300 s):** Poll until the **Spec** gate appears — badge `Spec ready`, title `Spec drafted — review before I build` ([00-README](00-README.md) §4.3). The proposed slug/name surfaces here (AC#18).
6. **Act:** Click **`Implement this spec`** (gate.ts:72). **Single click only.**
7. **Wait (≤300 s):** Poll until the **Implement** gate appears — for a clean lint, badge `Implemented`, title `main.yml built and linted` ([00-README](00-README.md) §4.3). (If it instead reaches the still-failing gate — badge `Lint still failing` — note it but the F4 collision assertions on slug/path/diff still apply.)
8. **Assert (the F4 binding assertions):**
   - The Implement (Spec-confirm) gate note **LEADS with the collision message**, verbatim ([00-README](00-README.md) §4.8, orchestrator.ts:658):
     > `'workflow_start_node_one' already exists — using 'workflow_start_node_one_3' to avoid overwriting it.`
     The suffix is `_3` because `_2` already exists on disk — `_3` is the **first free** `<slug>_N` (orchestrator.ts:762–772, loop starts at `n=2`).
   - The produced YAML path is **`projects/workflow_start_node_one_3/workflows/main.yml`**. Confirm via the `main.yml` tab (ArtifactPanel.tsx:195) and, if visible, the report `Workflow file` row ([00-README](00-README.md) §4.5).
   - The **Diff** (`Split diff`, ArtifactPanel.tsx:113) is **pure additions against an empty base** (a brand-new project dir — no deletions, no modified base). If the Diff tab still shows the placeholder `No diff yet — the seed/pattern diff producer lands in Lát 5.` (ArtifactPanel.tsx:114), record that the diff producer is not yet wired and treat the path/untouched-original checks below as the binding evidence.
   - The **ORIGINAL** `projects/workflow_start_node_one/workflows/main.yml` is **UNTOUCHED** (byte-for-byte unchanged; no new commit/edit to it). Verify with the file check below.

   **File check (human/CLI) for Step 6:**
   ```bash
   # New suffixed project exists with main.yml:
   test -f projects/workflow_start_node_one_3/workflows/main.yml && echo "NEW_OK"
   # Original is untouched (no working-tree change to its main.yml):
   git status --porcelain projects/workflow_start_node_one/workflows/main.yml   # expect EMPTY output
   ```
9. **(Confirm:auto cross-note — informational, not run here):** under `Confirm: auto` the suffixed slug is also recorded in the final report (`task.slugNote` is pushed into the report notes — report.ts:84–86), so an `auto` run that never showed a gate still surfaces the rename. BUILD‑E runs `each step`, so we assert the **gate note** above; the report-note path is covered as informational.

---

## Expected

The binding assertions (exact strings):

| # | Expected | Exact string / state |
|---|---|---|
| 1 | Empty requirement rejected, no build | HTTP 400 `requirement is required`; no conversation opens; sidebar count unchanged |
| 2 | No model/pattern picker | Only `Workflow` / `Confirm` / `Deploy` chips below input; no model selector; no pattern selector |
| 3 | Double-click guarded | Exactly one advance; 2nd click no-op or 409 — one of `a turn is already running — try again in a moment` · `'${actionId}' is not a current confirm action` · `task is ${status}, not awaiting_confirm`; no crash |
| 4 | Blank Spec save rejected | HTTP 400 `SPEC.md cannot be empty`; `SPEC.md` not blanked |
| 5 | Done composer starts new build | New build starts; banner `task is ${status}; /reply needs awaiting_confirm or error` does **NOT** appear |
| 6 | F4 collision → `_3` | Gate note leads with `'workflow_start_node_one' already exists — using 'workflow_start_node_one_3' to avoid overwriting it.`; YAML at `projects/workflow_start_node_one_3/workflows/main.yml`; Diff = pure additions vs empty base; original `projects/workflow_start_node_one/workflows/main.yml` untouched |

---

## Negative / edge variants

- **Whitespace-only requirement (Step 1 variant):** type only spaces/newlines in the empty composer and Send. The backend trims (`String(...).trim()`, tasks.ts:98) → still `requirement is required` (400); no build starts. Asserts the trim, not just emptiness.
- **Confirm with missing actionId (Step 3 variant, optional CLI):** a confirm POST with no `actionId` → HTTP 400 `actionId is required` (tasks.ts:153, [00-README](00-README.md) §4.8). Browser UI always supplies an actionId, so this is an API-level negative — note if exercised.
- **Stale gate action after advance (Step 3 follow-on):** clicking a now-consumed gate action after the phase advanced → 409 `'${actionId}' is not a current confirm action` (tasks.ts:168). This is the expected text when the action no longer matches a current confirm action.
- **Spec save with only-whitespace (Step 4 variant):** clearing to a single space and Save — the server treats an effectively-empty body as empty → `SPEC.md cannot be empty` (400). Confirm whitespace is not silently accepted.
- **F4 with `_3` pre-existing (Step 6 edge):** if `projects/workflow_start_node_one_3/` already exists at start, the first free suffix becomes `_4` and the gate note ends `…using 'workflow_start_node_one_4' to avoid overwriting it.` Per Preconditions, STOP and report rather than asserting a wrong suffix.

---

## Pass / Fail

**PASS** only if ALL of:
- Step 1: empty (and whitespace-only) requirement does not start a build; rejection is `requirement is required` (400) or a client-disabled Send — no conversation opens.
- Step 2: no model picker and no pattern picker anywhere; only `Workflow`/`Confirm`/`Deploy` chips present.
- Step 3: a rapid double-click yields exactly one advance and no crash; any second-click error is one of the three documented 409 strings — verbatim.
- Step 4: blank Spec save is rejected with `SPEC.md cannot be empty` (400) and the spec is not blanked.
- Step 5: typing+Send on a Done build starts a NEW build and the `task is ${status}; /reply needs awaiting_confirm or error` banner does NOT appear.
- Step 6: the gate note leads with `'workflow_start_node_one' already exists — using 'workflow_start_node_one_3' to avoid overwriting it.` exactly; YAML produced at `projects/workflow_start_node_one_3/workflows/main.yml`; the original `projects/workflow_start_node_one/workflows/main.yml` is untouched.

**FAIL** if ANY of:
- A build starts on empty/whitespace requirement, OR a conversation opens.
- A model or pattern picker is present in the composer/settings.
- A double-click causes a double-advance, a crash/blank screen, or surfaces an undocumented error string.
- Blank Spec save succeeds OR blanks `SPEC.md` OR returns a different message than `SPEC.md cannot be empty`.
- The dead-end composer shows `task is ${status}; /reply needs awaiting_confirm or error` (**regression of the dead-end-composer fix**).
- The collision message is missing, paraphrased, uses a wrong suffix (e.g. `_2` instead of `_3`), the YAML lands anywhere other than `projects/workflow_start_node_one_3/workflows/main.yml`, OR the original `projects/workflow_start_node_one/` main.yml is modified.
- Any asserted string differs from the [00-README](00-README.md) §4 dictionary value (including `…`, `·`, `—`).

**Evidence (on any FAIL):** capture a screenshot of the failing surface AND quote the **exact text seen** vs the **expected** dictionary string. For Step 6, attach the `git status --porcelain projects/workflow_start_node_one/workflows/main.yml` output and an `ls -d projects/workflow_start_node_one_3` result.

> TODO (omitted assertions): the exact **inline surfacing** of the Step 1 `requirement is required` 400 in the composer (toast vs inline label) is not in the README dictionary; assert the *behavior* (no build, no conversation) and note the surfacing form rather than asserting a specific banner string.

---

## Cleanup

1. **Discard BUILD‑E** and the **new build started in Step 5** so no turn is left parked:
   - On each build's current gate, click **`Discard build`** (gate.ts:46), or use the sidebar hover-× with tooltip `Cancel this build` (Sidebar.tsx:134), or the Stop dialog (`Stop this build?` → `Stop build`, App.tsx:111/113). Cancel is non-destructive — `projects/` + `.runs/` stay on disk ([00-README](00-README.md) §1.3).
   - Confirm the sidebar `In progress` section no longer lists BUILD‑E or the Step-5 build (no `gate`/`running` hint remains).
2. **Restore the blank Spec (Step 4):** the blank save was rejected, so `SPEC.md` should be intact. If, against expectation, it was blanked, restore from git: `git checkout -- projects/<build-A-slug>/SPEC.md`. (FAIL is still recorded.)
3. **Do NOT** touch `projects/workflow_start_node_one/` or `projects/workflow_start_node_one_2/` — they are required Preconditions for re-runs.
4. **Filesystem note (the ONLY disk residue this test leaves):** BUILD‑E creates a new on-disk directory **`projects/workflow_start_node_one_3/`** that Discard does **not** remove (Cancel preserves files). If a clean tree is required, remove it manually:
   ```bash
   rm -rf projects/workflow_start_node_one_3
   ```
   The Step-5 build's project dir is likewise preserved on disk; remove its `projects/<slug>/` similarly if a pristine tree is required.

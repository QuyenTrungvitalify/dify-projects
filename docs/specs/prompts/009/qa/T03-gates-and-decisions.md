# T03 — Gate actions & decisions

> Canonical strings & run guide: **[00-README](00-README.md)** (the single source of truth — assert the [String Dictionary](00-README.md#string-dictionary) values verbatim).

| Field | Value |
|---|---|
| **ID** | T03 |
| **Title** | Gate actions & decisions — Request-changes re-runs the SAME phase; Discard on every gate; distinct clean vs still-failing actions; error/Retry |
| **Traces to** | AC#7 (`/reply` revises current phase without advancing) · AC#16 (inline gate buttons) · AC#25 (clean vs still-failing render DISTINCT actions) · AC#19 (phase error → Retry, OBSERVE) · F1 (Discard on every gate) |
| **Priority** | P0 |
| **Cost** | 0–1 real build-turns (0 if reusing a parked BUILD‑A gate; up to 1 if a fresh build is started to the Analyze gate). The Request-changes re-runs in step 2 & 3 each spend 1 extra turn when exercised. |

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (the SPA loads, no login wall). STOP+report if the page does not load.
- **A build parked at a gate.** Either:
  - **(preferred, cost 0 entry)** Reuse **BUILD‑A** from [T02](T02-build-happy-path.md) while it is parked at a gate (`Workflow: none`, `Confirm: each step`, `Deploy: none`, requirement `R-fresh`); or
  - **(cost 1)** Start a fresh build: in the empty composer type `R-fresh` = `A workflow that takes a topic string as input and returns a one-paragraph summary of it.`, leave settings at defaults (`Confirm` = `each step`, `Deploy` = `none`), submit, then **wait ≤300s** for the Analyze gate to appear.
- A gate card MUST be visible (a card with a badge + title + inline buttons). **STOP+report** if no gate appears within the timeout — do NOT re-submit (a 2nd start can 409 the turn-lock; see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)).

> NOTE on cost discipline: steps 2 and 3 each spend a real build-turn (the re-run). If running the minimal P0 path, exercise step 2 (Analyze re-run) and treat step 3 (Spec re-run) as optional. Steps 1, 4, 5 and the negative variant are read-only OBSERVE/assert checks (cost 0).

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. Strings in `code font` are exact and MUST match character-for-character (including `…`, `·`, `—`).

### Step 1 — F1: Discard on every non-terminal gate; the still-failing gate uses "Abandon" (assert the distinction)

1. **Observe** the currently visible gate card's inline button row (the `gate-foot` region at the bottom of the card).
2. **Assert** the non-terminal, non-still-failing gate exposes a **low-emphasis cancel** action labelled exactly `Discard build`. This holds for each of these gates as they occur during the suite:
   - **Analyze** gate buttons: `Continue to Spec` · `Request changes` · `Discard build`.
   - **Spec** gate buttons: `Implement this spec` · `Edit spec` · `Discard build`.
   - **Implement (clean)** gate buttons: `Continue to Test` · `Request changes` · `Discard build`.
   - **Test (selfhost `awaiting_import`)** gate buttons: `Import to Dify` · `Skip import` · `Discard build`.
   - The `Discard build` button is rendered set apart from the primary advance button (it is a ghost/low-emphasis style, not the primary OK button) so it cannot be fat-fingered.
3. **Assert the distinction:** the **still-failing Implement** gate does **NOT** use `Discard build`. Its cancel action is labelled exactly `Abandon` (alongside `Accept anyway` and `Keep trying`). (Observe-only here; forcing the still-failing gate is **Impl‑CLI‑1**, see [00-README §5](00-README.md#appendix-not-browser-testable).)

### Step 2 — AC#7: Request changes at the Analyze gate re-runs Analyze, does NOT advance to Spec

1. **Observe** the Analyze gate card. Badge reads `Analyze complete`, title `Ready to write the spec`. (If BUILD‑A is already past Analyze, run a fresh build to the Analyze gate per Preconditions.)
2. **Act:** click the button labelled exactly `Request changes`.
3. **Wait ≤2s. Assert** a reply box opens inline on the gate card containing:
   - a textarea with placeholder exactly `What should change before continuing?`
   - a button labelled exactly `Cancel`
   - a button labelled exactly `Send & re-run`
   - The advance button (`Continue to Spec`) is hidden while the reply box is open.
4. **Act:** type a small change into the textarea, exactly: `Add a note about empty input.`
5. **Observe** the `Send & re-run` button becomes enabled (it is disabled while the textarea is empty/whitespace-only).
6. **Act:** click `Send & re-run` **once**. Do NOT double-click (a 2nd click can 409 the turn-lock).
7. **Wait ≤300s** for the Analyze turn to re-run and re-gate. Poll for the gate card to reappear; while running, the run disclosure shows `Running` and the working detail `Working…`.
8. **Assert** Analyze **RE-RUNS** as a fresh Analyze turn and the build **re-gates at the SAME Analyze gate**:
   - The phase track / gate is back on `Analyze` (badge `Analyze complete`, title `Ready to write the spec`) — **NOT** on Spec.
   - The gate does **NOT** advance to the Spec gate (it must NOT show badge `Spec ready` / title `Spec drafted — review before I build`).
   - **Negative assert:** the build has NOT moved to phase `Spec`; the Spec gate card must not be present.

### Step 3 — AC#7 (repeat at Spec): "Edit spec" re-runs Spec, does NOT advance

1. **Precondition for this step:** the build must be parked at the **Spec** gate. If currently at the Analyze gate, **act:** click `Continue to Spec` once and **wait ≤300s** for the Spec gate (badge `Spec ready`, title `Spec drafted — review before I build`).
2. **Observe** the Spec gate card. Its inline buttons are `Implement this spec` · `Edit spec` · `Discard build`.
3. **Act:** click the button labelled exactly `Edit spec`.
4. **Wait ≤2s. Assert** the same reply box opens: placeholder `What should change before continuing?`, buttons `Cancel` and `Send & re-run`.
5. **Act:** type a small change, e.g. exactly `Clarify the summary length.`; click `Send & re-run` **once**.
6. **Wait ≤300s** for the Spec turn to re-run and re-gate.
7. **Assert** Spec **RE-RUNS** and **re-gates at the SAME Spec gate** (badge `Spec ready`, title `Spec drafted — review before I build`). It does **NOT** advance to the Implement gate (must NOT show badge `Implemented` / title `main.yml built and linted`).

### Step 4 — AC#25: distinct clean vs still-failing Implement actions

1. **Observe** the **CLEAN Implement** gate (reach it by clicking `Implement this spec` at the Spec gate and waiting ≤300s, OR observe BUILD‑A at its clean Implement gate).
2. **Assert** the clean Implement gate renders:
   - badge `Implemented`, title `main.yml built and linted`, summary line `Workflow YAML generated; all linters green.`
   - inline buttons exactly `Continue to Test` · `Request changes` · `Discard build`.
3. **Assert the STILL-FAILING variant is DISTINCT** (OBSERVE-only — assert only **if** it naturally occurs; forcing it is **Impl‑CLI‑1**). When it occurs it renders:
   - badge `Lint still failing`
   - title `Still failing after the cap-5 attempts`
   - summary lines `The agent self-corrected as far as it could in one turn.` and `Your call: accept anyway, keep trying, or abandon.`
   - inline buttons exactly `Accept anyway` · `Keep trying` · `Abandon`.
   - **Distinctness assertion:** the still-failing gate's button set `Accept anyway` / `Keep trying` / `Abandon` is **NOT equal** to the clean gate's `Continue to Test` / `Request changes` / `Discard build`. The cancel label differs (`Abandon` ≠ `Discard build`).

### Step 5 — AC#19: error gate → Retry phase, no advance (OBSERVE-only)

1. **Observe** — assert **only if** any phase naturally errors during the build (forcing an error is **Recover‑CLI‑1**, see [00-README §5](00-README.md#appendix-not-browser-testable)). When a phase errors, the gate card renders:
   - badge `Phase failed`
   - title `<phase> errored` (the actual phase name substituted, e.g. `Analyze errored` / `Spec errored` / `Implement errored` / `Test errored`)
   - meta `exit 1`
   - summary `No files were written. Retry re-runs only this phase from the approved input.` (or the actual error line(s) split on ` | ` if the backend reported specifics)
   - a **single** inline button labelled exactly `Retry phase` — there is NO advance button on an error gate.
2. **Assert** the error gate does NOT advance to the next phase (no `Continue to …` button is present; only `Retry phase`).

---

## Negative / edge variants

### N1 — Cancel closes the reply box, gate buttons return unchanged (AC#7 cancel path)

1. **Observe** any re-runnable gate (Analyze or Spec) with its inline buttons.
2. **Act:** click `Request changes` (Analyze) or `Edit spec` (Spec). **Assert** the reply box opens (placeholder `What should change before continuing?`, buttons `Cancel` / `Send & re-run`).
3. **Act:** click `Cancel`.
4. **Wait ≤2s. Assert** the reply box **closes** and the original gate inline buttons **return unchanged** (Analyze → `Continue to Spec` · `Request changes` · `Discard build`; Spec → `Implement this spec` · `Edit spec` · `Discard build`). No turn was spent; the phase did NOT change.

### N2 — No double-click on a gate (turn-lock)

- **Assert** clicking `Send & re-run` (or any advance button) twice in quick succession does NOT proceed twice. A 2nd click while a turn is running yields the backend 409 body `a turn is already running — try again in a moment` ([00-README §4.8](00-README.md#48-backend-messages-status-banners--4xx-bodies--tasksts-uits-indexts)). The agent MUST click each gate exactly once and then wait.

---

## Expected

The binding, exact-string assertions:

1. **F1 (Discard on every gate):** every non-terminal, non-still-failing gate (Analyze / Spec / clean Implement / Test-import) exposes a low-emphasis `Discard build` button. The still-failing Implement gate uses `Abandon` instead — `Abandon` ≠ `Discard build`.
2. **AC#7 (Analyze):** `Request changes` opens a reply box with placeholder `What should change before continuing?` and buttons `Cancel` / `Send & re-run`; `Send & re-run` re-runs Analyze and re-gates at the **same** Analyze gate (`Analyze complete` / `Ready to write the spec`) — it does NOT advance to `Spec ready`.
3. **AC#7 (Spec):** `Edit spec` re-runs Spec and re-gates at the **same** Spec gate (`Spec ready` / `Spec drafted — review before I build`) — it does NOT advance to `Implemented`.
4. **AC#25 (distinct):** clean Implement = `Continue to Test` · `Request changes` · `Discard build` (badge `Implemented`, title `main.yml built and linted`, summary `Workflow YAML generated; all linters green.`). Still-failing Implement = `Accept anyway` · `Keep trying` · `Abandon` (badge `Lint still failing`, title `Still failing after the cap-5 attempts`, summaries `The agent self-corrected as far as it could in one turn.` / `Your call: accept anyway, keep trying, or abandon.`). The two action sets are NOT equal.
5. **AC#19 (error, observe):** an errored phase gate = badge `Phase failed`, title `<phase> errored`, meta `exit 1`, summary `No files were written. Retry re-runs only this phase from the approved input.`, single button `Retry phase`, no advance.
6. **N1:** `Cancel` in the reply box closes it and restores the original gate buttons unchanged.

---

## Pass / Fail

**PASS** (all must hold):

- [ ] Step 1: every applicable non-terminal gate shows `Discard build`; the still-failing gate (if observed) shows `Abandon` not `Discard build`.
- [ ] Step 2: `Request changes` reply box matches exactly (`What should change before continuing?`, `Cancel`, `Send & re-run`); Analyze re-runs and re-gates at the **same** Analyze gate; no advance to Spec.
- [ ] Step 3 (if exercised): `Edit spec` re-runs Spec and re-gates at the **same** Spec gate; no advance to Implement.
- [ ] Step 4: clean vs still-failing Implement action sets are exactly as listed and are distinct.
- [ ] Step 5 (if error observed): error gate matches exactly and offers only `Retry phase`.
- [ ] N1: `Cancel` closes the reply box and restores buttons unchanged.

**FAIL** if any observed string differs by even one character (including `…`, `·`, `—`, `≠`), OR a re-run advances the phase instead of re-gating at the same phase, OR an error gate offers an advance button, OR the still-failing gate exposes `Discard build` instead of `Abandon`.

**Evidence (on any FAIL):** capture a screenshot of the gate card, and quote the **exact text seen** vs the **expected** string from the [00-README String Dictionary](00-README.md#string-dictionary). For a phase-advance failure, quote the badge/title seen (e.g. seen `Spec ready` when `Analyze complete` was expected).

> If a required gate string is genuinely absent from the [00-README dictionary](00-README.md#string-dictionary), do NOT invent it — omit that sub-assertion and record a **TODO** noting the missing dictionary entry.

---

## Cleanup

1. **Discard the build this test left parked:** at the current gate, click `Discard build` (or, on a still-failing gate, `Abandon`) so no parked turn remains holding context.
2. **Confirm** the build no longer appears as active (the sidebar `In progress` / `In progress` section no longer lists it with a `gate` or `running` hint).
3. **Note:** Cancel/Discard is non-destructive — `projects/` and `apps/builder/.runs/` stay on disk (see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)). No filesystem cleanup is required. If BUILD‑A is shared with downstream tests (T06/T07/T09/T08/T10) and they have not yet run, leave it parked instead of discarding, and discard only any **fresh** build this test started.

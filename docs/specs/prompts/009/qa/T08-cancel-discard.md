# T08 — Cancel / Discard

> Canonical strings & run guide: **[00-README](00-README.md)** (the single source of truth — assert the [String Dictionary](00-README.md#string-dictionary) values verbatim).

| Field | Value |
|---|---|
| **ID** | T08 |
| **Title** | Cancel / Discard — F1 Discard on every gate + sidebar hover-×; AC#24 cancel frees the turn-lock; cancel kills a running turn |
| **Traces to** | F1 (Discard on every parked gate + sidebar hover-× cancels WITHOUT opening) · AC#24 (cancel frees lock → a new build starts; cancel mid-turn stops the running turn) · regression-of double-click/stranded-parked-build |
| **Priority** | P0 |
| **Cost** | 1 real build-turn minimum (1 short build to the Analyze gate for the Discard-from-gate path), plus reuse of already-parked builds where available. Step 3 starts 1 more short parked build; step 5 starts 1 short build and stops it mid-turn. Total ≤3 short turns if no reuse; ~1 if BUILD‑A / a parked partner is reused for steps 1–4. |

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (the SPA loads, no login wall). **STOP+report** if the page does not load.
- Ability to start a short build (empty composer reachable, settings default to `Confirm` = `each step`, `Deploy` = `none`).
- For the F1-from-gate path (step 1) you need a build **parked at a gate**. Either reuse a build already parked at a gate (e.g. **BUILD‑A** from [T02](T02-build-happy-path.md) at its Analyze gate, if T08 is being run as the dedicated discard variant and BUILD‑A is no longer needed downstream), or start a fresh short build to the Analyze gate.
- **Cost discipline:** a build turn is real model spend (~5 min). Wait for an on-screen signal with the stated timeout; never double-click a gate (a 2nd click can 409 the turn-lock; see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)).

> NOTE: Cancel/Discard is **non-destructive** — `projects/` and `apps/builder/.runs/` stay on disk. So discarding a build only removes it from the live/active set; it does not delete artifacts.

> ⚠️ **F1 must be validated on a FRESH (post-F1) build — not a stale leftover.** A build's `gate.actions[]` is **persisted into its state at the moment the gate was computed**. A build created **before F1 shipped** keeps its old gate with **no `Discard build`** button on the Analyze/Spec/clean-Implement gates — that is **frozen pre-F1 state, NOT a current-code defect**. Current code puts `Discard build` on every parked gate (`gate.ts:65` analyze, `:74` spec, `:93` clean implement, `:109` selfhost import). *Verified 2026‑06‑14:* a 2-day-old leftover showed only `Continue to Spec`/`Request changes` on its Analyze gate (pre-F1), while a fresh BUILD‑A and `gate.ts` both have all 3. **Do not log a missing-`Discard build` FAIL against a stale build** — assert F1 against a build you just started.

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. Strings in `code font` are exact and MUST match character-for-character (including `…`, `·`, `▸`, `—`, `≠`).

### Step 1 — F1: Discard from a gate flips the build to Cancelled

1. **Observe** a build parked at the Analyze gate. If none is parked, **act:** in the empty composer type `R-fresh` = `A workflow that takes a topic string as input and returns a one-paragraph summary of it.`, leave settings at defaults (`Confirm` = `each step`, `Deploy` = `none`), submit, and **wait ≤300s** for the Analyze gate card to appear (badge `Analyze complete`, title `Ready to write the spec`). **STOP+report** if no gate appears within the timeout — do NOT re-submit.
2. **Observe** the Analyze gate card's inline button row. It contains `Continue to Spec` · `Request changes` · `Discard build`.
3. **Act:** click the low-emphasis button labelled exactly `Discard build`. Click it **once**.
4. **Wait ≤10s** for the build to flip to the terminal cancelled state. Poll the gate/conversation card.
5. **Assert** the build flips to **cancelled**, rendering exactly:
   - badge `Cancelled`
   - title `Build abandoned`
   - summary line `Cancelled by user — the spec/artifacts so far are preserved.`
6. **Assert** the build **drops from the sidebar `In progress` section** — it is no longer listed there with a `gate` or `running` status hint. (The conversation may still be openable as a terminal build, but it is no longer an active/parked build.)

### Step 2 — F1: `Discard build` present on every non-still-failing gate type; still-failing uses `Abandon` (assert from known labels)

1. **Assert** (from the [String Dictionary §4.4](00-README.md#44-gate-action-buttons-gatets--assert-exact-label-per-phase) and as observed during the suite) that the low-emphasis cancel action is labelled exactly `Discard build` on each of these gate types:
   - **Analyze** gate: `Continue to Spec` · `Request changes` · `Discard build`.
   - **Spec** gate: `Implement this spec` · `Edit spec` · `Discard build`.
   - **Implement (clean)** gate: `Continue to Test` · `Request changes` · `Discard build`.
   - **Test (selfhost `awaiting_import`, `Deploy ≠ none`)** gate: `Import to Dify` · `Skip import` · `Discard build`.
2. **Assert the distinction:** the **still-failing Implement** gate does **NOT** use `Discard build`. Its cancel action is labelled exactly `Abandon` (alongside `Accept anyway` · `Keep trying`). Do **NOT** force the still-failing gate (forcing it is **Impl‑CLI‑1**, see [00-README §5](00-README.md#appendix-not-browser-testable)) — assert this label distinction from [T03](T03-gates-and-decisions.md) / the dictionary. `Abandon` ≠ `Discard build`.

> Wherever a given gate type is actually reached during the live suite (e.g. the clean Implement gate of BUILD‑A in [T03](T03-gates-and-decisions.md)/[T07](T07-artifacts-panel.md)), **observe** its button row and confirm the `Discard build` label appears verbatim. Where a gate type is not reached browser-side (e.g. selfhost import without creds), assert from the dictionary value and add a note.

### Step 3 — F1: sidebar hover-× cancels a PARKED build WITHOUT opening its conversation

1. **Observe** the sidebar. **Act:** start another short build to a gate so a **parked** row exists — in the empty composer type `R-fresh-2` = `A workflow that takes a city name and returns a short weather-style description string.`, leave settings at defaults, submit, and **wait ≤300s** for it to reach a gate (parked, `awaiting_confirm`). **STOP+report** if no gate appears within the timeout.
2. **Observe** the sidebar `In progress` section. The new build appears as a row there with a status hint `gate` (a parked build shows `gate`; a running build would show `running`).
3. **Act:** **hover** that build's row under `In progress`. **Assert** a `×` (close) control appears in the row, with tooltip exactly `Cancel this build`.
4. **Act:** click the hover-`×` on that **parked** row **once**.
5. **Wait ≤10s. Assert** the build is **cancelled** and the row **drops from the `In progress` section** — and crucially the click did **NOT open that build's conversation** (the current view/active conversation must NOT have switched to the cancelled build; the `×` cancels in place via `e.stopPropagation()`). A parked build dismisses **immediately**, with no confirm dialog.

> Source note: a **parked** (`awaiting_confirm`) build's `×` cancels immediately; a **running** build's `×` confirms first (see Negative/edge below).

### Step 4 — AC#24: cancel frees the turn-lock → a NEW build starts immediately

1. **Precondition:** immediately after a cancel (e.g. the cancel from step 3, or step 1), with no build currently running a turn.
2. **Observe** the empty composer (placeholder `Describe the workflow or change…`).
3. **Act:** start a **new** build — type `R-fresh-3` = `A workflow that takes a product name and returns a one-line marketing tagline.`, leave settings at defaults, submit **once**.
4. **Wait ≤300s** for the new build to start and progress (the run disclosure shows `Running` / detail `Working…`, then a gate card appears). Poll the page.
5. **Assert** the new build **starts successfully** — the turn-lock was freed by the cancel. There is **NO** turn-busy error banner: the body `a turn is already running — try again in a moment` MUST **not** appear, and no `Open it` collision button is shown. (If the previous cancel had NOT freed the lock, the start would 409 with that banner.)

### Step 5 — AC#24: cancel MID-TURN stops the running turn

1. **Observe** — start a build (or use the new build from step 4) **while a turn is actively running**. A turn is running when the run disclosure shows `Running` and the working detail shows `Working…`. While a turn runs, a `Stop` pill appears at the top-right of the conversation header.
2. **Observe** the top-right `Stop` pill. It is labelled `Stop` with tooltip exactly `Stop the running build`.
3. **Act:** click the `Stop` pill **once** (do NOT also click a gate).
4. **Wait ≤5s. Assert** a confirm dialog opens with exactly:
   - title `Stop this build?`
   - body `Cancel <title>? Its running turn will be stopped and this phase's progress discarded.` — where `<title>` is the build's name/requirement (truncated to 46 chars + `…` if longer). The literal surrounding wording `Cancel ` … `? Its running turn will be stopped and this phase's progress discarded.` MUST match character-for-character.
   - a confirm button labelled exactly `Stop build`.
5. **Act:** click `Stop build` to confirm.
6. **Wait ≤30s. Assert** the running turn **stops** and the build is **cancelled**:
   - the build leaves the `In progress` section (no longer `running`);
   - the run disclosure may show `Stopped during` (the stopped-mid-turn marker) and/or the build renders the cancelled gate card (badge `Cancelled`, title `Build abandoned`, summary `Cancelled by user — the spec/artifacts so far are preserved.`).

---

## Expected

The binding, exact-string assertions:

1. **F1 (Discard from a gate, step 1):** clicking `Discard build` flips the build to terminal cancelled — badge `Cancelled`, title `Build abandoned`, summary `Cancelled by user — the spec/artifacts so far are preserved.` — and the build drops from the sidebar `In progress` section.
2. **F1 (label per gate, step 2):** the low-emphasis cancel is `Discard build` on Analyze / Spec / clean Implement / Test-import gates; the still-failing Implement gate uses `Abandon` instead — `Abandon` ≠ `Discard build`.
3. **F1 (sidebar hover-×, step 3):** hovering an `In progress` row reveals a `×` with tooltip `Cancel this build`; clicking it on a **parked** row cancels the build **immediately** and **without opening** that build's conversation.
4. **AC#24 (lock release, step 4):** immediately after a cancel a new build starts; the turn-busy banner `a turn is already running — try again in a moment` does NOT appear and no `Open it` button is shown.
5. **AC#24 (mid-turn cancel, step 5):** the `Stop` pill (tooltip `Stop the running build`) opens a dialog titled `Stop this build?` with body `Cancel <title>? Its running turn will be stopped and this phase's progress discarded.` and confirm button `Stop build`; confirming stops the running turn and cancels the build (disclosure may show `Stopped during`, cancelled card `Build abandoned` / `Cancelled by user — the spec/artifacts so far are preserved.`).

---

## Negative / edge variants

### N1 — A RUNNING build's `×` may confirm first (accepted variant)

- Hovering and clicking the hover-`×` on a **running** build's row (a live turn, status hint `running`) may first open a confirm dialog (same wording as the Stop dialog: title `Stop this build?`, body `Cancel <title>? Its running turn will be stopped and this phase's progress discarded.`, confirm `Stop build`) **before** cancelling, so a live turn isn't killed by a stray click. **Treat this confirm-first behavior as an ACCEPTED variant** for a running row. By contrast, the **parked** build's `×` (step 3) cancels **immediately** with **no** confirm dialog — that distinction is the assertion: parked = immediate, running = confirm-first.

### N2 — Do NOT double-click a gate or the Stop pill (turn-lock)

- **Assert** the agent clicks `Discard build`, the hover-`×`, the `Stop` pill, and `Stop build` each exactly **once**, then waits. A 2nd action while a turn is running yields the backend 409 body `a turn is already running — try again in a moment` ([00-README §4.8](00-README.md#48-backend-messages-status-banners--4xx-bodies--tasksts-uits-indexts)). Never double-click a gate (it can 409 the turn-lock).

### N3 — Cancel is non-destructive (no data loss)

- **Assert** (observe-only) that after a cancel the build's summary states `Cancelled by user — the spec/artifacts so far are preserved.` — i.e. the spec/artifacts written so far are preserved on disk (`projects/` + `apps/builder/.runs/` are NOT deleted by a cancel). No browser assertion of the filesystem is required here; the on-screen "preserved" wording is the binding signal.

---

## Pass / Fail

**PASS** (all must hold):

- [ ] Step 1: `Discard build` flips the build to cancelled (badge `Cancelled`, title `Build abandoned`, summary `Cancelled by user — the spec/artifacts so far are preserved.`) and the build drops from `In progress`.
- [ ] Step 2: every non-still-failing gate's low-emphasis cancel is `Discard build`; the still-failing Implement gate uses `Abandon` (≠ `Discard build`).
- [ ] Step 3: sidebar hover-`×` shows tooltip `Cancel this build`; clicking it on a parked row cancels immediately WITHOUT opening that build's conversation.
- [ ] Step 4: after a cancel, a new build starts; the banner `a turn is already running — try again in a moment` does NOT appear (lock freed).
- [ ] Step 5: the `Stop` pill (tooltip `Stop the running build`) opens dialog `Stop this build?` with body `Cancel <title>? Its running turn will be stopped and this phase's progress discarded.` and confirm `Stop build`; confirming stops the running turn and cancels the build (may show `Stopped during`).
- [ ] N1: a parked `×` cancels immediately; a running `×` confirming-first is accepted.

**FAIL** if any observed string differs by even one character (including `…`, `·`, `▸`, `—`, `≠`), OR `Discard build` does NOT cancel the build, OR a parked-row `×` opens the conversation instead of cancelling in place, OR a cancel does NOT free the turn-lock (a fresh start 409s with `a turn is already running — try again in a moment`), OR the mid-turn `Stop build` confirm does NOT stop the running turn / cancel the build, OR the still-failing gate exposes `Discard build` instead of `Abandon`.

**Evidence (on any FAIL):** capture a screenshot of the gate card / sidebar row / Stop dialog, and quote the **exact text seen** vs the **expected** string from the [00-README String Dictionary](00-README.md#string-dictionary). For a lock-release failure, quote the 409 banner text seen (`a turn is already running — try again in a moment`) and note that the cancel did not free the lock.

> If a required string is genuinely absent from the [00-README dictionary](00-README.md#string-dictionary), do NOT invent it — omit that sub-assertion and record a **TODO** noting the missing dictionary entry.

---

## Cleanup

1. **Cancel every build this test started or left parked/running.** For each build still listed under the sidebar `In progress` section: hover its row and click the hover-`×` (tooltip `Cancel this build`) — confirming with `Stop build` if it is a running build. Alternatively, open the build and click `Discard build` at its gate (or `Stop` → `Stop build` if a turn is running).
2. **Confirm** the sidebar `In progress` section no longer lists any build started by this test with a `gate` or `running` hint — **no parked or running builds remain**.
3. **Note:** Cancel/Discard is non-destructive — `projects/` and `apps/builder/.runs/` stay on disk (see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)). No filesystem cleanup is required. If **BUILD‑A** is shared with downstream tests that have not yet run, do NOT discard it here — only discard the **fresh** builds this test started (the `R-fresh-2` / `R-fresh-3` short builds and any build started solely for step 1/step 5).

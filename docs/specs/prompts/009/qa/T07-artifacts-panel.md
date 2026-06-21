# T07 — Artifact panel: Spec / main.yml / Diff / Report tabs; lint rows; editable Spec + Save

| Field | Value |
|---|---|
| **ID** | T07 |
| **Title** | Artifact panel: Spec / main.yml / Diff / Report tabs; lint rows; editable Spec + Save |
| **Traces to** | AC#3 (SPEC.md editable, Save feeds Implement) · AC#4 (main.yml + 3 lints + diff/empty-base) · AC#5 (`Deploy: none` → report path, no app_url) |
| **Priority** | P1 |
| **Cost** | 0 real build-turns (read-only; **reuses BUILD‑A** — no new turn is spent) |

Canonical run guide + String Dictionary: [00-README](00-README.md). Every quoted string below is asserted **verbatim** from §4.5 of that file (source: `apps/builder/web/src/components/ArtifactPanel.tsx`). Do **not** normalize the ellipsis `…`, the middot `·`, or the `≠` sign.

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (the SPA loads with no login wall).
- **BUILD‑A exists and is reused.** This is the spine build started by [T02-build-happy-path.md](T02-build-happy-path.md) with `Workflow: none`, `Confirm: each step`, `Deploy: none`, requirement `R-fresh`.
- ⚠️ **WHERE TO FIND BUILD‑A — read this before declaring it "missing":** the **`In progress` sidebar section lists ONLY non-terminal (parked/running) builds.** Once BUILD‑A reaches `done` (for the Report tab, you *want* it done), it **leaves `In progress`** and appears in the **`Projects` tree** instead (it scaffolded `projects/<slug>/` at the Spec gate). To reuse a `done` BUILD‑A, open it from the **Projects tree** (the newest project/workflow/task from R‑fresh), **not** `In progress`. A fresh QA-agent session has no memory of the T02 run, so verify by state, not by recollection: BUILD‑A's task id is whatever T02 produced (e.g. seen as `.runs/<taskId>/analyze.json` in the ① output). Do **not** confuse it with the stale leftover parked builds.
- For full coverage this test reads artifacts that appear **progressively**:
  - **Spec tab** needs BUILD‑A to have reached **≥ Spec gate** (after phase ②).
  - **main.yml + Lint + Diff tabs** need BUILD‑A to have reached **≥ Implement gate** (after phase ③).
  - **Report tab** needs BUILD‑A `status: done` (after phase ④ Test).
- **STOP + report** if BUILD‑A is not present or its artifacts are absent at the phase you expect (e.g. you opened the panel and the Spec tab is missing although the build passed ②). Do **not** start a fresh build to manufacture artifacts — that would spend turns; this test is Cost 0.
- This test spends **no build-turns** and does **not** click any gate button, so it never touches the turn-lock. No 300 s waits are required; the only waits are short UI render waits (≤ 10 s).

> **Phase-state note for the runner:** if BUILD‑A is currently parked *before* a given gate, that tab will legitimately be empty/absent and you assert the **empty-state** string for it (Steps 3a/4 empty variants). When BUILD‑A reaches the later gates (run T07 again after T02 finishes BUILD‑A to `done`, per §1.4), re-run Steps 4–6 for the populated assertions. Record which phase BUILD‑A was at when you ran each step.

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**, against exact strings.

### 1. Open the artifact panel
1. **Observe** the conversation view for BUILD‑A. In the top bar there is a pill button labeled **`Artifact`** (icon + the literal text `Artifact`). Source: `App.tsx:161–162`.
2. **Act:** click the **`Artifact`** button.
3. **Wait** (≤ 5 s) for the right-hand panel to slide in.
4. **Assert** the panel header shows the title **`Artifact`** (exact). A sub-line below it shows the build's slug/name (e.g. the derived slug, or `new workflow` if not yet scaffolded) — do **not** assert an exact slug here (it varies per build); only assert the title `Artifact` is present.
5. **Assert** the close control exists: a button whose tooltip/title is exactly **`Hide panel`** (source `ArtifactPanel.tsx:210`). Do **not** click it yet.

### 2. Tabs — exact casing and progressive appearance
1. **Observe** the tab strip directly under the panel header.
2. **Assert the tab labels are EXACTLY**, in this order, drawn from the set: **`Spec`** · **`main.yml`** · **`Diff`** · **`Report`** (source `ArtifactPanel.tsx:194–197`).
   - **Negative — the old plan is wrong:** there must be **NO** tab labeled `Yaml`. Per [00-README](00-README.md) §1 and §4.5, the YAML tab label is **`main.yml`**, not `Yaml`. If you see a tab literally labeled `Yaml`, that is a **FAIL** (quote it as evidence).
3. **Assert progressive appearance** (which tabs are *present* depends on BUILD‑A's phase; source `App.tsx:20–30`):
   - **`Spec`** appears once phase **②** is reached (or `artifactContents.spec` exists).
   - **`main.yml`** appears once phase **③ Implement** is reached (and phase ≠ `analyze`) — or `artifactContents.yaml` exists.
   - **`Diff`** appears **only when a diff payload exists** (`artifactContents.diff` is non-null). Because the diff producer is a known Lát 5 item, the **Diff tab may legitimately be absent** even after a completed Implement — see Step 5 for how to record that.
   - **`Report`** appears once `status: done` (or `artifactContents.report` exists).
4. **Record** which tabs are present right now and the phase BUILD‑A is at, so the populated vs empty assertions below are unambiguous.

### 3. SPEC tab (AC#3)
**3a. If BUILD‑A has NOT yet reached the Spec gate (parked at Analyze):**
1. **Act:** click the **`Spec`** tab if present; if the `Spec` tab is absent, that itself confirms pre-② state.
2. **Assert** the empty-state text reads exactly: **`No SPEC.md yet — it appears after the Spec phase.`** (source `ArtifactPanel.tsx:45`). Use the em dash `—`, not a hyphen.
3. Then SKIP to Step 4; revisit 3b when BUILD‑A reaches the Spec gate.

**3b. When BUILD‑A HAS reached ≥ Spec gate (the editable-spec assertions):**
1. **Observe / Act:** click the **`Spec`** tab.
2. **Wait** (≤ 5 s) for the tab body to render.
3. **Assert** the section title is exactly **`SPEC.md`** (source `ArtifactPanel.tsx:44`).
4. **Assert** an **editable `<textarea>`** is present and contains the spec text (non-empty).
5. **Assert** the footer note reads exactly **`API token redacted · never shown`** (source `:59`) — note the middot `·`.
6. **Assert initial Save state:** the save-status line reads exactly **`Saved · feeds Implement`** (source `:55`), and the **`Save spec`** button is present but disabled (it shows reduced opacity when there are no unsaved edits; source `:50`).
7. **Act:** type/append a small change into the textarea (e.g. append a single space or a short word at the end). Do not clear it (the blank-save guard is T10's job).
8. **Wait** (≤ 3 s) for the status line to update.
9. **Assert** the status now reads exactly **`Unsaved changes`** (source `:56`), and the **`Save spec`** button is now enabled.
10. **Act:** click **`Save spec`**.
11. **Wait** (≤ 10 s) for the save round-trip (`PUT /api/tasks/:id/spec`).
12. **Assert (transient):** during save the button label briefly reads **`Saving…`** (source `:51`, with the ellipsis `…`). This is a fast transition — if you miss it, do not fail on the transient alone; the binding check is the next assertion.
13. **Assert (settled):** after save completes the status line returns to exactly **`Saved · feeds Implement`** and the `Save spec` button is disabled again.
14. **Known follow-up gap (do NOT fail T07 on it):** verifying that a *subsequent* Implement turn actually consumes the edited SPEC.md (the "feeds Implement" semantics end-to-end) is a deeper check than the panel exposes. The panel only proves the edit was persisted. Record this as a follow-up note; the AC#3 deep wire-through is covered separately. **T07 passes on the persisted-save behavior above.**

### 4. main.yml tab (AC#4)
1. **Observe / Act:** click the **`main.yml`** tab (exact label).
2. **Wait** (≤ 5 s) for render.
3. **If BUILD‑A has NOT reached Implement (no `main.yml` yet):** assert the empty-state text reads exactly **`No main.yml yet — it appears after the Implement phase.`** (source `:85`), then SKIP to Step 6 and revisit when Implement completes.
4. **When Implement has completed:**
   - **Assert** the YAML body renders in a code block whose header names the file **`main.yml`** and a lang line of the form `yaml · {N} lines` (the `·` middot and a line count). Assert the YAML body is non-empty.
   - **Assert** a section titled exactly **`Lint results`** (source `:90`) is present.
   - **Assert** the lint list has **exactly three rows**, with names **`validate_workflow`**, **`lint_refs`**, **`lint_plugin_hashes`** (source `:68–70` / dictionary §4.5), in that order.
   - **Assert** each of the three rows shows the pass message exactly **`ok`** (source `:98`; rendered when the linter exit code is `0`).
   - **Negative:** if any row instead shows **`exit {code}`** (e.g. `exit 1`), that means a linter did not return 0 — for a *clean* BUILD‑A (R-fresh) this would be a FAIL of AC#4; quote the row name + the exact `exit …` text. (A still-failing build is a different scenario — see [T03](T03-gates-and-decisions.md)/[T04](T04-confirm-modes.md); BUILD‑A is expected clean.)

### 5. Diff tab (AC#4)
1. **Observe:** check whether a **`Diff`** tab is present (it appears only when a diff payload exists — see Step 2.3).
2. **Case A — `Diff` tab present:**
   - **Act:** click **`Diff`**.
   - **Wait** (≤ 5 s) for render.
   - **Assert** the section title is exactly **`Split diff`** (source `:113`/`:121`).
   - **If a diff payload renders:** for a **NEW** workflow (BUILD‑A has `Workflow: none`, no seed) the split diff shows **additions against an empty base** (the produced `main.yml` shown as added lines). Assert added-line content is present.
   - **If instead the placeholder shows:** assert it reads exactly **`No diff yet — the seed/pattern diff producer lands in Lát 5.`** (source `:114`). After a **completed** Implement this is a degraded path — **record it as a finding** (the diff producer did not emit a payload), but it is the documented Lát 5 gap, so do **not** hard-fail T07 on it; note it explicitly in Evidence.
3. **Case B — `Diff` tab absent after a completed Implement:** because the tab is gated on `artifactContents.diff` being non-null (`App.tsx:27`), an absent Diff tab is the same Lát 5 producer gap. **Record it as a finding** (tab not surfaced; the empty-state string from §4.5 has no place to render). Do **not** hard-fail T07 on it — note it in Evidence as "Diff tab absent (Lát 5 diff producer not landed)".

### 6. Report tab (AC#5, after `done`)
1. **Observe / Act:** click the **`Report`** tab (exact label).
2. **Wait** (≤ 5 s) for render.
3. **If BUILD‑A is NOT yet `done`:** assert the empty-state text reads exactly **`No report yet — it appears after the Test phase.`** (source `:132`), then revisit this step when BUILD‑A reaches `done`.
4. **When BUILD‑A `status: done` (`Deploy: none`):**
   - **Assert** the section title is exactly **`Run report`** (source `:131`/`:146`).
   - **Assert** the report rows (source `:139–143`, dictionary §4.5):
     - A row keyed **`Workflow file`** whose value is the `main.yml` path (a non-empty path, not `—`).
     - A row keyed **`Lint`** whose value is exactly **`all passed`** (clean BUILD‑A; the alternate value `failures recorded` would indicate a lint failure — a FAIL for clean BUILD‑A).
     - A row keyed **`Deploy`** whose value is exactly **`not deployed (local)`** (source `:141`; this is what `Deploy: none` renders).
   - **Assert NO app_url "DEPLOYED" card:** there must be **NO** card with the meta label `DEPLOYED · …` and **NO** `Open` button (source `:158/:161`; that card renders only when `report.app_url` is set, which `Deploy: none` never sets).
   - **Assert the deploy note** for `Deploy: none` reads exactly: **`Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.`** (source `:173`). Reproduce the em dash `—` and the `≠` sign exactly; the on-screen ampersand is the literal `&` (the `&amp;` in source is HTML-escaped and renders as `&`).
   - **Negative:** there must be **no** `Accepted` row reading `lint failure overridden (human)` for clean BUILD‑A (that only appears when a lint failure was overridden; source `:143`). If it appears, quote it.

### 7. Close the panel (sanity)
1. **Act:** click **`Hide panel`** (the close button from Step 1).
2. **Wait** (≤ 3 s).
3. **Assert** the artifact panel is no longer visible. (This is a UI sanity check; it does not alter BUILD‑A state.)

---

## Expected

Binding assertions (exact strings; all sourced from [00-README](00-README.md) §4.5):

- Panel header title **`Artifact`**; close tooltip **`Hide panel`**.
- Tab labels are exactly **`Spec`** · **`main.yml`** · **`Diff`** · **`Report`** — **never** `Yaml`. Tabs surface progressively (Spec after ②, main.yml after ③, Report after `done`; Diff only when a diff payload exists).
- **Spec tab (populated):** title **`SPEC.md`**; editable textarea with the spec; footer **`API token redacted · never shown`**; initial status **`Saved · feeds Implement`**; after edit **`Unsaved changes`**; on Save the button shows **`Saving…`** then status returns to **`Saved · feeds Implement`**.
- **Spec tab (pre-②):** **`No SPEC.md yet — it appears after the Spec phase.`**
- **main.yml tab (populated):** YAML shown; **`Lint results`** section; three rows **`validate_workflow`**, **`lint_refs`**, **`lint_plugin_hashes`**, each showing **`ok`**.
- **main.yml tab (pre-③):** **`No main.yml yet — it appears after the Implement phase.`**
- **Diff tab:** title **`Split diff`**; for a new (seed-less) workflow, additions against an empty base. Degraded/absent diff after a completed Implement is recorded as a **finding** (Lát 5 producer gap), not a hard fail; the placeholder, if shown, reads exactly **`No diff yet — the seed/pattern diff producer lands in Lát 5.`**
- **Report tab (`done`, `Deploy: none`):** title **`Run report`**; row **`Workflow file`** = the main.yml path; row **`Lint`** = **`all passed`**; row **`Deploy`** = **`not deployed (local)`**; **no** `DEPLOYED · …` card and **no** `Open` button; deploy note **`Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.`**
- **Report tab (pre-`done`):** **`No report yet — it appears after the Test phase.`**
- **Known non-blocking gaps:** (a) the end-to-end "edited SPEC.md is consumed by the next Implement turn" check is a follow-up, not asserted here; (b) the Diff producer is a Lát 5 item — an absent/degraded Diff tab is a finding, not a fail.

---

## Negative / edge variants

- **No `Yaml` tab:** the old `ui-test-plan.md` quoted a tab named `Yaml`. The authoritative label is **`main.yml`**. Seeing `Yaml` is a FAIL (covered in Step 2.2).
- **No false `DEPLOYED` card for `Deploy: none`:** the app_url card and `Open` button must be absent; the note must be the `≠`-bearing string (Step 6 negative).
- **Lint rows must read `ok`, not `exit …`:** any `exit {code}` row on clean BUILD‑A is a FAIL of AC#4 (Step 4 negative).
- **No `Accepted` row** on a clean build (Step 6 negative).
- **Clearing the Spec and saving** (the blank-save `SPEC.md cannot be empty` 400 guard, dictionary §4.8) is **out of scope here** — it is covered in [T10-validation-negative.md](T10-validation-negative.md). Do **not** clear-and-save in this test.
- **Diff tab absent vs present-but-empty:** both are acceptable Lát-5 outcomes and recorded as findings (Step 5), not fails.

---

## Pass / Fail

**PASS** (binary) requires ALL of:
- Panel opens via **`Artifact`**, header reads **`Artifact`**, close tooltip reads **`Hide panel`**.
- Tab labels match the exact set (`Spec` · `main.yml` · `Diff` · `Report`) with **no** `Yaml` tab, and surface progressively per BUILD‑A's phase.
- For each phase reached by BUILD‑A, the corresponding populated/empty strings match **exactly** (Spec, main.yml + three `ok` lint rows, Report rows + the `≠` deploy note with no app_url card).
- Diff behavior is asserted (additions vs documented Lát 5 placeholder/absence recorded as a finding).

**FAIL** if any asserted string differs character-for-character (including `…` `·` `—` `≠`), OR a `Yaml` tab exists, OR a lint row shows `exit {code}` on clean BUILD‑A, OR a `DEPLOYED`/`Open` app_url card appears for `Deploy: none`, OR the deploy note is missing/altered.

**Not a fail (record as finding only):** Diff tab absent or showing the Lát 5 placeholder after a completed Implement; the SPEC-feeds-Implement end-to-end deep check (follow-up gap).

**Evidence on FAIL:** capture a screenshot of the artifact panel/tab in question, and **quote the exact text seen vs the expected string** from the dictionary (cite the §4.5 row). For findings (Diff/SPEC gaps), note exactly what was observed and the phase BUILD‑A was at.

---

## Cleanup

- This test starts **no** build and clicks **no** gate, so there is **no parked turn** to release and **no turn-lock** to clear.
- **Leave BUILD‑A intact** for the reuse chain ([T06](T06-recovery-reconnect.md) → [T09](T09-confirm-mode-patch.md) → [T08](T08-cancel-discard.md) → [T10](T10-validation-negative.md), per [00-README](00-README.md) §1.4). Do **not** Discard BUILD‑A here.
- Note: Step 3b edits SPEC.md and Saves it (a persisted change to BUILD‑A's `SPEC.md`). That is intentional and harmless (last-writer-wins; the edit is a tiny appended token). No revert is required — downstream tests do not depend on the exact spec text.
- Close the artifact panel via **`Hide panel`** (Step 7) to leave the UI in a neutral state.
- **If this test was run standalone** (no shared BUILD‑A in the reuse chain) and you started a build solely to obtain artifacts, **Discard** that build now: open its gate and click **`Discard build`** (Analyze/Spec/Implement-clean gates) or **`Abandon`** (Implement still-failing gate) per dictionary §4.4, so no parked turn is left holding context. Leave no parked turns.
- No filesystem cleanup is required: Cancel/Discard is non-destructive (`projects/` + `.runs/` stay on disk per §1.3).

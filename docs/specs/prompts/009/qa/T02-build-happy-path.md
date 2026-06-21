# T02 — Full 4-phase build (Deploy:none, each step) → done; optimistic-dup regression; slug propose

| Field | Value |
|---|---|
| **ID** | T02 |
| **Title** | Full 4-phase build (Deploy:none, each step) → done; optimistic-dup regression; slug propose |
| **Traces to** | AC#2 (Analyze stops) · AC#3 (Spec writes `SPEC.md` & stops) · AC#4 (Implement → `main.yml`, 3 lints) · AC#5 (Test&Report none → path, no app_url) · AC#6 (each-step pauses at every gate) · AC#16 (inline gate buttons) · AC#18 (slug+name proposed at Spec gate) · AC#8 (validate→fix self-correct, OBSERVE only) · regression-of-optimistic-dup |
| **Priority** | P0 |
| **Cost** | ~3 real build-turns (this is **BUILD‑A** in [00-README §1.4](00-README.md#14-run-order--the-build-reuse-plan-cost-discipline); T03/T06/T07/T08/T09/T10 reuse it) |

> Single source of truth for every quoted string below: **[00-README — String Dictionary](00-README.md#4-string-dictionary)**. Do not paraphrase; assert verbatim.

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (see [00-README §1.1](00-README.md#11-preconditions-human-one-time)). If the page does not load, **STOP and report** — do not proceed.
- **Clean app:** no build is currently running and no gate is parked from a prior test. If a build is already in progress, this is **not** a clean start — **STOP and report** (or finish/Discard the prior build first), because BUILD‑A must be the one this test starts.
- Settings (the chip row below the composer — [00-README §4.1](00-README.md#41-empty-state--composer-apptsx-chattsx)) set to:
  - **Workflow** = `none (new)`
  - **Confirm** = `each step`
  - **Deploy** = `none`
  - To verify before starting: observe the three chips read `Workflow` `none (new)`, `Confirm` `each step`, `Deploy` `none`. If any differs, click the chip and select the correct option. If a chip is disabled (greyed), a build is already live → **STOP and report** (precondition unmet).

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. A build turn is real model spend and can take up to ~5 min — never re-click a gate while waiting (a 2nd click can `409` the turn-lock with `a turn is already running — try again in a moment`).

### Step 1 — Submit the requirement (kicks off Phase ① Analyze)

1. **Observe:** the empty-state composer shows placeholder `Describe the workflow or change…` and the crumb `New task`.
2. **Act:** click the composer textarea and type the requirement **R-fresh** exactly:
   `A workflow that takes a topic string as input and returns a one-paragraph summary of it.`
   Then click **Send** (the submit control; or press the submit key).
3. **Wait (≤10s):** poll until the view switches from the empty state to the conversation/thread view.
4. **Assert** (all must hold):
   - The phase track is visible with labels, in order: `Analyze` · `Spec` · `Implement` · `Test`.
   - A run disclosure for the first phase shows `Running` with detail `Working…`.

### Step 2 — Wait for the Analyze gate (AC#2: Analyze stops)

1. **Observe:** the Analyze run disclosure currently reads `Running` / `Working…`.
2. **Act:** none — just wait. (Do **not** click anything.)
3. **Wait (≤300s):** poll the page until a gate card appears. If no gate appears within 300s, **STOP and report** (capture screenshot; quote what is on screen) — do **not** re-submit.
4. **Assert** the Analyze gate exactly:
   - Badge: `Analyze complete`
   - Title: `Ready to write the spec`
   - Summary lines (both): `Requirement analyzed.` and `Continue to draft the spec, or request changes.`
   - Buttons present, exact labels (AC#16, inline gate buttons): `Continue to Spec` · `Request changes` · `Discard build`

### Step 3 — REGRESSION: optimistic-dup (exactly one Analyze run, no dangling "Running")

1. **Observe:** with the Analyze gate now showing, look at the run disclosures in the thread for the Analyze phase.
2. **Act:** none (read-only check).
3. **Wait:** n/a (the gate is already present from Step 2).
4. **Assert:**
   - There is **exactly ONE** Analyze run disclosure in the thread.
   - There is **NO** second/dangling Analyze entry still showing `Running` / `Working…` after the gate appeared. (Regression guard: the gate must not leave a duplicate "Running Analyze" disclosure behind it.)

### Step 4 — Continue to Spec → wait for the Spec gate (AC#3 stop, AC#18 slug/name)

1. **Observe:** the Analyze gate buttons `Continue to Spec` · `Request changes` · `Discard build`.
2. **Act:** click `Continue to Spec` **once**. (Do not double-click — a 2nd click can `409` the turn-lock.)
3. **Wait (≤300s):** poll until the Spec gate card appears (the run disclosure for Spec will pass through `Running` / `Working…` first). If nothing appears within 300s, **STOP and report**.
4. **Assert** the Spec gate exactly:
   - Badge: `Spec ready`
   - Title: `Spec drafted — review before I build`
   - Summary line: `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`
   - Buttons, exact labels: `Implement this spec` · `Edit spec` · `Discard build`
   - A gate-strip link is present: `open SPEC.md`.
   - **AC#18 (slug + name proposed):** a proposed slug/name for this new workflow is shown. Confirm by clicking `open SPEC.md` (or any artifact tab) to reveal the artifact panel and reading its sub-header (`ah-sub`, [ArtifactPanel.tsx:208](00-README.md#45-artifact-panel-artifactpaneltsx)): it shows the proposed workflow slug/name (a non-empty value, **not** the literal fallback `new workflow`). Assert a concrete slug/name string is displayed.
   - (AC#3: `SPEC.md` now exists on disk and is editable — the byte-level verification of `SPEC.md` content + Save is done in [T07-artifacts-panel.md](T07-artifacts-panel.md); here we only assert the gate + that `open SPEC.md` opens a non-empty Spec tab.)

### Step 5 — Implement this spec → wait for the Implement gate (AC#4; AC#8 observe-only)

1. **Observe:** the Spec gate buttons `Implement this spec` · `Edit spec` · `Discard build`.
2. **Act:** click `Implement this spec` **once**.
3. **Wait (≤300s):** poll until the Implement gate card appears (Implement run passes through `Running` / `Working…`). If nothing appears within 300s, **STOP and report**.
4. **Assert** the Implement gate (clean path expected) exactly:
   - Badge: `Implemented`
   - Title: `main.yml built and linted`
   - Summary line: `Workflow YAML generated; all linters green.`
   - Buttons, exact labels: `Continue to Test` · `Request changes` · `Discard build` (AC#4)
   - Gate-strip links present: `main.yml` and `view diff`.
5. **AC#8 — OBSERVE ONLY:** the Implement turn may self-correct lint errors internally (validate→fix) and still land on the **clean** gate above. We do **not** force a failure here. If, instead, the gate shows badge `Lint still failing` / title `Still failing after the cap-5 attempts` with buttons `Accept anyway` · `Keep trying` · `Abandon`, that is the still-failing variant — **note it as an observation** (it is the exception, not the expected path) and treat the clean-gate assertion as not-met for this run; forcing a still-failing lint is **Impl‑CLI‑1** (see [00-README §5](00-README.md#5-appendix-not-browser-testable)).

### Step 6 — Continue to Test → build advances straight to done (AC#5; Deploy:none has no 4th turn)

1. **Observe:** the Implement gate buttons `Continue to Test` · `Request changes` · `Discard build`.
2. **Act:** click `Continue to Test` **once**.
3. **NOTE (expected, do not flag as a defect):** with **Deploy:none**, Phase ④ Test is **backend-only** — there is **NO** `Running` turn for Test and **NO** 4th gate. The build advances straight to the **Done** state. (See "Note on AC#6" below.)
4. **Wait (≤120s):** poll until the **Done** state appears. If nothing appears within 120s, **STOP and report**.
5. **Assert** the Done gate exactly (AC#5):
   - Badge: `Done`
   - Title: `Test passed — workflow updated`
   - Summary lines (both): `Linters re-run on the produced main.yml.` and `Open the report in the panel for the details.`
   - A gate-strip link is present: `open report`.
   - **AC#5 (none → path, no app_url):** the report contains no deployed app URL. Click `open report` to open the Report tab; assert the `Deploy` row reads `not deployed (local)` and the deploy note reads `Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.` There is **no** `DEPLOYED · {deploy}` app_url card and **no** `Open` button. (Full report-row detail is re-asserted in [T07-artifacts-panel.md](T07-artifacts-panel.md).)

> **Note on AC#6 (gate count):** in **each-step + Deploy:none** there are exactly **3 confirmable gates** — after ① Analyze, ② Spec, ③ Implement. The 4th pause (the **Import** gate, with buttons `Import to Dify` · `Skip import` · `Discard build`) exists **only** for `Deploy: selfhost` (see [T12-deploy-dify.md](T12-deploy-dify.md)). **Do not be surprised by the missing 4th gate after `Continue to Test`** — its absence here is correct, not a bug.

---

## Expected

Binding assertions (all exact, from [00-README §4](00-README.md#4-string-dictionary)):

- **Phase track:** `Analyze` · `Spec` · `Implement` · `Test`; first-phase run shows `Running` + `Working…`.
- **Analyze gate (AC#2):** `Analyze complete` / `Ready to write the spec` / `Requirement analyzed.` + `Continue to draft the spec, or request changes.` / buttons `Continue to Spec` · `Request changes` · `Discard build`. Build **stops** here (no auto-advance).
- **Regression (optimistic-dup):** exactly ONE Analyze run disclosure; no dangling `Running`/`Working…` Analyze entry after the gate.
- **Spec gate (AC#3, AC#18):** `Spec ready` / `Spec drafted — review before I build` / `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).` / buttons `Implement this spec` · `Edit spec` · `Discard build` / `open SPEC.md` link / a concrete proposed slug+name shown (not the `new workflow` fallback). Build **stops**.
- **Implement gate (AC#4):** `Implemented` / `main.yml built and linted` / `Workflow YAML generated; all linters green.` / buttons `Continue to Test` · `Request changes` · `Discard build` / `main.yml` + `view diff` links. Build **stops**.
- **Done (AC#5):** `Done` / `Test passed — workflow updated` / `Linters re-run on the produced main.yml.` + `Open the report in the panel for the details.` / Report `Deploy` row `not deployed (local)` + note `Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.`; **no** app_url card / `Open` button.
- **AC#6:** exactly 3 confirmable gates in this configuration; no 4th gate after `Continue to Test`.

---

## Negative / edge variants

- **Deferred to [T10-validation-negative.md](T10-validation-negative.md):** empty-requirement (`requirement is required`, 400) and double-click-gate / turn-lock collision (`a turn is already running — try again in a moment`, 409). Those negatives are **not** exercised here to keep BUILD‑A clean for reuse.
- **In-test edge (observe-only, do not force):** at Step 5 the Implement gate could legitimately land on the **still-failing** variant (`Lint still failing` / `Still failing after the cap-5 attempts` / `Accept anyway` · `Keep trying` · `Abandon`). If it does, record it as an observation and route to **Impl‑CLI‑1**; do not treat the deterministic R-fresh requirement as expected to fail.

---

## Pass / Fail

**PASS** — binary, all of the following are true:
1. Each of the 3 gates (Analyze, Spec, Implement) appeared within its ≤300s window, the build **stopped** at each (no auto-advance), and every quoted badge/title/summary/button string above matched **character-for-character**.
2. The optimistic-dup regression held: exactly one Analyze run disclosure, no dangling `Running` Analyze entry.
3. The Spec gate showed a concrete proposed slug+name (AC#18), not the `new workflow` fallback.
4. After `Continue to Test`, the build reached **Done** within ≤120s with the exact Done strings, and the Report showed no app_url (`not deployed (local)` + the `Deploy is off…` note).
5. No 4th gate appeared (correct for Deploy:none).

**FAIL** — any of: a gate did not appear within its timeout; any asserted string differs (including punctuation: ellipsis `…`, em dash `—`, middot `·`); a duplicate/dangling `Running` Analyze disclosure remained; the build auto-advanced past a gate without a click; the Spec gate showed `new workflow` (no proposed slug/name); an app_url card/`Open` button appeared under Deploy:none; or an unexpected error gate appeared (`Phase failed` / `<phase> errored`).

**Evidence (on any FAIL):** capture a screenshot of the offending gate/state and **quote the exact text seen vs the expected string** from the dictionary. For a missing-gate timeout, also note the last-seen run-disclosure text and how long was waited.

---

## Cleanup

- **If this test is run as part of the shared-build plan:** BUILD‑A is now in the **Done** terminal state — **LEAVE it as-is**. It is reused by [T07-artifacts-panel.md](T07-artifacts-panel.md) (artifacts) and [T10-validation-negative.md](T10-validation-negative.md) (done-composer). Do **not** Discard or Cancel it.
- **If this test is run standalone** (not feeding later tests): the build is in a terminal `done` state, so there is no parked turn and nothing holds the turn-lock — no Cancel/Discard is required. You may leave it done, or start fresh on the next run.
- **If the test was aborted mid-build** (e.g. you STOPPED at a gate due to a timeout or a failed assert), the build is parked at a gate holding context: click `Discard build` on the visible gate (or use the sidebar hover-× `Cancel this build`) to free the turn-lock before exiting. Cancel is non-destructive — `projects/` and `.runs/` stay on disk (see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)).
- **Filesystem note:** a completed BUILD‑A scaffolds a new workflow under `projects/<proposed-slug>/` (with its `.runs/<id>/` artifacts). This is expected; no manual filesystem cleanup is needed for the suite. If you must reset for a truly fresh standalone re-run, remove only the newly created `projects/<proposed-slug>/` directory you just generated.

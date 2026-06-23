# T04 — Confirm modes: auto / spec only / each step (+ auto still-failing hard-stop)

| Field | Value |
|---|---|
| **ID** | T04 |
| **Title** | Confirm modes — `auto` (hands-free), `spec only` (one pause at Spec), `each step` (every gate); `auto` + still-failing → HARD-STOP |
| **Traces to** | AC#15 (mode behaviors) · AC#6 (each step → pause at each gate) · AC#25 (auto still-failing hard-stop) · cross-ref AC#20 (cap-5 still-failing gate) |
| **Priority** | P0 (`spec only` sub-test 2 is P1) |
| **Cost** | ~3 real build-turns for `auto` (**BUILD‑B**); +~3 if the optional `spec only` sub-test is run; sub-test 3 is read-only (reuses T02's evidence); sub-test 4 is `obs + CLI` (0 forced) |

Canonical run guide + String Dictionary: [00-README](00-README.md). Every quoted string below is verbatim from that dictionary — do not normalize punctuation (`…` `·`).

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (see [00-README §1.1](00-README.md#11-preconditions-human-one-time)). If the page does not load, **STOP and report** — do not proceed.
- **Clean / empty state**: no build is currently running (no `Stop` pill visible; the composer shows the empty-state placeholder `Describe the workflow or change…`). The sidebar `In progress` section should be empty. If a turn is already running, **STOP and report** (a concurrent start will 409 — that is T05's concern, not this file's).
- Model auth is configured (`claude auth login`) so a real turn can run. If sub-test 1 never advances past `Running` within the timeouts, treat as environment failure and **STOP + report** (do not re-click any gate).

> Budget note: sub-test **1 (auto)** is the mandatory P0 spend (BUILD‑B, ~3 turns). Sub-test **2 (spec only)** is P1 and **optional** — run it only if budget allows (+~3 turns). Sub-test **3 (each step)** spends nothing (it cites T02). Sub-test **4** forces nothing in the browser.

---

## Steps

### Sub-test 1 — AUTO: hands-free ① → ② → ③ → ④ with NO gate click (AC#15) · BUILD‑B · ~3 turns

1. **Observe** the empty state. Confirm the composer placeholder reads exactly `Describe the workflow or change…` and the three setting chips below the input are present: `Workflow`, `Confirm`, `Deploy`.
2. **Act**: set the **`Confirm`** chip to the option labelled `auto`. **Assert** the chip now shows `auto`.
3. **Act**: set the **`Deploy`** chip to `none`. **Assert** the chip now shows `none`.
4. **Act**: leave the **`Workflow`** chip at `none (new)` (its value-when-none). **Assert** it shows `none (new)`.
5. **Act**: click into the composer and type **R-fresh-2** exactly:
   `A workflow that takes a city name and returns a short weather-style description string.`
6. **Act**: press Enter (or click the send button) **once**. **Do NOT click again** — a second start can 409 the turn-lock.
7. **Wait ≤300s**: poll the page until the run disclosure shows `Running` with **`① Analyze`** (the disclosure label is `Running` per dict §4.2; the phase chip reads `Analyze`). **Assert** a `Stop` pill is now visible (dict §4.7: pill text `Stop`).
8. **Wait ≤300s**: poll until **②Spec** begins **without any gate card appearing in between**. The signal that Analyze auto-advanced is that the disclosure moves to `Running` `② Spec` (or the `Analyze` step shows a completed check in the phase track `Analyze · Spec · Implement · Test`) and **no card bearing badge `Analyze complete` / title `Ready to write the spec` ever required a click**. **Assert**: at no point did a gate card with action button `Continue to Spec` appear awaiting a click.
9. **Wait ≤300s**: poll until **③Implement** begins. **Assert**: no gate card with badge `Spec ready` / title `Spec drafted — review before I build` ever required a click (no `Implement this spec` button was clicked).
10. **Wait ≤300s** (the ④Test boundary for `Deploy: none` is **backend-only — no turn**, see [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)): poll until the build reaches the terminal **Done** card.
11. **Assert** the terminal gate card shows, verbatim:
    - badge `Done`
    - title `Test passed — workflow updated`
    - summary lines `Linters re-run on the produced main.yml.` and `Open the report in the panel for the details.`
12. **Assert** the phase track `Analyze · Spec · Implement · Test` shows all four steps in the done/checked state, and **no** `awaiting_confirm` gate ever required a human click anywhere in the run.
13. **Assert** total elapsed for steps 7→11 was within **~900s** (3 × 300s per-turn budget). If a single boundary exceeds 300s with no new signal, **STOP and report** (do not click).

> Why no gate clicks: backend `boundaryAutoAdvances` returns `true` for `mode === 'auto'` at every phase (orchestrator.ts:283), so `maybeAutoAdvance` auto-confirms each boundary; only the terminal ④ has no confirm action and lands on `Done`.

### Sub-test 2 — SPEC ONLY: exactly ONE pause, at the Spec gate (AC#15) · P1, OPTIONAL · ~3 turns

> Run only if budget allows. Requires a fresh empty state (sub-test 1's BUILD‑B must already be `Done`, leaving no running turn).

1. **Observe** the empty state (placeholder `Describe the workflow or change…`).
2. **Act**: set **`Confirm`** to `spec only`; set **`Deploy`** to `none`; leave **`Workflow`** at `none (new)`. **Assert** the `Confirm` chip shows `spec only`.
3. **Act**: type a fresh requirement (use **R-fresh-3** to avoid a slug collision with sub-test 1): `A workflow that takes a product name and returns a one-line marketing tagline.`
4. **Act**: send **once**.
5. **Wait ≤300s**: poll until `Running` `① Analyze` shows. **Assert** a `Stop` pill is visible.
6. **Wait ≤300s**: poll until **②Spec**. **Assert**: ①Analyze **auto-advanced** — no gate card with badge `Analyze complete` / button `Continue to Spec` required a click (spec_only auto-advances every phase **except** `spec`, orchestrator.ts:284).
7. **Wait ≤300s**: poll until a gate card appears with, verbatim:
    - badge `Spec ready`
    - title `Spec drafted — review before I build`
    - summary `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`
    - a primary action button labelled exactly `Implement this spec` (dict §4.4).
   **Assert** this card is present and the build is **paused** here (the `Stop` pill may toggle to a parked state; the gate card is interactive). This is the ONLY expected pause.
8. **Act**: click **`Implement this spec`** **once**. **Do not double-click** (a 2nd confirm can 409 / stale-action 409 → `'${actionId}' is not a current confirm action`).
9. **Wait ≤300s**: poll until ③Implement runs and then auto-advances. **Assert**: no gate card with badge `Implemented` / button `Continue to Test` required a click (spec_only auto-advances `implement`).
10. **Wait ≤300s** (④ none = backend-only): poll until the terminal **Done** card: badge `Done`, title `Test passed — workflow updated`.
11. **Assert net behavior**: exactly **ONE** human pause occurred for the whole build — at the **Spec** gate. Analyze and Implement gates auto-advanced; ④ landed on `Done`.

### Sub-test 3 — EACH STEP: pause at every gate (AC#6) · read-only, 0 turns

> `each step` is already proven by [T02-build-happy-path.md](T02-build-happy-path.md) and [T03-gates-and-decisions.md](T03-gates-and-decisions.md), which drive **BUILD‑A** (`Confirm: each step`, `Deploy: none`) and click through every gate. This sub-test **re-asserts the binding claim** against that build's evidence — it spends **no** new turn.

1. **Observe** the BUILD‑A run from T02/T03 (or, if reusing live, the build parked at a `each step` gate).
2. **Assert** that for `Deploy: none` with `Confirm: each step`, the build paused at **three** gates, each requiring a human click — verbatim per dict §4.3/§4.4:
    - **Analyze gate** — badge `Analyze complete`, title `Ready to write the spec`, primary button `Continue to Spec`.
    - **Spec gate** — badge `Spec ready`, title `Spec drafted — review before I build`, primary button `Implement this spec`.
    - **Implement gate (clean)** — badge `Implemented`, title `main.yml built and linted`, primary button `Continue to Test`.
3. **Assert** ④Test for `Deploy: none` is backend-only (no 4th gate / no turn) and the build then lands on the terminal `Done` card (badge `Done`, title `Test passed — workflow updated`).

> Backend basis: `boundaryAutoAdvances` returns `false` for `each_step` at every phase (orchestrator.ts:285) → no auto-advance → a click is required at each of the 3 confirm boundaries.

### Sub-test 4 — AUTO + STILL-FAILING → HARD-STOP (AC#25) · obs + CLI (primary: Impl‑CLI‑1)

> Forcing a lint failure from the UI is unreliable, so the **PRIMARY** verification is **Impl‑CLI‑1** in [00-README §5 Appendix](00-README.md#appendix-not-browser-testable) (drive a build whose requirement/seed deterministically yields a lint error; confirm Implement stops at the still-failing gate after ≤5 passes, no loop). In the browser, assert the hard-stop **ONLY IF** it naturally occurs.

1. **Conditional observe**: during sub-test 1's `auto` BUILD‑B (or any future `auto` build), if ③Implement's in-turn cap-5 validate→fix loop does **not** reach lint=0, the build MUST **hard-stop** at the still-failing gate and **NOT** auto-import / auto-advance.
2. **IF and only IF** this occurs, **assert** the gate card shows, verbatim (dict §4.3 still-failing row + §4.4):
    - badge `Lint still failing`
    - title `Still failing after the cap-5 attempts`
    - summary lines `The agent self-corrected as far as it could in one turn.` and `Your call: accept anyway, keep trying, or abandon.`
    - action buttons `Accept anyway` · `Keep trying` · `Abandon` (note: **no** auto-confirm fired — the build is parked awaiting a human decision).
3. **Assert** the build did **not** silently advance to ④/`Done` despite `Confirm: auto` (backend: `maybeAutoAdvance` returns early when `task.gate?.flag === 'still_failing'`, orchestrator.ts:272).
4. **If it does NOT occur** (the happy R-fresh-2 lints green), mark this sub-test **"obs — not triggered in browser; covered by Impl‑CLI‑1"** and pass it to the CLI check. Do **not** invent a failure.

---

## Expected

- **Sub-test 1 (AUTO)** — PASS iff the build ran ① → ② → ③ → ④ with **zero** human gate clicks and ended on a card with badge `Done` + title `Test passed — workflow updated`; total within ~900s; no `awaiting_confirm` gate ever required a click.
- **Sub-test 2 (SPEC ONLY)** — PASS iff exactly **one** pause occurred, at the gate with badge `Spec ready` / button `Implement this spec`; Analyze and Implement auto-advanced; build ended on `Done` / `Test passed — workflow updated`.
- **Sub-test 3 (EACH STEP)** — PASS iff `each step` + `Deploy: none` paused at exactly **three** gates (`Continue to Spec`, `Implement this spec`, `Continue to Test`) per T02/T03 evidence, then reached `Done`.
- **Sub-test 4 (AUTO hard-stop)** — PASS iff, when still-failing occurs under `auto`, the build **hard-stops** at the gate with badge `Lint still failing` / title `Still failing after the cap-5 attempts` / buttons `Accept anyway` · `Keep trying` · `Abandon` and did **not** auto-advance; OR, if not triggered, deferred to **Impl‑CLI‑1** with the "obs — not triggered" note.

---

## Negative / edge variants

- **2nd auto build during a running turn → 409 collision** (do NOT re-test here; owned by [T05-multibuild-turnlock.md](T05-multibuild-turnlock.md)): starting a second build while sub-test 1's `auto` turn is still running returns **409** with backend error `a turn is already running — try again in a moment` and the turn-collision banner button `Open it` (dict §4.8 / §4.7). Note its existence; the binding test lives in T05.
- **Double-clicking a gate** (sub-test 2 only — `auto`/`spec only` else have no clickable gate to fat-finger): a 2nd `Implement this spec` click against the same action → **409** `'${actionId}' is not a current confirm action` (dict §4.8, tasks.ts:168). The procedure forbids the second click; if it slips, this is the expected backend response, not a bug.
- **Confirm chip is read-only mid-build**: once a turn is running, the `Confirm` chip is disabled with tooltip `change confirm-mode once the build pauses at a gate` (dict §4.1). Changing confirm-mode mid-build is F2‑A and lives in [T09-confirm-mode-patch.md](T09-confirm-mode-patch.md) — do not test the PATCH path here.
- **String-omission guard**: every assertion above quotes a dictionary string. No invented strings are asserted. (No TODO omissions were needed for this file.)

---

## Pass / Fail

**PASS** — binary, all that apply to the sub-tests actually run:
- AUTO: ran 4 phases with **0** gate clicks and ended on `Done` / `Test passed — workflow updated` within ~900s.
- SPEC ONLY (if run): exactly one pause at the `Spec ready` gate; ended on `Done`.
- EACH STEP: three gates required clicks (per T02/T03), ended on `Done`.
- AUTO hard-stop: hard-stopped at `Lint still failing` when triggered, else deferred to Impl‑CLI‑1.

**FAIL** — any of:
- AUTO paused at any gate requiring a click (e.g. an `Analyze complete` / `Spec ready` / `Implemented` card blocked the run), or never reached `Done`, or a boundary exceeded 300s with no signal.
- SPEC ONLY paused at more than one gate, paused at Analyze/Implement, or did not pause at Spec.
- EACH STEP auto-advanced past any of the three gates.
- AUTO + still-failing **auto-advanced / auto-imported** instead of hard-stopping at `Lint still failing`.
- Any on-screen string differs by even one character from the dictionary value (including `…` `·`).

**Evidence (on FAIL):** capture a screenshot of the offending card/disclosure and quote the **exact text seen** vs the **expected** dictionary string (file:line from §4). For a timing FAIL, record the elapsed seconds and the last on-screen signal.

---

## Cleanup

- **Sub-test 1 (AUTO):** the build is hands-free and ends at `Done` — **no parked turn** to clean. Verify the `Stop` pill is gone and the build appears completed (not under `In progress`). Nothing to discard.
- **Sub-test 2 (SPEC ONLY):** if run to completion it also ends at `Done` — nothing parked. If you **stopped** at the `Spec ready` gate without finishing, **Discard** it: click `Discard build` on the gate card (POST /cancel, non-destructive). Confirm the build leaves `In progress`.
- **Sub-test 4:** if a still-failing gate was reached and observed, **Abandon** it via the gate's `Abandon` button so no parked turn is left holding context. (Cancel/Abandon is non-destructive — `projects/` + `.runs/` stay on disk, per [00-README §1.3](00-README.md#13-conventions-every-test-file-assumes).)
- **General:** before exiting, confirm **no** build remains in the sidebar `In progress` section and **no** `Stop` pill is visible. If any build is mid-flight, Discard/Stop it (`Stop build` confirm in the Stop dialog) — leave no parked turns.
- **Filesystem:** auto builds for R-fresh-2 (and R-fresh-3 if run) create `projects/<slug>/` + `.runs/` artifacts that are intentionally left on disk (Cancel/Done are non-destructive). No filesystem deletion is required by this test; note their creation for the operator.

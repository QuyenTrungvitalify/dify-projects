# T05 — Multi-build & turn-level lock (Lát 6)

| Field | Value |
|---|---|
| **ID** | T05 |
| **Title** | Multi-build & turn-level lock: two builds parked with NO "Busy"; turn-collision → 409 + "Open it"; parked never blocks |
| **Traces to** | AC#21 (turn-level lock: 2 parked builds OK, turn-collision → 409 + Open it) · AC#22 (active-build listing in the "In progress" section) · regression-of the old Lát-3 "409 Busy" toast (now superseded) |
| **Priority** | P0 |
| **Cost** | ~2 real build-turns (BUILD‑C + BUILD‑D each parked at Analyze; the THIRD build's Analyze adds one more if you run the park-doesn't-block step — see the note in Step 4) |

> Canonical run guide + String Dictionary: [00-README](00-README.md). Every quoted string below is asserted verbatim from §4 of that file.

---

## Preconditions
- App running and reachable at **http://127.0.0.1:4123** (host hardcoded to `127.0.0.1`; only the port is overridable). If the page does not load, **STOP and report** — do not proceed.
- A **clean app**: no build currently `running`. Open the sidebar; if the **`In progress`** section shows any row with the hint **`running`**, a turn is live — **STOP and report** (this test must start from a state where the turn-lock is free). Parked rows (hint **`gate`**) left from a prior aborted run should be cancelled via the sidebar hover-× **`Cancel this build`** before starting, so the "two parked" assertions are unambiguous.
- This test spends real model turns (Analyze ≈ up to ~5 min each). **Never double-click a gate** — a 2nd click can 409 the turn-lock.

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**.

### 1. Start BUILD‑C and park it at the Analyze gate
1.1 **Observe:** the empty/new-task surface. The composer placeholder reads `Describe the workflow or change…`. The crumb reads `New task`.
1.2 **Observe** the settings chips below the composer: `Confirm` must read `each step` (set it if not — click the `Confirm` chip and choose `each step`); `Deploy` must read `none`.
1.3 **Act:** type a short requirement into the composer, e.g. `A workflow that takes a topic string and returns a one-paragraph summary.` Click Send (or press Enter).
1.4 **Wait ≤300s:** poll the page until the **Analyze gate card** renders. The deterministic signals are: badge `Analyze complete`, title `Ready to write the spec`, summary `Requirement analyzed.` then `Continue to draft the spec, or request changes.`, and the gate buttons `Continue to Spec` · `Request changes` · `Discard build`. If no gate appears within 300s, **STOP and report** (do not click again).
1.5 **Assert:** the build is parked (`awaiting_confirm`). Open the sidebar — the **`In progress`** section header is present and BUILD‑C appears there with the status hint **`gate`** (not `running`).

### 2. Start BUILD‑D with a DIFFERENT requirement and park it too
2.1 **Observe** the sidebar; **Act:** click **`New task`** (the sidebar button, label `New task`). The empty surface returns (placeholder `Describe the workflow or change…`).
2.2 **Observe** the chips: `Confirm` = `each step`, `Deploy` = `none`.
2.3 **Act:** type a DIFFERENT short requirement, e.g. `A workflow that takes a city name and returns a short weather-style description string.` Click Send.
2.4 **Wait ≤300s:** poll until BUILD‑D's **Analyze gate card** renders (same deterministic signals as 1.4: badge `Analyze complete`, title `Ready to write the spec`, buttons `Continue to Spec` · `Request changes` · `Discard build`). If not within 300s, **STOP and report**.
2.5 **Assert:** BUILD‑D is parked (`awaiting_confirm`).

### 3. AC#21 + AC#22 — both parked, NO "Busy", both reopenable
3.1 **Observe** the whole page after BUILD‑D parks.
3.2 **Assert (no Busy):** there is **NO** "Busy" toast, banner, or message anywhere on screen. (The old Lát-3 `409 Busy` is superseded — a parked build does not hold the turn-lock.) Specifically, the start-error banner area is empty: the string `a turn is already running — try again in a moment` is **absent**, and no `Open it` button is shown.
3.3 **Observe** the sidebar **`In progress`** section.
3.4 **Assert (both listed, hint `gate`):** BOTH BUILD‑C and BUILD‑D appear as rows under **`In progress`**, and EACH row shows the status hint **`gate`**. (Per §4.6, `gate` = awaiting_confirm.)
3.5 **Act + assert (both reopenable):** click the BUILD‑C row → its conversation opens, the user requirement bubble (the BUILD‑C text) is shown, and its Analyze gate card re-renders (title `Ready to write the spec`, buttons `Continue to Spec` · `Request changes` · `Discard build`). Then click the BUILD‑D row → its conversation + Analyze gate render with the BUILD‑D requirement. Each row gets the `active` highlight when open.

### 4. Park-doesn't-block — start a THIRD build while two are parked
> Cost note: this step spends one ADDITIONAL Analyze turn. If you are minimizing cost, you MAY substitute a no-spend proof: from the empty surface, click Send on a short requirement and assert merely that the POST is **accepted** (a user bubble + a `Running` disclosure appear and NO start-error banner shows), then immediately Discard it in Cleanup. The binding assertion is "a parked build never blocks a new start", not "the 3rd build reaches a gate".
4.1 **Observe:** with BUILD‑C and BUILD‑D both parked (hint `gate`), click **`New task`** → empty surface.
4.2 **Act:** type a third short requirement, e.g. `A workflow that takes a product name and returns a one-line marketing tagline.` Click Send.
4.3 **Wait ≤10s:** poll until the conversation shows the user requirement bubble AND a `Running` disclosure (the run started). 
4.4 **Assert:** the start **succeeded** — there is NO start-error banner; specifically the string `a turn is already running — try again in a moment` is **absent** and no `Open it` button is shown. (A build parked at a gate never blocks a fresh start; only a build with a LIVE turn does — proven in Step 5.) Optionally wait ≤300s for BUILD‑3's own Analyze gate to confirm it parks too.

### 5. TURN COLLISION — a live turn 409s a second confirm, with "Open it"
> This is the core AC#21 assertion. Do it deliberately and quickly: a confirm starts a real turn (status → `running`), and while ANY turn is running a second action is rejected.
> ⚠️ **Timing (verified 2026‑06‑14):** trivial-workflow turns can finish in **~10–25 s**, so a short ①/② phase may end **before** your second click lands — no collision reproduces. To reliably hit it, fire the second build's confirm while the first is in a **longer phase (Implement ③)**, or click the second action **immediately** after the first. If the running turn finishes first, simply retry — the collision is real, the window is just short.
5.1 **Act:** open BUILD‑C (sidebar `In progress` → BUILD‑C row).
5.2 **Observe:** BUILD‑C's Analyze gate card with button `Continue to Spec`.
5.3 **Act:** click **`Continue to Spec`** ONCE. A turn starts.
5.4 **Wait ≤15s:** poll until BUILD‑C shows it is running — the gate card is replaced by a `Running` disclosure (and/or the conversation header shows the `Stop` pill, title `Stop the running build`). In the sidebar `In progress`, BUILD‑C's hint flips from `gate` to **`running`**. Do NOT click `Continue to Spec` again.
5.5 **Act (the collision):** while BUILD‑C's turn is still `running`, immediately open BUILD‑D (sidebar `In progress` → BUILD‑D row) and click its gate confirm button **`Continue to Spec`** ONCE.
5.6 **Wait ≤10s:** poll until a start-error banner appears for the BUILD‑D action.
5.7 **Assert (D rejected, 409 collision banner):** the error banner text contains the EXACT string `a turn is already running — try again in a moment`, and an **`Open it`** button is offered next to it.
5.8 **Assert (D did NOT advance):** BUILD‑D is still parked at its Analyze gate — its gate card (title `Ready to write the spec`, buttons `Continue to Spec` · `Request changes` · `Discard build`) is still shown; it did not enter a `Running` state.
5.9 **Act + assert (`Open it` jumps to C):** click **`Open it`**. The view jumps to the running build BUILD‑C (its conversation opens; in the sidebar BUILD‑C is highlighted `active` and still shows hint `running`). Opening a task clears the error banner, so after the jump the collision banner is gone.
5.10 **Assert (C unaffected):** BUILD‑C's turn continues normally — it is still `running` (or has since parked at its NEXT gate, the Spec gate: badge `Spec ready`, title `Spec drafted — review before I build`). The collision did not stop, error, or alter C.

### 6. After C parks again, D's confirm now succeeds
6.1 **Wait ≤300s:** poll BUILD‑C until its turn finishes and it parks at the **Spec gate**: badge `Spec ready`, title `Spec drafted — review before I build`, summary `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`, buttons `Implement this spec` · `Edit spec` · `Discard build`. In the sidebar, BUILD‑C's hint returns to **`gate`**. (The turn-lock is now free.)
6.2 **Act:** open BUILD‑D; click its gate confirm **`Continue to Spec`** ONCE.
6.3 **Wait ≤15s:** poll until BUILD‑D enters `running` (gate replaced by `Running` disclosure; sidebar hint → `running`).
6.4 **Assert (D now succeeds):** there is NO collision banner this time — the string `a turn is already running — try again in a moment` is **absent** and no `Open it` button is shown. BUILD‑D's turn proceeds. (Optionally wait ≤300s to confirm BUILD‑D parks at its own Spec gate, title `Spec drafted — review before I build`.)

---

## Expected
Binding assertions, exact strings:

- **Two parked builds, no Busy (AC#21):** with BUILD‑C and BUILD‑D both `awaiting_confirm`, NO "Busy" banner/toast exists; `a turn is already running — try again in a moment` is absent; no `Open it` button.
- **Active-build listing (AC#22):** both builds appear under the sidebar section header `In progress`, each with the status hint `gate`; clicking a row reopens its conversation + Analyze gate (title `Ready to write the spec`).
- **Parked never blocks:** starting a build while two are parked is accepted (no start-error banner).
- **Turn collision (AC#21):** while BUILD‑C's turn is `running`, confirming BUILD‑D's gate is REJECTED — banner contains `a turn is already running — try again in a moment` with an `Open it` button; clicking `Open it` jumps to the running BUILD‑C; BUILD‑C is unaffected (still `running`, or parked at its Spec gate `Spec drafted — review before I build`).
- **Retry succeeds after free:** once BUILD‑C parks (turn-lock free), BUILD‑D's `Continue to Spec` succeeds with no collision banner.

---

## Negative / edge variants
- **N1 — collision also blocks a brand-new start (Step 5 still live):** while BUILD‑C's turn is `running`, click `New task` → empty surface → type any requirement → Send. **Assert:** the start is rejected with the SAME collision banner — text contains `a turn is already running — try again in a moment` and an `Open it` button is offered. Click `Open it` → jumps to running BUILD‑C. (This proves the lock is turn-level, not per-build: a running turn blocks BOTH a second confirm and a fresh POST, while parked builds in Steps 1–4 blocked neither.) Run N1 BEFORE Step 5.9/6 so a turn is still live; do not leave the half-typed new build parked (it never POSTed, so nothing to clean).
- **N2 — no double-park:** do NOT double-click `Continue to Spec` on the same build (a 2nd click during the live turn 409s the same build; the optimistic UI already closed the gate). If a double-click slips through and shows the collision banner against the *same* build, that is the lock working — but it is out of scope here; just don't do it.
- **N3 — hint correctness:** at no point should a parked build show hint `running`, and at no point should a build with a live turn show hint `gate`. (Per §4.6: `gate` = awaiting_confirm, `running` = running/scaffolding.)

---

## Pass / Fail
**PASS** (all must hold):
1. Steps 1–2: BUILD‑C and BUILD‑D each park at an Analyze gate within 300s.
2. Step 3: both listed under `In progress` with hint `gate`; both reopenable; NO Busy banner.
3. Step 4: a third start while two are parked is accepted (no start-error banner).
4. Step 5: BUILD‑D's confirm during C's live turn is rejected with the exact banner `a turn is already running — try again in a moment` + `Open it`; `Open it` jumps to C; C unaffected; D did not advance.
5. Step 6: after C parks, D's confirm succeeds with no collision banner.
6. N1: a brand-new start during C's live turn is rejected with the same banner + `Open it`.

**FAIL** if any of: a "Busy" message appears while two builds are merely parked; a parked build blocks a new start; the collision banner text differs by even one character from `a turn is already running — try again in a moment`; the `Open it` button is missing or does not jump to the running build; the collision alters/stops the running build C; or D advances despite the 409.

**Evidence (on FAIL):** capture a screenshot of the offending state and **quote the exact text seen vs expected**, e.g. expected `a turn is already running — try again in a moment` vs seen `<verbatim on-screen text>`. For the listing, quote the sidebar row hint seen (`gate`/`running`) vs expected.

---

## Cleanup
Discard EVERY build this test started so no parked turn is left holding context:
- **BUILD‑C**, **BUILD‑D**, and the **THIRD build** (Step 4) — cancel each via the sidebar **`In progress`** hover-× (tooltip `Cancel this build`). For a row whose hint is `running` (a live turn), the confirm dialog appears — title `Stop this build?`, confirm button `Stop build` — accept it; for a `gate` row it dismisses immediately. Alternatively, open each build and use its gate's **`Discard build`** button.
- After cancelling, re-check the sidebar: the `In progress` section should be empty (or show `No projects yet` / none of this test's builds), confirming no parked turn remains.
- **Filesystem note:** Cancel is non-destructive — the per-task `projects/` scaffold + `apps/builder/.runs/<id>/` logs remain on disk by design. No filesystem deletion is required by this test; leave those artifacts in place unless a separate cleanup pass is mandated.

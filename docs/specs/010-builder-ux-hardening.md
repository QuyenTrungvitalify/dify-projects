# Spec 010 — Builder UX Hardening (post-009 QA)

> Status: **✅ implemented** (F1 + F4 + F2-Part-A; F3 dropped, F2-Part-B deferred) · Owner: builder ·
> Depends on: Spec 009 (Lát 0–6, merged) · Date: 2026-06-12
>
> Code landed (clean backend `tsc` + web `vite build`): F1 `gate.ts` Discard on every gate +
> `store.cancelById`/sidebar hover-×; F4 derived-slug auto-suffix in `scaffoldAtSpecGate` + `slugNote`;
> F2-A `PATCH /api/tasks/:id {confirm_mode}` + conversation-view chip patch (Workflow/Deploy read-only).
> **Still to record from a live run:** AC #15 (auto runs hands-free) + AC #25 (still-failing hard-stop).
>
> Source: the browser QA pass over the live app (`docs/specs/prompts/009/ui-test-plan.md`). Lát 6
> multi-build + every prior hardening passed live; QA surfaced **4 UX/coverage gaps**. This spec
> designs the *optimal* fix for each (not the minimal patch), with the rationale grounded in the QA
> evidence + the current code.

---

## 0. Context

The 009 app works end-to-end and the turn-level lock (Lát 6) is verified: parked builds never block,
multiple builds coexist, turn-collisions degrade gracefully. The gaps below are about **controlling a
build's lifecycle from the UI** and **a settings control that lies** — small surface area, real friction.

> **Verification pass (2026-06-12):** each finding was adversarially re-checked against HEAD `8f6b33d`
> (post-Lát-6). Result: **F1, F2, F4 confirmed real**; **F3 DROPPED** (its premise was false — 009 does
> NOT contain a flat "Spec/Yaml/Diff/Report" string; it already describes tabs phase-driven + labels the
> YAML artifact `main.yml`, so there is no drift to fix). F2 and F4 designs were corrected (see each).

| Fix | Severity | Type | Code-touch |
|---|---|---|---|
| **F1** Cancel any in-flight build (gate + sidebar) | **High** | missing affordance | frontend + `gate.ts` |
| **F2** Confirm-mode is live-patchable, not a mid-build no-op | **Med** | misleading control + unverified AC | backend route + frontend |
| ~~**F3** Artifact tabs~~ | — | **dropped — not a real drift** | none |
| **F4** Slug-collision guard for new-workflow builds | Med | silent overwrite (data loss) | `orchestrator.ts` (+ optional gate UI) |

Non-goals: concurrent *turns* (still 1-at-a-time, Lát 6); a Lát-6 concurrency code-review (separate);
deploy/workflow mid-build changes (F2 covers confirm-mode only).

---

## F1 — Cancel any in-flight build (gate card **and** sidebar)

### Problem (QA evidence — verified)
QA could not dismiss **parked** builds and left **3 stranded** (summarizer@Spec, classifier@Analyze,
summarizer@Implement). Verified in code (HEAD): `gate.ts:54-102` — analyze (`:54-60`), spec (`:61-68`),
implement-clean (`:81-86`), and test/awaiting_import (`:96-102`) emit only `CONFIRM`+`REPLY`; **only** the
still-failing Implement branch (`:69-79`) has `CANCEL('abandon')`. `GateCard` (`Chat.tsx:238-240`) renders
a cancel button **only** from a `kind:'cancel'` gate action — so a build parked at a normal gate shows
**no cancel button at all**. (Note: there is **no "Stop Claude" / stop-turn button** in the UI either — the
*only* in-UI cancel today is the still-failing `Abandon`. The earlier "Stop Claude" framing was wrong; the
gap is wider than first stated.) The backend `POST /cancel` (`tasks.ts:217-250`) already accepts any
non-terminal task incl. **parked** (`liveSession` null → just flips `cancelled`), so the verb works — it is
simply unreachable from the UI.

### Why it matters
Lát 6 *encourages* accumulating parked builds (that's the feature). Without a dismiss, the in-progress
list grows monotonically and the only escape is a CLI `curl .../cancel` or deleting `.runs/` — unacceptable
for a local app. This is the single most user-facing gap QA found.

### Design (optimal — two reach points, one backend verb)
Both call the **existing** `POST /api/tasks/:id/cancel` (no backend change to the verb):

1. **Gate card** — add a low-emphasis `CANCEL('discard', 'Discard build')` action to **every** gate in
   `computeGate` (analyze, spec, implement-clean, test-import). The still-failing gate keeps its existing
   `Abandon` (same `kind:'cancel'`, just a sharper label). Rendered as a quiet text button, set apart from
   the primary Continue (so it can't be fat-fingered).
2. **Sidebar** — each **in-progress** build row (the Lát-6 `active` list, `Sidebar.tsx:98-119`) gets a
   hover **×** → cancel, so you can dismiss a parked build *without opening it*. Confirm-on-click only if
   the build is `running` (a live turn); a parked build cancels immediately. **Nuance (verified):** the
   existing `store.cancel()` (`store.ts:288`) only cancels `store.task.value` (the *open* task) — the
   sidebar-× must use a **taskId-parameterized** cancel (`store.cancelById(id)` → `api.cancel(id)`), since
   it dismisses a build that isn't the open one. The `/cancel` route already takes `:id`, so no backend change.

Semantics: cancel marks the build `cancelled` (terminal). **Non-destructive** — `.runs/<id>/` and any
scaffolded `projects/<slug>/` stay on disk (partial work is recoverable). The build leaves the in-progress
list. Under the turn-level lock, a parked build holds no lock, so cancel just sets the status; a running
build's turn is killed (`liveSession().forceKill()`, unchanged).

### Acceptance
- [ ] A build parked at Analyze/Spec/Implement-clean shows a **Discard build** action that cancels it.
- [ ] Every in-progress build in the sidebar has a **×** that cancels it without opening it.
- [ ] Cancelling a parked build sets `cancelled`, drops it from the in-progress list, leaves `.runs/`+`projects/` intact, and **frees nothing it didn't hold** (no lock side-effect).
- [ ] Cancelling a *running* build kills the live turn and releases the turn-lock (regression of Lát-6 E1).
- [ ] After cancel, a new build starts normally.

---

## F2 — Confirm-mode is **live-patchable**, not a mid-build no-op

### Problem (QA evidence)
QA switched **Confirm → auto mid-build**; the build **still stopped at every gate**. Cause (code):
`confirm_mode` is bound at `createTask` from the POST body; the chip's `onChange` only mutates
`store.settings` (the *next* build's payload) — there is **no path to update a running task**. So the chip
is **editable yet inert** mid-build → it lies. Separately, **AC #15 (auto runs hands-free)** and **AC #25
(still-failing Implement hard-stops under auto)** were therefore **never exercised from the start** → still
**unverified**.

### Why it matters
A lying control is worse than a disabled one. The *optimal* behavior is genuinely useful: "I've confirmed
two gates, I trust it — switch to auto for the rest." Verified cheap for the data path: `maybeAutoAdvance`
reads `task.confirmMode` fresh each boundary (`orchestrator.ts:273`), so a persisted mode change is honored
at the **next boundary** with no extra plumbing.

### Design — make it patchable, in **two clearly-separated parts** (verified scoping)
**Part A (the fix — cheap, do this):** add `PATCH /api/tasks/:id` accepting `{ confirm_mode }` (normalized
via the existing `normalizeConfirmMode`). Allowed **only on non-terminal** tasks (else 409). It persists
`task.confirmMode` + broadcasts `task:update`. **Pure data write — no turn-lock needed.** Effect: the
**next** boundary (the next time you click Continue, or the next auto-advance) honors the new mode. So:
switch a parked build to `auto`, click **Continue once**, and it runs the rest hands-free. This alone kills
the lie and is the recommended scope.
- **Frontend:** in **conversation** view the confirm chip → `store.patchConfirmMode(taskId, mode)` (PATCH)
  **and** updates `store.settings` for future builds; in **empty** view it only sets `store.settings`. The
  **Workflow** and **Deploy** chips are **read-only** in conversation view (start-bound; editable would be
  the same lie — out of scope to make them patchable).

**Part B (optional polish — NOT cheap, defer/skip):** make switching a *parked* build to `auto`
**advance immediately** (without the one extra Continue click). Verified this is **more than a data write**:
a parked build has no running turn and nothing polling, so the PATCH handler would have to **replicate the
`/confirm` route** — `acquireTurn(id)` (409 if a turn is running) then dispatch `maybeAutoAdvance`/
`confirmAdvance` (which spawns a real turn, so it is lock-bearing) and release in the dispatch `finally`.
It also needs `maybeAutoAdvance` **exported** (today it's private, `orchestrator.ts:269`). Given the cost vs
the marginal "save one click", **Part A is the optimal fix; Part B is optional** — the original spec's
"immediately runs `maybeAutoAdvance`… cheap" framing was wrong and is corrected here.

- *Rejected alternative:* disable the confirm chip mid-build. Removes the lie but throws away a genuinely
  useful capability that Part A delivers almost for free.

### Verification (the unverified ACs — must run, not just code)
- [ ] **AC #15:** a build started with **Confirm: auto** runs ①→②→③→④ **without pausing** → `done`.
- [ ] **AC #25:** under `auto`, an Implement that is still-failing after cap-5 **hard-stops** at the
  still-failing gate (does NOT auto-advance / import). *(Needs a way to force lint≠0 — e.g. a deliberately
  malformed seed/requirement, or a test fixture; if not reproducible via UI, mark CLI-verified.)*

### Acceptance
- [ ] **(Part A)** `PATCH /api/tasks/:id {confirm_mode}` on a non-terminal build updates `confirmMode` (200 + `task:update`); on a terminal build → 409.
- [ ] **(Part A)** After switching a parked build to `auto`, the **next** Continue makes it run the remaining gates hands-free (mode honored at the next boundary).
- [ ] **(Part A)** The confirm chip in conversation view reflects + patches the **active** build; Workflow/Deploy chips are read-only there.
- [ ] **(Part B — optional)** Switching a parked build to `auto` advances it **immediately** (no extra click), via `acquireTurn`+dispatch (skip if not doing Part B).
- [ ] AC #15 and #25 verified (UI or CLI) and recorded.

---

## F3 — Artifact tabs ~~doc drift~~ — **DROPPED (premise false)**

The QA agent read the tabs as appearing "stage-dependent" and flagged a mismatch with a supposed flat
"Spec/Yaml/Diff/Report" wording in Spec 009. **Verification refuted this:**
- **Code is correct & progressive** — `availableTabs()` (`App.tsx:20-30`) is contents-driven (spec once ②,
  `main.yml` once ③, `diff` when a base exists, `report` once done); `ArtifactPanel.tsx:193-199` labels the
  YAML tab **`main.yml`** and renders only available tabs. No tab that should appear is unreachable. No bug.
- **Spec 009 has no drift** — grep of `009-browser-workflow-builder.md` for "Spec/Yaml/Diff/Report" returns
  **zero hits**. The actual description (`009:601-604`) is already prose + phase-driven and already says
  `main.yml` (not "Yaml"). There is nothing to align.

**Action: none.** (At most an optional one-line clarity tweak to 009:601-604 to say tabs "appear as their
artifact lands" — but this is a nicety, not a correction. Do not add a claim that 009 currently says "Yaml"
or a flat four-tab string, because it does not.)

---

## F4 — Slug-collision guard for new-workflow builds

### Problem (QA evidence)
QA ran the **same** "summarizer" requirement several times. Each derived the **same** slug
(`workflow_start_node_one`). A *new-workflow* build whose derived slug **collides** with an existing
`projects/<slug>/` scaffolds idempotently (skips init) and Implement **overwrites that project's
`main.yml`** → the Diff showed real changes (not the expected pure additions) because the base was the
*existing* file. I.e. repeated same-requirement builds **silently clobber each other**.

### Why it matters
A "new workflow" build silently **overwriting an unrelated existing project** is a data-loss footgun.
**Verified the mitigation is weaker than first stated:** the backend `ConfirmPayload{slug,name}` plumbing
exists (`tasks.ts:171-173` → `scaffoldAtSpecGate:635-640`), but the **UI exposes NO slug-edit input** at
the Spec gate (`Chat.tsx:242` sends `onConfirm(a)` with no extra; there is no slug `<input>` in the gate
card). So **today the user cannot rename via the UI in ANY mode** — only via raw API — and `auto` skips the
gate entirely. The auto-suffix below is therefore the *primary* protection, not a fallback.

### Design (optimal — auto-suffix the DERIVED slug + surface it; optionally add a slug field)
At slug derivation for a **new-workflow** build (no `workflow`, no `seedAppId`), in `scaffoldAtSpecGate`
(`orchestrator.ts:641-645`, the **derive** branch — NOT the user-override branch `:635-637`):
- If the derived slug **does not** exist → use it (today's behavior).
- If it **collides** with an existing `projects/<slug>/` → **use the first-free suffixed slug** (`<slug>_2`,
  `_3`, …) **and** set a gate note: *"'<slug>' already exists — using '<slug>_2' to avoid overwriting it."*
  This applies in **all** modes (each_step/spec_only/auto) — the suffix is what actually prevents the
  overwrite, since the UI has no rename field today.
- **Verified nuance:** run the suffix **only on the derived path**. A user who *explicitly types* an existing
  slug (override branch) is plausibly targeting it — leave that alone.
- Under `auto`: record the rename in the report (the user never saw a gate).

**Optional companion (recommended if doing F4):** add a small **slug `<input>`** to the Spec gate card so
a user in each_step/spec_only *can* deliberately retarget the existing workflow. Without it, the "edit the
slug back" path is API-only. (The backend already accepts `{slug}` on `/confirm` — this is purely a gate-UI
field + threading it into `onConfirm`'s `extra`.)

*Edit-existing builds (`workflow` set) and Dify-seed builds are unaffected* — overwriting the targeted file
is their intent.

### Acceptance
- [ ] A new-workflow build whose **derived** slug exists → uses `<slug>_2` (first free) + a gate/report note; the existing project's `main.yml` is **not** touched.
- [ ] The suffix applies to the **derived** slug only; an explicit user-supplied slug is used as-is (override branch unchanged).
- [ ] Under `auto`, a colliding new-workflow build takes the suffixed slug (no silent overwrite) and records it in the report.
- [ ] Edit-existing / Dify-seed builds still write their targeted file (unchanged).
- [ ] *(If the optional companion is done)* the Spec gate exposes a slug input that round-trips through `/confirm {slug}`.

---

## Rollout & order

Three real fixes (F3 dropped); suggested order by value/risk: **F1 → F4 → F2**.
- **F1** (cancel) — highest value, smallest risk; also unblocks cleanup of stranded builds. Two-part
  (gate `CANCEL` action + sidebar `cancelById`); backend `/cancel` already supports it.
- **F4** (slug guard) — prevents data loss; localized to the derive branch of `scaffoldAtSpecGate`. The
  auto-suffix is the real protection (no UI rename today); the slug-input gate field is an optional companion.
- **F2** (patchable confirm-mode) — Part A (cheap data PATCH) is the fix; Part B (immediate parked-auto-advance)
  is optional. Verify AC #15/#25 here.

Effort: **~½ day** for F1 + F4 + F2-Part-A (F3 gone, Part B optional). Backend `tsc` + web `vite build`
must stay clean; existing Lát 3–6 acceptance must still pass (especially the turn-lock invariants).

## Spec-update / ledger (no silent drift)
- Update **Spec 009**: §D (confirm-mode now live-patchable mid-build, F2), §G/§J (slug-collision auto-suffix,
  F4), and AC #18 (derived slug suffixes on collision; note no UI rename today unless the optional gate field
  is added). Add **AC #15/#25 verification** outcomes once run. *(No §C/§H artifact-tab edit — F3 dropped, the
  current wording is already correct.)*
- Add a row to `docs/specs/009-implementation-plan.md` ledger referencing this spec (010) as the post-QA
  hardening pass.
- This spec can be turned into a single `docs/specs/prompts/009/lat7-ux-hardening.md` implementation prompt.

## Guardrails
- Turn-level lock invariant (1 turn at a time) is untouched; F2's parked-auto-advance must go through the
  Lát-6 `acquireTurn`/`maybeAutoAdvance` path (no second turn).
- `/cancel` stays non-destructive (no deleting `projects/`); bind 127.0.0.1; commit locally only after
  acceptance; do not push. Commit message ends with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

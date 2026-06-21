# Gap Report — coverage, CLI-only, and spec gaps

Closes the QA suite. Three sections: (A) what the **browser** suite covers, (B) what is **CLI/manual-only** (and why), (C) behavior the **code exposes that has no acceptance criterion** — spec gaps worth flagging.

---

## A. Browser-covered acceptance criteria

| AC / Fix | Covered by | Notes |
|---|---|---|
| AC#2 (Analyze stops; seed-picker empty-state) | T02, T01 | real seed *listing* needs creds → B |
| AC#3 (Spec writes/stops; editable; feeds Implement) | T02, T07 | "feeds Implement" *propagation* is asserted only as far as the `Saved · feeds Implement` status — deep consumption is a gap (see C5) |
| AC#4 (Implement → main.yml, 3 lints, diff) | T02, T07 | lint rows `validate_workflow`/`lint_refs`/`lint_plugin_hashes` = `ok` |
| AC#5 (Report none → path, no app_url) | T07 | selfhost app_url → T12 (creds) |
| AC#6 (each step pauses) | T02, T04 | see C1 — only 3 gates for Deploy:none |
| AC#7 (reply re-runs same phase) | T03 | `Request changes` / `Edit spec` |
| AC#9 (cloud: skip import + YAML + Studio steps) | T12 | **browser-testable without creds** |
| AC#13 (sidebar tree; hover → New task; static crumb) | T01 | |
| AC#14 (settings below input; no model/pattern picker; defaults) | T01, T10 | |
| AC#15 (confirm modes) | T04 | auto + spec-only + each-step |
| AC#16 (inline gate buttons; import button when Deploy≠none) | T02, T03, T12 | auto-mode exception in T12 |
| AC#18 (slug/name proposed; scaffold on confirm) | T02 | slug *collision* path → T10/F4 |
| AC#21 (turn-lock: 2 parked OK; collision 409 + Open it) | T05 | the headline Lát-6 behavior |
| AC#22 (SSE reconnect restores phase/gate) | T06 | + `GET /api/active` listing |
| ~~AC#23 (cross-origin 403; 127.0.0.1-only)~~ → **moved to §B** | T11 is **terminal/curl**, not browser (a browser can't forge `Origin`) | see §B |
| AC#24 (cancel frees lock → new build) | T08 | boot-clear → B |
| AC#25 (clean vs still-failing gate actions distinct) | T03 | auto hard-stop + push idempotency → B/obs |
| F1 (Discard on every gate + sidebar ×) | T08, T03 | |
| F2‑A (live-patch confirm-mode; read-only chips; reject on done) | T09 | |
| F4 (slug auto-suffix + gate note; original untouched) | T10 | |

Plus two **regression** guards with no AC of their own but real fixed-bug history: **optimistic-dup disclosure** (T02) and **dead-end composer** (T10).

---

## B. CLI / manual-only (not browser-testable) — with the reason

Each maps to a named check in [00-README §5](00-README.md#appendix-not-browser-testable).

| AC | Why a browser can't see it | Check |
|---|---|---|
| AC#1 `/health` non-OK when `.venv/`/`skills/` missing | requires removing server-side dirs + restart | App‑CLI‑1 |
| AC#2 real seed list | needs `DIFY_CONSOLE_URL/TOKEN`; `sync.py list` is backend-only | App‑CLI‑2 |
| AC#8 self-correct ≥1 seeded error / AC#20 cap-5 | forcing a deterministic lint failure isn't reliable from the UI (010 F2‑5 concedes this) | Impl‑CLI‑1 |
| AC#10 no permission-prompt hang | the `--permission-mode acceptEdits --setting-sources local` spawn is server-side | Sec‑CLI‑1 |
| AC#11 no nexus runtime dep | a dependency/grep fact, not a UI state | Repo‑CLI‑1 |
| AC#12 README coverage | doc inspection | Doc‑CLI‑1 |
| AC#17 standalone repo gates | Python gates (`check_dsl_version.sh`, `regen_vscode_settings.py`, CI) run in the shell | Repo‑CLI‑2 |
| AC#19 restart re-runnability | killing + restarting the backend is out of the browser's reach | Recover‑CLI‑1 |
| AC#23 cross-origin 403 + 127.0.0.1 binding | a browser silently downgrades a forged `Origin` to same-origin, so the cross-origin 403 + LAN-binding checks can only run from a real shell (`curl`/`ipconfig`) | T11 (terminal) |
| AC#23 confinement-revert (incl. opaque Bash write) | `git checkout`/`git clean` runs server-side inside the `/confirm` cycle; the browser sees only the resulting `status:error` | Sec‑CLI‑2 |
| AC#23 token-never-in-turn | env-strip + `.runs/` JSON + SSE redaction are server-side; needs a sentinel grep | Sec‑CLI‑3 |
| AC#24 boot clears lock; `running`→`error` | server lifecycle | Recover‑CLI‑1 |
| AC#25 push idempotency (`push_intent` guard) | needs creds + a simulated mid-push crash + `sync.py list` | Deploy‑CLI‑1 |

**obs (browser asserts only if it occurs):** AC#8 self-correction, AC#19 error gate, AC#20/#25 still-failing gate. The suite asserts the exact UI **if** the condition arises; the *forcing* is a CLI check above. This split is deliberate and is called out in every affected test file.

---

## C. Spec gaps — behavior the code exposes with NO acceptance criterion

These are not bugs per se, but UI/contract surfaces that ship without a governing AC. Flagged for the spec owner.

1. **AC#6 wording vs. reality — "pause at each of the 4 phases."** For `Deploy: none`/`cloud`, Phase ④ (Test&Report) is backend-only and its success gate is **terminal with no actions** (`gate.ts` test success), so there are only **3 confirmable gates**. The literal "4 pauses" holds **only for `Deploy: selfhost`**, where Phase ④ parks at the Import gate. The AC text should be qualified, or the suite's "3 gates for none / 4th=Import for selfhost" reading should be folded into the spec. *(Severity: spec-clarity.)*

2. **Diff-tab placeholder references unshipped work.** `ArtifactPanel.tsx:114` still shows `No diff yet — the seed/pattern diff producer lands in Lát 5.` AC#4 requires the Diff/additions view for a new workflow. If a *completed* Implement still shows this placeholder, that's a latent defect; either way the "lands in Lát 5" copy is stale post-Lát-5. T07 step 5 turns this into a finding. *(Severity: potential defect / stale copy.)*

3. **Top-level "Stop" pill + "Stop this build?" modal** (`App.tsx`) is a *third* cancel path alongside F1's gate-Discard and sidebar-×, but no AC or F-item governs it (F1 only specifies the gate Discard and the sidebar ×). T08 covers it; the spec should acknowledge it. *(Severity: missing AC.)*

4. **"Skip import" gate action** (`gate.ts`, selfhost `awaiting_import`) lets the user complete a selfhost build *without* importing — a real branch with no AC (AC#5/#16 only describe the import button). T12 covers it. *(Severity: missing AC.)*

5. **"Saved · feeds Implement" ≠ proven propagation.** AC#3 asserts "a user edit to `SPEC.md` is reflected in Implement," but the only observable UI signal is the save status; there is no UI proof that the *next Implement turn actually consumes the edited SPEC.md*. The suite asserts the save status (T07) and flags the propagation as unverified-by-UI. A deterministic check (edit SPEC to include a sentinel, re-run Implement, grep the produced `main.yml`/turn log) belongs in the suite or a CLI check. *(Severity: weak verifiability of an AC.)*

6. **`GET /api/seeds` graceful-degradation contract** (always HTTP 200 with `{reason, note}` even when `sync.py list` exits 1) and its three exact notes (`connect Dify …`, `Dify unreachable …`, `could not list Dify apps`) are robustness behavior with no AC. Good behavior — but undocumented. *(Severity: missing AC.)*

7. **`PUT /api/tasks/:id/spec` blank-guard + task-id path-traverse validation** (`SPEC.md cannot be empty`, `invalid task id`) are security/robustness behaviors (spec §J alludes to the path guard) without their own ACs. T10 covers blank-save; T11 references the origin guard. *(Severity: missing AC for the blank-guard.)*

8. **F4 suffix value is data-dependent.** 010's plan documents `…_2`; because the repo now also contains `projects/workflow_start_node_one_2/`, the live "first-free" suffix is `…_3`. Not a spec gap so much as a **test-data caveat** — any test that hard-codes `_2` will mis-assert. T10 computes "first free" and expects `_3`. *(Severity: test-data note.)*

9. **Confirm-chip lock semantics** — read-only *while a turn runs* vs editable *at a gate*, plus the Workflow/Deploy "start-bound" read-only tooltips — are an F2‑A side-contract with exact tooltip strings but no AC enumerating them. T09 covers it. *(Severity: missing AC.)*

11. **Reject-on-done (`409 task is done — confirm_mode is no longer changeable`) is unreachable from the UI** *(verified 2026‑06‑14, T09 Step 4).* On a `done`/`cancelled` build the conversation composer is the **start-a-new-build** variant, and its `Workflow/Confirm/Deploy` chips set the **next** build's defaults — they are **not** bound to the terminal task's `confirmMode`. So no UI control ever issues `PATCH /api/tasks/:id {confirm_mode}` against a terminal task; the backend's terminal-reject guard (tasks.ts:213–224) is correct defense-in-depth but is **API/CLI-only**, not browser-observable. Reclassified accordingly (T09 Step 4 → curl). *(Severity: weak verifiability of the F2‑A reject clause; the guard itself is fine.)*

10. **`patchConfirmMode` also writes `store.settings`** so the *next* build inherits the changed mode — a reasonable UX side-effect of F2‑A that the spec doesn't mention. *(Severity: minor / informational.)*

12. **Sidebar status-hint lag** *(verified 2026‑06‑14, T05).* The `In progress` row hint for a build that is **not currently open** can show `running` while the authoritative state (the build's gate card + `GET /api/tasks/:id` / `/api/active`) is already `awaiting_confirm` (parked). The hint refreshes lazily and isn't always synced to the live SSE/active state. Cosmetic only — the gate card and API are correct — but it can briefly mislead a viewer about which build is actually running. *(Severity: minor UI staleness; no AC governs sidebar hint freshness.)*

13. **Trivial-workflow turns complete in seconds, not minutes** *(verified 2026‑06‑14, T05).* The suite assumes per-turn budgets of ~5 min (300 s), true for substantive builds; but a one-LLM-node workflow's ①/② turns can finish in **~10–25 s**. Consequence: the **turn-collision test (T05 step 4) is hard to reproduce on a short phase** — the running turn ends before a second click lands. Reproduce the collision while the other build is in a **longer phase (Implement ③)**, or start the second action immediately. *(Operational note, not a defect.)*

14. **Local "edit-existing" via the Workflow chip is a UI affordance with NO backing behavior — it silently builds from-scratch** *(verified 2026‑06‑18, T15).* Selecting an existing **local** workflow slug in the composer **Workflow** chip sets `task.workflow` but **never resolves it into a seed**: `task.seedPath` is only ever set by the **Dify-seed prelude** (`orchestrator.ts:149`, gated by `if (task.seedAppId)` at `:77`); `createTask` hard-sets `seedPath: null` for the local path (`state/task.ts:170`). So Analyze receives an **empty SEED_PATH**, writes `"seed": null`, and runs **greenfield** despite Workflow ≠ none — it never summarizes the chosen workflow, produces no edit-diff, and on a confirmed Implement would mint a **new graph keyed to a requirement-derived slug** rather than editing the selected one. This is a **known, code-documented pre-existing 009 limitation** (`orchestrator.ts:654–655`: *"edit-existing does not yet resolve its slug FROM `task.workflow` … that targeting gap is a pre-existing 009 limitation, tracked separately, NOT F4."*). **The only seed/edit path that actually works today is the Dify-app seed** (SEED FROM picker, creds-gated → App‑CLI‑2). Until the targeting gap is wired, the Workflow chip's existing-slug options are a **footgun**: the user believes they're editing a workflow but gets a from-scratch build.

   **✅ FIXED (2026‑06‑18).** Added a Phase-① local-edit prelude `localEditSeed` (`orchestrator.ts`, mirroring `difySeedScaffoldAndPull` minus the network pull): when `task.workflow` is set and there's no Dify seed, it (a) points `task.slug` at the chosen workflow (so the Spec-gate scaffold skips derive/init and Implement edits the **right** project in place) and (b) snapshots the current `projects/<slug>/workflows/<workflowFile>` into an immutable `.runs/<taskId>/seed.yml`, set as `task.seedPath`. That snapshot now feeds **both** the Analyze SEED_PATH (→ Analyze summarizes the existing graph, `seed` ≠ null) and the diff base (→ a real non-empty-base edit diff; Implement overwrites the live file, not the snapshot). The data-loss tail is also closed: with `task.slug` resolved up-front, the genuine-new block in `scaffoldAtSpecGate` is skipped, and that block's slug-collision guard was simplified to **always** `firstFreeSlug` (`orchestrator.ts:656`), so no edit-existing build can bypass the suffix. Covered by `test/edit-existing.test.ts` (slug-targeting, immutable snapshot, idempotent re-run, no-workflow-file fallback). T15 re-enabled (Part B now runnable). *(Severity: functional gap / UX footgun — RESOLVED.)*

14. **Blank-SPEC-save rejection reason isn't surfaced to the user** *(verified 2026‑06‑15, T10 B).* `PUT /api/tasks/:id/spec` correctly rejects an empty save with `400 {"error":"SPEC.md cannot be empty"}` and the on-disk file is preserved — but the UI only reverts the indicator to `Unsaved changes`; it does **not** show the error reason (no toast/inline message). A user who blanks the spec and saves sees "Unsaved changes" with no explanation of why the save didn't take. *(Severity: minor UX — the guard and data-safety are correct; only the feedback is silent.)*

---

## D. Bottom line

- **Every AC #1–#25 and F1/F2‑A/F4 is accounted for** — each is either browser-covered (§A) or assigned a named CLI/manual check (§B). No AC is silently dropped.
- The **highest-risk, previously-unverified** behaviors — `auto` end-to-end (AC#15), `auto` + still-failing hard-stop (AC#25), the turn-level lock (AC#21), confinement-revert and token isolation (AC#23) — are promoted to P0 and, where the browser can't reach them, given explicit CLI procedures.
- **10 spec gaps** (§C) are surfaced for the spec owner; none block the suite, but #2 (stale Diff placeholder) and #5 (unproven SPEC→Implement propagation) deserve a follow-up decision.

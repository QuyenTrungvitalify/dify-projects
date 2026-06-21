# T09 — Confirm-mode live patch (F2‑A)

> Canonical run guide + String Dictionary: [00-README](00-README.md). Every quoted string below is asserted **verbatim** from that dictionary (or the cited source file:line). "Looks right" is a FAIL.

| Field | Value |
|---|---|
| **ID** | T09 |
| **Title** | Confirm-mode live patch (F2‑A): patch takes effect mid-build; Workflow/Deploy read-only; reject on done |
| **Traces to** | **F2‑A** (`PATCH /api/tasks/:id` confirm_mode) · **AC#15** (confirm modes) · regression-of *patch-vs-cancel resurrect* (tasks.ts:221–225) |
| **Priority** | P0 |
| **Cost** | **0–1** real build-turns — reuse a **parked** BUILD‑A at a gate (0 turns to patch + assert read-only/reject). Step 2 (prove the patch is honored hands-free) spends the **remaining** turns of that already-started build: **+1** only if BUILD‑A must run from a single parked gate through to `Done`. No fresh build is started by this file. |

---

## Preconditions

- App running and reachable at **http://127.0.0.1:4123** (browser agent already on the loaded SPA — no login wall).
- **A build PARKED at a gate (NOT running)** is required. Reuse **BUILD‑A** (settings `Workflow: none`, `Confirm: each step`, `Deploy: none`, requirement `R-fresh`) sitting at any gate — e.g. left parked at the **Analyze** gate by T02, or at the Implement gate after T07/T03.
- To recognise "parked at a gate": the conversation shows a **gate card** with a badge from the dictionary — e.g. `Analyze complete` / `Spec ready` / `Implemented` — and inline gate buttons; the running disclosure does **not** show `Running`/`Working…`.
- **STOP+report** if no parked build exists and you are not permitted to start one. If permitted, start one and leave it at the **Analyze** gate first (see T02), then run T09. Do **not** double-click any gate (a 2nd click can 409 the turn-lock).

If any precondition is unmet, **STOP and report** which one — do not improvise a different build.

---

## Steps

Each step is **observe → act → wait(≤timeout) → assert**. Quote the exact text seen on any mismatch.

### Step 1 — EDITABLE AT GATE: the Confirm chip is live-patchable while parked
1. **Observe** — open BUILD‑A's conversation view. Below the input is the composer settings row with three chips. Locate the **Confirm** chip. It renders `Confirm:` followed by its current value `each step` (label from `confirmModeLabel`, store.ts:350–354; chip render Chat.tsx:288–289). Because the build is **parked at a gate** (not running), the Confirm chip is **enabled** (it has the twist/caret affordance; not dimmed). Source for enable rule: `lockConfirm={busy}` is `false` when no turn runs (App.tsx:211).
2. **Act** — click the **Confirm** chip to open its dropdown, then click the option **`auto`** (options are exactly `each step` / `spec only` / `auto`, Chat.tsx:348). This fires `patchConfirmMode` → `PATCH /api/tasks/:id` with `{ confirm_mode: "auto" }` (store.ts:360–364; api.ts:69–70).
3. **Wait** — poll ≤ **15 s** for the chip value to settle on `auto` (optimistic update is immediate; SSE `task:update` confirms).
4. **Assert** —
   - The Confirm chip now reads value **`auto`** (i.e. `Confirm:` + `auto`).
   - **No error banner** appears (no `StartErrorBanner` red row; App.tsx:261–266). The PATCH returned 200 with the updated task.
   - **Negative:** there is **no** banner text `this build has a turn running — change confirm-mode once it pauses at a gate` (that 409 only fires mid-turn, tasks.ts:218) — its absence proves the gate-parked patch was accepted.

### Step 2 — EFFECT (F2‑A is NOT a no-op): the new mode is honored at the next boundary
> Cost note: this is the **+1 turn** step (it advances BUILD‑A). Skip only if a reviewer caps this file at 0 turns — but then F2‑A's *effect* is unproven; record that as a partial.
1. **Observe** — confirm the gate card and its **advance** button are present. The advance label depends on the parked phase (dictionary §4.4): at Analyze → `Continue to Spec`; at Spec → `Implement this spec`; at Implement(clean) → `Continue to Test`. Read which gate BUILD‑A is at and note the exact advance label.
2. **Act** — click that advance button **exactly ONCE**. (Never click twice — a 2nd click can 409 the turn-lock, tasks.ts:43 `a turn is already running — try again in a moment`.)
3. **Wait** — poll the page for up to **900 s** total. With `Confirm: auto` now in effect, the build must run **hands-free** through every remaining boundary: no further gate card should require a click. Watch for the run disclosure cycling `Running` / `Working…` (Chat.tsx:85,104) between phases, and finally a terminal gate. Per-turn budget is ~300 s (00-README §1.3); 900 s covers the worst-case remaining 3 turns. If **no** progress signal appears within 300 s of any single turn, **STOP and report** (do not click again).
4. **Assert** —
   - **No intermediate gate stopped for a click** after the single advance in 2 — the remaining phases ran hands-free (this is the binding F2‑A "effect" assertion: the patched `auto` mode was honored at the **next** boundary, not silently reverted).
   - End state is the **Done** gate card: badge **`Done`**, title **`Test passed — workflow updated`**, summary `Linters re-run on the produced main.yml.` / `Open the report in the panel for the details.` (dictionary §4.3; Chat.tsx:136–137).

### Step 3 — READ-ONLY chips mid-build (Workflow/Deploy always; Confirm while running)
> Use a build whose turn is currently **RUNNING**. If BUILD‑A from Step 2 already reached `Done`, drive a mid-build turn on another available build (e.g. observe a turn that is mid-flight after an advance), or re-enter a running window. Do **not** start a fresh build solely for this — observe it on any build mid-turn.
1. **Observe (while a turn is RUNNING)** — the conversation composer renders with `lockStartBound` set and `lockConfirm` = `busy` = true (App.tsx:207–211). All three chips are dimmed/disabled (CSS `disabled` class; no twist caret; clicking opens nothing — Chat.tsx:285–290 guard `if (!disabled)`).
2. **Act** — hover (do not click) each chip to surface its native `title` tooltip; read the tooltip text exactly.
3. **Assert (tooltips, verbatim from the [00-README dictionary §4.1](00-README.md#41-empty-state--composer-apptsx-chattsx)):**
   - **Workflow** chip tooltip = **`workflow target is fixed when the build starts`** (Chat.tsx:346 — the per-chip `title` prop, which overrides the generic fallback at Chat.tsx:287; the fallback is never rendered for these three chips).
   - **Deploy** chip tooltip = **`deploy target is fixed when the build starts`** (Chat.tsx:354; matches dictionary §4.1).
   - **Confirm** chip tooltip = **`change confirm-mode once the build pauses at a gate`** (Chat.tsx:350; dictionary §4.1 row "Confirm chip disabled tooltip"). The Confirm chip is read-only **only while the turn is RUNNING**.
4. **Assert (Confirm re-enables at the gate)** — wait ≤ **300 s** for the running turn to reach its next gate (a gate card appears; `Running`/`Working…` gone). Then the Confirm chip becomes **editable again** (twist caret returns; tooltip gone; dropdown opens) — proving `lockConfirm` follows `busy`, editable once parked.

### Step 4 — REJECT ON DONE: PATCH on a terminal build is refused — **⚠️ API/CLI only, NOT browser-testable**
> **QA finding (verified 2026‑06‑14):** on a **`Done`** build the conversation composer routes to the **start-a-new-build** variant (placeholder `Describe another change to start a new build…`, App.tsx:217), and its three chips are **settings for the *next* build — they are NOT bound to the done task's `confirmMode`**. Changing the `Confirm` chip there does **not** PATCH the done task; it only sets the default for a new build. **There is therefore no UI affordance that PATCHes `confirm_mode` on a terminal task**, so the backend's reject-on-done `409` cannot be reached from the browser. It is a real, correct backend guard (defense-in-depth), but it must be verified at the **API/CLI** layer. Do **not** mark this PASS from the UI; run the curl below in a terminal.

**CLI check (run in a real shell — pick any `done` task id, e.g. the R‑fresh BUILD‑A `1781435001502`):**
```bash
curl -s -X PATCH http://127.0.0.1:4123/api/tasks/1781435001502 \
  -H "Content-Type: application/json" -d '{"confirm_mode":"auto"}'
```
**Assert:** HTTP `409` with body **`{"error":"task is done — confirm_mode is no longer changeable"}`** (tasks.ts:213–214 — literal expansion of `task is ${task.status} — confirm_mode is no longer changeable`).
**Cancelled variant:** PATCH a **cancelled** task id → `409` body **`{"error":"task was cancelled — confirm_mode is no longer changeable"}`** (tasks.ts:224).

*(Browser observation that stands in for the negative: on a done build, confirm there is no chip/affordance that maps to `patchConfirmMode(doneTaskId, …)` — the done-view chips are next-build settings. That observation alone is the UI half; the 409 itself is the curl above.)*

---

## Expected

Binding assertions (all must hold):

1. **Patch accepted at a gate** — parked Confirm chip changes `each step` → `auto` with **no** error banner (Step 1). PATCH 200.
2. **Patch honored (F2‑A effect)** — after a **single** advance click, the build runs **hands-free** to the **Done** gate: badge `Done`, title `Test passed — workflow updated` (Step 2). No intermediate gate required a click. This is the proof F2‑A is not a no-op.
3. **Read-only chips mid-build** — while a turn is RUNNING, all three chips are disabled; tooltips exactly:
   - Workflow → `workflow target is fixed when the build starts` (Chat.tsx:346; [dictionary §4.1](00-README.md#string-dictionary)).
   - Deploy → `deploy target is fixed when the build starts`.
   - Confirm → `change confirm-mode once the build pauses at a gate`.
   And the Confirm chip **re-enables once parked at the next gate**.
4. **Reject on terminal** — PATCH on `done` → 409 `task is done — confirm_mode is no longer changeable`; on `cancelled` → 409 `task was cancelled — confirm_mode is no longer changeable`. Chip value does not change.

---

## Negative / edge variants

- **PATCH-while-running 409 (covered in Step 1 assert + Step 3):** attempting the Confirm patch *during* a running turn must yield 409 `this build has a turn running — change confirm-mode once it pauses at a gate` (tasks.ts:218). In the UI the chip is disabled so the click is inert; if a raw PATCH is issued mid-turn the banner shows this exact string. Asserting its **absence** at a gate (Step 1) and the chip's disabled state mid-turn (Step 3) together cover both polarities.
- **PATCH-vs-cancel race (regression guard, tasks.ts:221–225):** patching the Confirm chip at the *same moment* the build is being **cancelled** must **NOT resurrect** the build — the cancel wins. The `isCancelled(id)` re-check after `loadTask` rejects the late patch with 409 `task was cancelled — confirm_mode is no longer changeable` instead of writing the stale `awaiting_confirm` snapshot back to disk. **Regression assert:** after a near-simultaneous Cancel + Confirm-patch, the build's terminal status is **`Cancelled`** (gate badge `Cancelled`, title `Build abandoned`, dictionary §4.3) — it is **not** revived to a gate, and `task.json` status is `cancelled`. This is timing-sensitive from a browser; if the race window cannot be hit reliably, record it as **obs** and verify the guard exists at tasks.ts:223–224 rather than fabricating a pass.
- **Missing-mode 400 (out of scope here, dictionary §4.8):** a PATCH with no `confirm_mode` returns 400 `confirm_mode is required` (tasks.ts:205) — the UI never sends this (it always supplies a value), so it is not browser-exercised in T09; noted for completeness.

---

## Pass / Fail

**PASS** — all four "Expected" assertions hold with **exact** strings:
- Step 1 chip flips to `auto`, no banner.
- Step 2 reaches the `Done` gate hands-free after one click (or, if 0-turn-capped, the patch-accept + read-only + reject paths all pass and the effect step is recorded as a documented partial).
- Step 3 tooltips match the source values exactly and Confirm re-enables at the gate.
- Step 4 yields the exact 409 done/cancelled rejection strings and the chip does not change.

**FAIL** — any of:
- Patch at a gate is rejected, silently reverted, or shows an error banner.
- After the single advance, an intermediate gate **stops for a click** (mode not honored → F2‑A no-op regression).
- Any tooltip or rejection string differs **character-for-character** from the asserted value (including `—` em dash, `…` ellipsis).
- A done/cancelled PATCH is accepted (chip changes / no 409).
- The PATCH-vs-cancel race **resurrects** a cancelled build to a gate.

**Evidence on FAIL:** capture a screenshot of the conversation/composer (chip state + any banner) and **quote the exact text seen vs the expected dictionary string** (e.g. `seen: "task is done, confirm_mode is no longer changeable" — expected: "task is done — confirm_mode is no longer changeable"`). For backend-string asserts, also capture the response code/body if the agent can read the network panel.

---

## Cleanup

1. **Discard any non-terminal build this file started or advanced into a parked state.** If BUILD‑A was left parked (Step 1 only, Step 2 skipped), and no later test reuses it, click **`Discard build`** (dictionary §4.4; gate.ts:46) on its gate, or use the sidebar hover-× tooltip `Cancel this build` (Sidebar.tsx:134) — Cancel is non-destructive (`projects/` + `.runs/` stay on disk, 00-README §1.3).
2. **Leave `Done` builds as-is** — do not discard terminal `Done` builds (they are the reject-on-done fixture and harmless to keep).
3. **Leave no parked turn / turn-lock held** — confirm the sidebar `In progress` section (Sidebar.tsx:127) shows no build of this test still `running`/`gate`. If T09 started BUILD‑A solely for this file (no earlier T02), discard it after the assertions so it does not hold context for later tests.
4. **Filesystem:** no extra cleanup beyond the above — Cancel/Discard does not delete `projects/`/`apps/builder/.runs/`. No temp files are created by this test.

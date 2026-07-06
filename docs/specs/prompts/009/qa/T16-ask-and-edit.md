# T16 — Ask mode + Edit-this-workflow (specs 033 / 034 / 035)

> **Audience:** a Claude Chrome-extension browser agent (sees the page, clicks, types, waits, reads).
> **Covers:** 033 (Ask at Analyze/Spec/Implement gates, Request-changes split, docked bar, reconnect-no-dup),
> 034 (Ask at a terminal `done`/`cancelled` build, `seededFrom` caption), 035 (Edit-this-workflow button).
> **Strings below are verbatim from `apps/builder/web/src/lib/i18n.ts` (EN column) — assert them exactly.**

---

## Setup (human, one-time — MUST rebuild so the 033/034/035 changes are served)

The Origin-CSRF check only accepts `http://127.0.0.1:4123`, so the app **must** be the BUILT bundle on 4123 —
the vite dev server (5173) 403s every mutation. From the repo root:

```bash
cd apps/builder/web && npm run build      # web/dist — includes the FE for 033/034/035
cd apps/builder && npm run build && npm start   # server dist + serves the SPA on http://127.0.0.1:4123
```

Point the Chrome agent at **http://127.0.0.1:4123**. Language must be **English** (top-right toggle until the
empty composer reads `Describe the workflow or change…`). Dify creds are NOT needed.

## Conventions (same as 00-README)

- **A build turn is real model spend.** ①Analyze / ②Spec / ③Implement each spawn a real `claude` turn (up to
  ~5 min). **An Ask is ALSO a real turn** (up to ~3 min). ④Test for `Deploy:none` is backend-only (no turn) and
  goes straight to `done`.
- **Poll, don't assume.** After any action that starts a turn, poll the page until the next deterministic signal
  (a Q&A bubble, a gate card, a status badge). Default timeout **300 s**. If nothing appears, **STOP and report**
  — do NOT click again (a 2nd click can 409 the turn-lock).
- **Assert exact strings.** "Looks right" is a FAIL. On any FAIL, screenshot + quote *seen* vs *expected*.
- **Cleanup:** Discard every build you start. `Edit this workflow` starts a NEW build — discard it too.

## Cost plan (reuse — do not start a build per test)

| Build | Settings | Used by |
|---|---|---|
| **BUILD-A** | `Workflow: none`, `Confirm: each step`, `Deploy: none`, req `R-fresh` | 033-A…D at its Spec/Implement gates → let it reach `done` → 034-A/B, 035-A |
| **BUILD-B** | same, cancel it **at the Spec gate** (after scaffold) | 034-C, 035-B |
| **BUILD-C** | same, cancel it **during ① Analyze** (before the Spec scaffold) | 035-C (the Non-goal #4 regression guard) |

`R-fresh` = *"A workflow that takes a topic string as input and returns a one-paragraph summary of it."*

---

## PART 1 — spec 033: Ask vs Request-changes at a live gate

Start BUILD-A. Let ①Analyze → the **Spec** gate (`Spec ready` / `Spec drafted — review before I build`).

### 033-A · Plain Send = Ask (no phase re-run, no artifact rewrite)
1. In the composer at the parked Spec gate, confirm the **mode chip reads `Ask`** and the placeholder reads
   `Ask a question…`.
2. Type a QUESTION (not a change), e.g. *"Why did you model the output as a single paragraph string?"* → Send.
3. **Expect:** a message↔message pair renders in the thread — your question bubble, then a streamed **answer
   bubble** (settling to an `Answered` tag). There is **NO** `Running ② Spec` disclosure, and the phase track
   does **not** revert to a running Spec.
4. The Spec gate card and its buttons (`Implement this spec` · `Edit spec` · `Discard build`) stay visible and
   parked (status still a gate, not running).
5. Open the artifact panel → **Spec** tab → the `SPEC.md` content is **unchanged** from before the Ask.
> **PASS:** Q&A bubbles, gate stays parked, SPEC.md byte-identical, no phase re-run.

### 033-B · Request-changes = re-run the phase
1. Click **`Edit spec`**. **Expect:** the composer mode chip flips to **`Request changes`** and the placeholder
   becomes `What should change?`.
2. Type a real change, e.g. *"Add a max-length note to the output."* → Send.
3. **Expect:** THIS re-runs the phase — a `Running ② Spec` disclosure appears; when it re-gates, the prior gate
   is resolved with the **`Edit spec`** label (not a generic one).
4. Confirm a **`Back to Ask`** affordance returns the chip to `Ask`.
> **PASS:** change-mode re-runs Spec; resolved marker reads `Edit spec`; toggle back works.

### 033-C · Docked action bar + disable-during-Ask
1. At the Spec (or the later Implement) gate, the action buttons **dock** just above the composer and stay
   clickable no matter how far the Q&A has scrolled.
2. Send another question; **while the answer is streaming**, the docked buttons are **disabled**; they
   **re-enable** once the answer settles.
> **PASS:** actions pinned + reachable; disabled only during a live Ask.

### 033-D · Reload preserves the Q&A conversation + no duplicate gate  *(#5 no-dup + client-side persist)*
1. At a parked gate with **at least one completed Q&A bubble** in the thread, **reload the page** (F5). The
   app returns to the empty view (there is no auto-reopen). **Reopen the same build** from the sidebar
   (`In progress` for a parked build, or the `Projects` tree for a `done` one).
2. **Expect:** the reopened thread shows the requirement + **the Q&A bubbles restored** (persisted client-side
   in `localStorage` — 033 D6 keeps the *backend* transcript-free), and **exactly ONE** gate card for the
   current phase — no duplicate gate card below the Q&A.
> **PASS:** Q&A bubbles present after reopen + one gate card. **FAIL:** Q&A lost, OR two identical gate cards.
> **Note (by design):** the persisted thread is client-only — a different browser / cleared cache starts
> fresh; and the heavy phase run-output logs are intentionally not restored (only the conversation + gate).

Now advance BUILD-A: `Implement this spec` → the **Implement** gate → optionally repeat 033-A there →
`Continue to Test` → it reaches **`done`** (Deploy:none). Keep it for PART 2 / 3.

---

## PART 2 — spec 034: Ask at a terminal build

### 034-A · The `done` composer is Ask-only (no settings row)
1. Open the finished BUILD-A from the **Projects** tree (a `done` build leaves `In progress`).
2. **Expect:** the composer placeholder reads **`Ask about this build…`**, and the settings chips row
   (Workflow / Confirm / Deploy) is **GONE** from this composer — just a text box + send.
> **PASS:** placeholder `Ask about this build…`, no settings chips. **FAIL:** the old `Describe another change…`
> placeholder or any settings chip still present.

### 034-B · Fresh-seeded Ask with a `Based on:` caption
1. At the `done` build, type a question (e.g. *"What does this workflow output for an empty topic?"*) → Send.
2. **Expect:** a Q&A bubble with a streamed answer, AND a small caption under it beginning **`Based on:`**
   listing the sources folded in (e.g. `requirement, SPEC.md, main.yml, report.json`).
3. The build stays `done` — no new build starts.
> **PASS:** answer + `Based on:` caption; done state untouched.

### 034-C · Cancelled build stays askable
Start **BUILD-B**, let it reach the Spec gate, then **Discard/cancel** it there.
1. In the cancelled view, the composer placeholder reads `Ask about this build…` (Send = Ask).
2. The **`Restore build`** button is present, AND (035) the **`Edit this workflow`** button is present.
> **PASS:** Ask works at cancelled; Restore + Edit-this-workflow coexist.

---

## PART 3 — spec 035: Edit this workflow

### 035-A · The button on a `done` build
1. On finished BUILD-A, the gate foot shows an **`Edit this workflow`** button (and, being `done`, **no**
   `Restore build`).
2. Click it. **Expect:** the view resets to a fresh empty composer **pre-targeted at that workflow** — the
   Workflow chip shows the build's `project / workflow` (NOT `none (new)`), ready for a change as the first
   message.
3. **Cleanup:** Discard this new build (or note the extra turn if you run it).
> **PASS:** button present at `done`, click pre-seeds a new edit-existing build.

### 035-B · Two independent actions
- On **BUILD-B** (cancelled AFTER scaffold): both `Restore build` and `Edit this workflow` render, each
  independently clickable.
- On **BUILD-A** (`done`): only `Edit this workflow` (no `Restore build`).

### 035-C · Non-goal #4 regression guard (cancel BEFORE scaffold)
Start **BUILD-C** and **cancel it during ① Analyze**, before it reaches the Spec gate (so no slug/scaffold, no
on-disk workflow yet).
1. In the cancelled view, **`Restore build`** IS shown.
2. **`Edit this workflow`** is **NOT** shown (there is no on-disk workflow to point an edit at).
> **PASS:** Restore present, Edit-this-workflow absent. **FAIL:** either Edit-this-workflow appears, OR Restore
> is missing (that missing-Restore is the exact regression the pure-helper extraction guards against).

---

## Not browser-testable (do NOT try from the Chrome agent — note as out-of-scope)

- **The Ask-anomaly modal** (`Ask reverted an unexpected write`, `askAnomaly*` strings): only fires if the
  permission-gate hook is *bypassed* and the Ask turn writes a file — unreachable from a normal browser. Covered
  by the server unit tests (`test/ask.test.ts` AC#1b/1c).
- **Layer-1 hook-deny / layer-2 byte-restore internals, `/cancel`-during-Ask parked-gate preservation** —
  server/unit only.
- **Cross-origin 403** — the Chrome agent cannot forge an `Origin` header (see T11, terminal/curl only).

## String reference (EN, verbatim — `i18n.ts`)
| Key | String |
|---|---|
| `modeAsk` | `Ask` |
| `modeChange` | `Request changes` |
| `modeBackToAsk` | `Back to Ask` |
| `phAskGate` | `Ask a question…` |
| `phChangeMode` | `What should change?` |
| `phAskAboutBuild` | `Ask about this build…` |
| `qaAnswered` | `Answered` |
| `qaSeededFrom` | `Based on: {sources}` |
| `editThisWorkflow` | `Edit this workflow` |
| `restoreBuild` | `Restore build` |
| Spec gate actions | `Implement this spec` · `Edit spec` · `Discard build` |
| Implement (clean) actions | `Continue to Test` · `Request changes` · `Discard build` |

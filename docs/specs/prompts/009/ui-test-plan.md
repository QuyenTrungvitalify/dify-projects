# UI Test Plan — Dify Workflow Builder (Spec 009) — for a browser-driving Claude agent

> Paste into a Claude agent that can drive Chrome (see the page, click, type, read). It walks the live
> UI at **http://127.0.0.1:4123** and verifies every case end-to-end, producing a PASS/FAIL report.

---

You are a QA agent testing the **Dify Workflow Builder** web app through its browser UI. Drive Chrome:
navigate, click, type, wait, and READ the rendered page to verify outcomes. Keep a running results table
and produce a final report. Do **not** edit code — only test through the UI (+ note bugs precisely).

## Preconditions (verify before starting; STOP + report if any fail)
- The app is running and serves **http://127.0.0.1:4123** (operator ran `cd apps/builder && npm start`).
- `claude auth login` was done on the host (the build phases spawn real `claude` turns — see Cost below).
- Open the URL: you should see the **empty / new-task** surface (a large composer "Describe the workflow
  or change…", and 3 setting chips **below** it: Workflow / Confirm / Deploy), plus a left **sidebar**.

## Cost & timing — READ THIS
- Phases ①Analyze ②Spec ③Implement spawn a **real `claude` turn each** (minutes, real model spend).
  **Do at most 2–3 full builds total.** Reuse builds across cases (e.g. park one to test multi-build).
- After clicking a gate button, the next phase runs for **up to ~5 min** — WAIT (poll the page) until the
  next **gate card** or a status change appears before proceeding. Don't spam clicks.
- Use a **simple requirement** every time, e.g.: `"Workflow: start node → one LLM node that summarizes the
  input text → end node"`.
- Settings for the cheapest/safest runs: **Workflow: none** · **Confirm: each step** · **Deploy: none**.

## How to verify
For each step: perform the action, WAIT for the UI to settle, then READ the page and check the **Expected**.
Mark ✅/❌ with a one-line note (what you saw). Screenshot on ❌. The key on-screen signals:
- **Phase track** at the top: `① Analyze · ② Spec · ③ Implement · ④ Test` (current step highlighted).
- **Disclosure** "Running ① Analyze…" = a turn is live; it stops when the phase gates.
- **Gate card** (inline in the thread) with buttons = the build is paused awaiting your decision.
- **Sidebar** lists builds (Project ▸ Workflow ▸ Task) incl. in-progress ones.
- **Toast** (reddish pill) = an error/blocked message.

---

## Test cases

### A — Load & empty state
- **A1** Open `/`. **Expected:** empty state renders; composer placeholder "Describe the workflow or change…";
  3 chips **below** input = `Workflow: none` · `Confirm: each step` · `Deploy: none`; **no** model picker /
  pattern picker. Sidebar shows "Projects" + a "+ New task". (AC #14, #13)
- **A2** Reload the page. **Expected:** if any build is in-progress (from a prior test), the sidebar **lists
  it** (load-recovery) — it is not lost. On a fresh app, sidebar shows only existing projects. (Lát 6 recovery)

### B — One full build, happy path (FULL BUILD #1 — model spend)
- **B1** Type the simple requirement; keep `none / each step / none`; **Send**. **Expected:** view switches to
  conversation; **phase track** appears; user bubble on the right; ①Analyze starts, **streamed output** shows
  under a "Running ① Analyze…" disclosure.
- **B2** WAIT for ① to finish. **Expected:** a **gate card** appears with `✔ Continue to Spec` and
  `💬 Request changes`; phase ① marked done. (AC #16)
- **B3** Click **Continue to Spec**. **Expected (critical):** the thread advances to a **②Spec running**
  disclosure — and **NO duplicate "Running ① Analyze…"** is left dangling above it (the optimistic-snapshot
  fix). WAIT → Spec gate `✔ Implement this spec` / `💬 Edit spec`.
- **B4** Click **Implement this spec**. WAIT (this phase runs the validate→fix loop). **Expected:** ③ gate —
  **clean**: `✔ Continue to Test` / `💬 Request changes`; OR **still-failing** (rare): `Accept anyway` /
  `Keep trying` / `Abandon` in a warning tone.
- **B5** Click **Continue to Test**. **Expected:** ④ runs on the **backend** (no "Running" turn) → **status
  done**; phase track all done. (AC #5 deploy=none)

### C — Artifact panel (reuse build #1, now `done`)
- **C1** Open the artifact panel (the "Artifact" pill / it may auto-open at Implement). **Expected:** tabs
  **Spec / Yaml / Diff / Report**.
- **C2** **Yaml** tab → `main.yml` shown + lint results (3 linters, all pass). (AC #4)
- **C3** **Diff** tab → for a NEW workflow, the whole `main.yml` renders as **additions** (empty base — this
  is intended). (AC #4)
- **C4** **Report** tab → path + lint summary; **no app_url** (deploy=none). (AC #5)
- **C5** **Spec** tab → it's an **editable textarea** with a **Save** button. Edit one line → **Save** →
  "Saved · feeds Implement". (AC #3)

### D — Reply / request changes (FULL BUILD #2 — model spend; can stop early)
- **D1** Start a new build (type a requirement in the composer → Send). WAIT for the ①Analyze gate.
- **D2** Click **💬 Request changes** (or type a change in the composer and send). **Expected:** an inline
  reply field or the composer takes a change request; on send, the **current phase re-runs** (`/reply`,
  `--resume`) and **does NOT advance** to the next phase. (AC #7)
- **D3** WAIT → it re-gates at the **same** phase. ✅ if no advance happened.

### E — Cancel + turn-level lock release
- **E1** (Reuse build #2, or start one.) While a phase **turn is running** (the "Running…" disclosure is
  live), find + click **Cancel/Abandon** (a cancel action, or the still-failing gate's Abandon). **Expected:**
  the build goes **cancelled**; the running turn stops. (AC #24)
- **E2** Immediately start a new build. **Expected:** it starts (the lock was released). (Lát 6)

### F — Multi-build / turn-level lock (Lát 6 — THE NEW FEATURE; needs 2 builds, mind cost)
- **F1** Start build **A**; WAIT until it **parks at a gate** (awaiting_confirm — a gate card showing, no
  live turn).
- **F2** WITHOUT cancelling A, click **"+ New task"** in the sidebar, type a different requirement, **Send**
  build **B**. **Expected (KEY Lát-6 win):** B **starts** — **NO "Busy — a build is already running"** toast
  — and runs its own ①, then parks at its gate.
- **F3** **Expected:** the **sidebar now lists BOTH A and B** as in-progress builds. Click A in the sidebar
  → its conversation + gate reopen; click B → B's reopen. (Lát 6 multi-build + load-recovery)
- **F4** **Turn collision:** open A, click its gate **Continue** (A's turn starts running). Quickly switch to
  B and click B's gate **Continue**. **Expected:** B shows an **actionable toast** like *"a turn is running —
  [Open it]"* (or it queues), NOT a silent failure. When A's turn ends, B can proceed.
- **F5** Park-doesn't-block (regression of the old bug): with A and B both parked, neither shows "Busy"; you
  can start a 3rd build. (If you saw "Busy — a build is already running" while everything is merely *parked*,
  that's a ❌.)

### G — Reconnect (AC #22)
- **G1** Start a build; while it's running or at a gate, **reload the tab** (or close+reopen). **Expected:**
  the build's **phase/status/gate is restored** (via re-fetch); you can still confirm it. Parked builds remain
  listed in the sidebar. (AC #22 + Lát-6 recovery)

### H — Done-state composer (dead-end fix)
- **H1** On a **done** build's conversation, type a new requirement in the composer and **Send**. **Expected:**
  it **starts a NEW build** (does NOT show `"task is done; /reply needs awaiting_confirm or error"`). If you
  see that red error, it's a ❌ (the dead-end fix regressed).

### I — Confirm modes
- **I1** Start a build with **Confirm: auto**. **Expected:** it runs **all 4 phases without pausing** at the
  gates (hands-free) → done. (AC #15) **Exception:** if Implement hits still-failing lint, it **hard-stops**
  at that gate (does not import / advance). (AC #25)
- **I2** (Optional) **Confirm: at spec only** → pauses only after ②Spec, auto-advances ① and ③.

### J — Out of browser (NOTE only — you can't do these via the UI; report as "not tested via UI")
- Boot-reconcile (restart server → running→error, parked builds survive), `#3b` confinement revert, and the
  selfhost/cloud Dify import (needs `DIFY_CONSOLE_URL/TOKEN`). Flag these as **CLI/manual** — out of scope for
  a browser agent.

---

## Cleanup
- **Cancel** any in-progress builds you started (so you don't leave parked turns), and note final states.

## Report format
Produce a table: `Case | Result (✅/❌) | What you observed | (screenshot ref if ❌)`. Then a short summary:
how many full builds you ran, any ❌ with exact repro steps + the on-screen text, and anything ambiguous.
Be specific (quote the exact toast/label you saw) so a developer can act without re-running.

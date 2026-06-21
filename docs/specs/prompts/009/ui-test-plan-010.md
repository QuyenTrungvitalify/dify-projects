# UI Test Plan — Builder UX Hardening (Spec 010: F1 + F2 + F4) — for a browser-driving Claude agent

> Paste into a Claude agent/extension that can drive Chrome (see the page, click, type, read). It walks
> the live UI at **http://127.0.0.1:4123** and verifies the **three spec-010 fixes only** (F1 cancel,
> F2 patchable confirm-mode, F4 slug-collision guard). Produces a PASS/FAIL report. Do **not** edit
> code — test through the UI, note bugs precisely. This complements `ui-test-plan.md` (the full 009 pass).

You are a QA agent. Drive Chrome: navigate, click, **hover**, type, wait, and READ the rendered page.
Keep a running results table (case → ✅/❌ → one-line note of what you saw). Screenshot every ❌.

## Preconditions (verify first; STOP + report if any fail)
- App running at **http://127.0.0.1:4123** (operator ran `cd apps/builder && npm start` after `npm run build` in both `apps/builder` and `apps/builder/web`).
- `claude auth login` done on the host — phases ①②③ spawn **real `claude` turns** (minutes, real spend).
- Opening `/` shows the **empty / new-task** surface: composer + 3 chips below it (`Workflow: none` ·
  `Confirm: each step` · `Deploy: none`) + a left sidebar.

## Cost & timing — READ THIS
- ①Analyze ②Spec ③Implement = one real `claude` turn each (up to ~5 min). After a gate click, **WAIT**
  (poll the page) until the next gate card / status change appears. Don't spam clicks.
- **Budget: do at most 3 full builds.** Reuse parked builds across cases.
- Requirements to use (two distinct slugs needed):
  - **R-existing** (collides on purpose): `Workflow: start node → one LLM node that summarizes the input text → end node`
    → derives slug **`workflow_start_node_one`**, which **already exists** in `projects/`.
  - **R-fresh** (novel, first-time slug): `Workflow: start node → one LLM node that translates English to French → end node`
    → derives a fresh slug (no collision on first run).

## On-screen signals
- **Phase track** top: `① Analyze · ② Spec · ③ Implement · ④ Test`. **Gate card** = inline card with
  buttons (build paused). **Disclosure** "Running … " = a live turn. **Sidebar → "In progress"** lists
  non-terminal builds. **Settings chips** sit below the composer in BOTH empty and conversation view.

---

## F1 — Cancel any in-flight build (gate card + sidebar)

- **F1-1 (gate Discard appears).** Start a build with **R-fresh**, `none / each step / none`. WAIT for the
  **① Analyze** gate. **Expected:** the gate card shows **three** buttons: `Continue to Spec`,
  `Request changes`, and a low-emphasis **`Discard build`** (ghost style, set apart from Continue). ✅ if
  Discard is present. (Pre-010 it was absent — this is the core fix.)
- **F1-2 (Discard cancels from the gate).** Click **`Discard build`**. **Expected:** the build flips to a
  **"Build abandoned / Cancelled by user"** card; phase track no longer active; it **drops from the
  sidebar "In progress"** list. The `projects/…` + `.runs/…` folders are NOT deleted (non-destructive) —
  you can't see disk from the UI, just confirm the build is gone from In-progress and a NEW build can start.
- **F1-3 (sidebar × on a PARKED build — immediate).** Start a build with **R-fresh**; WAIT for the ①
  gate so it's **parked** (the "In progress" row hint reads `gate`). **Hover** that row in the sidebar.
  **Expected:** a **×** button fades in on the right of the row. Click it. **Expected:** **no confirm
  dialog** (parked → immediate); the row disappears from "In progress". Opening was NOT required.
- **F1-4 (sidebar × on a RUNNING build — confirms first).** Start a build; while phase ① is **still
  running** (hint reads `running`, disclosure spinning), hover its sidebar row and click the **×**.
  **Expected:** a **native confirm dialog** ("Cancel … Its running turn will be stopped.") appears.
  Accept it → the live turn is killed, build leaves "In progress", and a NEW build can start right after
  (turn-lock released — Lát-6 regression check). Cancel the dialog instead → nothing happens.
- **F1-5 (still-failing keeps Abandon).** *(Only if you happen to hit a still-failing ③ gate — don't force
  it.)* **Expected:** that gate still shows `Accept anyway` / `Keep trying` / **`Abandon`** (its own
  cancel), unchanged.

## F2 — Confirm-mode is live-patchable (not a lying control)

- **F2-1 (chips reflect the build + read-only Workflow/Deploy).** Open any in-progress build (conversation
  view). Look at the 3 chips below the composer. **Expected:** **Confirm** shows the build's actual mode
  (e.g. `each step`); **Workflow** and **Deploy** are **dimmed / read-only** (≈60% opacity, **no caret**,
  clicking does nothing, tooltip ≈ "fixed when the build starts").
- **F2-2 (Confirm frozen while a turn runs).** While a phase is **running**, try to open the **Confirm**
  chip. **Expected:** it is **also disabled** (dimmed, no menu) — tooltip ≈ "change confirm-mode once the
  build pauses at a gate". When the build **parks** at a gate, the Confirm chip becomes **editable** again.
- **F2-3 (patch a parked build → auto → one Continue runs the rest).** Take a build **parked** at the
  **① Analyze** gate (Confirm `each step`). Open the **Confirm** chip → select **`auto`**. **Expected:**
  the chip now reads `auto`. Now click **`Continue to Spec`** **once**. **Expected (the fix):** the build
  runs **②Spec → ③Implement → ④Test without pausing at any further gate**, ending at **done**. (This is
  the mid-build switch QA reported as broken — verify it now works.) *Note: with R-existing this build's
  slug collides → F4 note will also appear; that's expected, ignore for F2.*
- **F2-4 (AC #15 — auto from the start).** From the **empty** view, set **Confirm: auto** (chip below the
  composer), `none / none`, requirement **R-fresh-2** (vary it slightly, e.g. "…translates English to
  German…"). **Send.** **Expected:** the build runs **①→②→③→④ hands-free, never pausing at a gate**, →
  **done**. Record PASS/FAIL — this AC was never exercised before.
- **F2-5 (AC #25 — auto hard-stops on still-failing).** Requires forcing lint≠0, which the UI can't do
  reliably. **If** an `auto` build ever reaches a **still-failing ③** it MUST **hard-stop** at that gate
  (NOT auto-advance to ④). If you can't reproduce a lint failure via the UI, mark **F2-5 = "not
  reproducible via UI — defer to CLI"** and move on (do not force it).

## F4 — Slug-collision guard (no silent overwrite)

- **F4-1 (first run, fresh slug — baseline).** Start a build with **R-fresh** (no `workflow` selected =
  new workflow), `each step / none`. Advance Analyze → **Spec gate** → click **`Implement this spec`**.
  WAIT for the **③ Implement** gate. **Expected:** a normal Implement card, **NO** collision note (the
  derived slug was free). Note the slug if visible in the artifact panel path (`projects/<slug>/main.yml`).
- **F4-2 (collision → auto-suffix + note).** Start a NEW build with **R-existing** (derives
  `workflow_start_node_one`, which **already exists**), new workflow, `each step / none`. Advance to the
  **Spec gate** → **`Implement this spec`** → WAIT for the **③ Implement** gate. **Expected (the fix):**
  the Implement gate card's summary **leads with a note** like:
  **`'workflow_start_node_one' already exists — using 'workflow_start_node_one_2' to avoid overwriting it.`**
  Open the **main.yml / diff** tab. **Expected:** the YAML path is **`projects/workflow_start_node_one_2/…`**
  and the diff is **pure additions** (empty base), NOT a messy diff against the pre-existing project —
  i.e. the original `projects/workflow_start_node_one/main.yml` was **not** touched.
- **F4-3 (note in the report).** Continue F4-2 to **done**, open the **report** tab. **Expected:** the
  report `notes` mention the rename (`…using 'workflow_start_node_one_2'…`).
- **F4-4 (auto path records it).** *(Optional, costs a build.)* Repeat F4-2 but with **Confirm: auto** from
  the empty view. **Expected:** no gate shown, but the final **report** still records the suffixed slug
  (`…_3` or next free) — no silent overwrite.

---

## Final report
Produce a table of every case above with ✅/❌ + the exact on-screen text you saw. Then a short summary:
(1) F1 — can every parked/running build be dismissed from BOTH the gate and the sidebar? (2) F2 — does
switching a parked build to `auto` + one Continue run the rest hands-free, and are Workflow/Deploy
read-only? (3) F4 — does a colliding new-workflow slug suffix to `_2` with a visible note and leave the
existing project untouched? List any ❌ with a screenshot and the precise reproduction steps.

# T12 — Deploy: cloud (no creds) + selfhost import (creds-gated)

> Canonical run guide + String Dictionary: [00-README](00-README.md). Every quoted string below is asserted **verbatim** from that dictionary — do not normalize the ellipsis `…`, middot `·`, or `≠`.

| Field | Value |
|---|---|
| **ID** | T12 |
| **Title** | Deploy: cloud (no creds) + selfhost import (creds-gated) |
| **Traces to** | AC#9 (cloud skips import, copyable YAML + Studio steps) · AC#5 (selfhost → clickable app_url) · AC#16 (explicit Import button when Deploy≠none, except auto) · AC#25 (push idempotency → CLI) |
| **Priority** | P1 (selfhost is optional / creds-gated) |
| **Cost** | ~3 real build-turns (BUILD‑F cloud, ①②③) + ~3 more turns **only if** selfhost creds are present and the selfhost section runs |

---

## Preconditions

- App running at **http://127.0.0.1:4123** (see [00-README §1.1](00-README.md#11-preconditions-human-one-time)). If the SPA is not loaded or the page errors, **STOP and report** — do not start a build.
- **CLOUD section** needs **NO Dify creds**. It is fully browser-testable as-is.
- **SELFHOST section** needs both `DIFY_CONSOLE_URL` **and** `DIFY_CONSOLE_TOKEN` in `apps/builder/.env`. The browser agent cannot read `.env`; the **human operator** must confirm both are set.
  - If either is **absent**: **STOP the selfhost section and report it as SKIPPED (creds-gated).** The CLOUD section still runs and must PASS independently.
- No other build should be mid-turn when you start (a turn-collision returns the 409 `a turn is already running — try again in a moment`; if you hit it, wait and retry — never double-click). See [00-README §4.8](00-README.md#48-backend-messages-status-banners--4xx-bodies--tasksts-uits-indexts).

---

## Steps

> **Turn discipline (every gate):** a build turn (①Analyze/②Spec/③Implement) is real model spend and can take ~5 min. After each gate click, **observe → act → wait(≤300 s) for the next on-screen signal → assert**. **Never** double-click a gate (a 2nd click can 409 the turn-lock). Phase ④ for `Deploy: none`/`cloud` is **backend-only — no turn**.

### A. CLOUD — Deploy "cloud", no creds (AC#9)

1. **Start BUILD‑F.**
   - *observe:* the empty composer shows placeholder `Describe the workflow or change…`; settings chips `Workflow`, `Confirm`, `Deploy` are visible below the input.
   - *act:* set **Confirm** = `each step`; set **Deploy** = `cloud`; type requirement **R-fresh-3** = `A workflow that takes a product name and returns a one-line marketing tagline.`; submit.
   - *wait:* ≤300 s for the **Analyze** gate to appear.
   - *assert:* a gate card with badge `Analyze complete`, title `Ready to write the spec`, summary `Requirement analyzed.` and `Continue to draft the spec, or request changes.`; gate buttons exactly `Continue to Spec` · `Request changes` · `Discard build`.

2. **Advance ① → Spec.**
   - *observe:* the Analyze gate from step 1.
   - *act:* click `Continue to Spec` **once**.
   - *wait:* ≤300 s for the **Spec** gate.
   - *assert:* badge `Spec ready`, title `Spec drafted — review before I build`, summary `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).`; buttons exactly `Implement this spec` · `Edit spec` · `Discard build`.

3. **Advance ② → Implement.**
   - *observe:* the Spec gate from step 2.
   - *act:* click `Implement this spec` **once**.
   - *wait:* ≤300 s for the **Implement** gate.
   - *assert:* clean Implement gate — badge `Implemented`, title `main.yml built and linted`, summary `Workflow YAML generated; all linters green.`; buttons exactly `Continue to Test` · `Request changes` · `Discard build`.
   - *note:* if instead the **still-failing** gate appears (badge `Lint still failing`, title `Still failing after the cap-5 attempts`, buttons `Accept anyway` · `Keep trying` · `Abandon`), the cloud-deploy AC#9 assertions below still apply after you click `Accept anyway`; record it as an obs.

4. **Phase ④ is backend-only for cloud — advance to "Done".**
   - *observe:* the clean Implement gate.
   - *act:* click `Continue to Test` **once**. (Cloud **SKIPS** import — CSRF blocks auto-push — so ④ runs backend-only with **no** turn and **no** Import gate.)
   - *wait:* ≤300 s for the **Done** gate.
   - *assert:* badge `Done`, title `Test passed — workflow updated`, summary `Linters re-run on the produced main.yml.` and `Open the report in the panel for the details.`
   - *negative assert:* **no** Import gate ever appeared (no `Import to Dify` / `Skip import` buttons) and **no** turn ran for ④.

5. **Open the Report tab — assert NO app_url card + the cloud deploy note.**
   - *observe:* the artifact panel (title `Artifact`); tabs `Spec` · `main.yml` · `Diff` · `Report`.
   - *act:* click the **`Report`** tab.
   - *wait:* ≤10 s for the report to render (title `Run report`).
   - *assert (no app_url):* there is **NO** app_url card — i.e. no `DEPLOYED · cloud` meta and no `Open` button.
   - *assert (deploy note, verbatim):* the deploy note reads exactly:
     `Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).`
   - *assert (Studio steps in the report notes, verbatim):* the report notes contain the Dify Studio import steps:
     `Cloud deploy: auto-import is blocked by CSRF, so import manually. The copyable YAML is the produced workflow (projects/<slug>/workflows/<file>, shown in the main.yml tab). Steps in Dify Studio: ① Studio → Create app → "Import DSL" → ② paste the YAML (or upload the file) → ③ Create.`
     (The `<slug>`/`<file>` segment is build-specific; assert the surrounding literal text and the ordered steps `Studio → Create app → "Import DSL"` → `paste the YAML` → `Create`. See [00-README §4.5](00-README.md#45-artifact-panel-artifactpaneltsx).)

6. **Confirm the copyable YAML is on the `main.yml` tab.**
   - *observe:* the artifact panel.
   - *act:* click the **`main.yml`** tab.
   - *wait:* ≤10 s.
   - *assert:* the produced workflow YAML is shown (not the empty-state `No main.yml yet — it appears after the Implement phase.`).

### B. SELFHOST — Deploy "selfhost", creds-gated (AC#5, AC#16)

> **Run this section ONLY if the human operator confirms `DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` are set in `apps/builder/.env`.** Otherwise report it SKIPPED (creds-gated) and end after Cleanup.

7. **Start a selfhost build, advance ①②③ to the clean Implement gate.**
   - *observe:* empty composer + settings chips.
   - *act:* set **Confirm** = `each step`; set **Deploy** = `selfhost`; type a fresh requirement (e.g. R-fresh-3 reworded so it does not collide with BUILD‑F's slug); submit.
   - *wait/assert:* exactly as steps 1–3 above — Analyze gate → click `Continue to Spec` → Spec gate → click `Implement this spec` → clean Implement gate (badge `Implemented`, title `main.yml built and linted`, buttons `Continue to Test` · `Request changes` · `Discard build`). Wait ≤300 s per turn; never double-click.

8. **Continue to Test → Phase ④ PARKS at the selfhost Import gate (AC#16).**
   - *observe:* the clean Implement gate.
   - *act:* click `Continue to Test` **once**.
   - *wait:* ≤300 s for the **Import** gate (`awaiting_import`).
   - *assert (AC#16 — explicit Import button because Deploy≠none AND Confirm is not `auto`):* the Test gate parks with buttons exactly `Import to Dify` · `Skip import` · `Discard build`. (Source: [00-README §4.4](00-README.md#44-gate-action-buttons-gatets--assert-exact-label-per-phase).)

9. **Import to Dify → Done + clickable app_url card (AC#5).**
   - *observe:* the Import gate from step 8.
   - *act:* click `Import to Dify` **once**.
   - *wait:* ≤300 s for the build to reach the **Done** gate.
   - *assert (terminal):* badge `Done`, title `Test passed — workflow updated`.
   - *act:* open the `Report` tab.
   - *assert (app_url card, AC#5):* an app_url card is present with meta `DEPLOYED · selfhost` and an `Open` button whose link is the live app URL (clickable, non-empty, opens in a new tab). (Source: [00-README §4.5](00-README.md#45-artifact-panel-artifactpaneltsx).)
   - *assert (no pre-import note):* the `selfhost` pre-import note `Not imported — use the Import button, or check Dify (see notes).` is **absent** once the app_url card is shown.

### C. SKIP IMPORT — alternative selfhost path

> Run on a **separate** selfhost build (or re-drive a fresh one); do not reuse the build that already imported in step 9.

10. **Skip import at the Import gate → build completes WITHOUT importing.**
    - *observe:* a selfhost build parked at the Import gate (buttons `Import to Dify` · `Skip import` · `Discard build`), reached exactly as in steps 7–8.
    - *act:* click `Skip import` **once**.
    - *wait:* ≤300 s for the **Done** gate (badge `Done`, title `Test passed — workflow updated`).
    - *act:* open the `Report` tab.
    - *assert (no app_url):* there is **NO** app_url card (no `DEPLOYED · selfhost` meta, no `Open` button).
    - *assert (selfhost pre-import note, verbatim, where applicable):* the deploy note reads exactly:
      `Not imported — use the Import button, or check Dify (see notes).`

### D. PUSH IDEMPOTENCY (AC#25) — NOT browser-testable

11. Re-running a selfhost import after a simulated mid-push crash must **not** create a duplicate Dify app. This is **Deploy‑CLI‑1** in [00-README §5 Appendix](00-README.md#5-appendix-not-browser-testable) — run as a CLI/manual check (kill after `push_intent.json` is written but before the app_id is captured; restart → `reconcilePushIntents` recovers the id via `sync.py list`; `sync.py list` shows exactly **one** app). **Do not attempt from the browser.**

---

## Expected

Binding assertions (exact strings):

**Cloud (AC#9):**
- Phase ④ runs backend-only — no Import gate, no turn — and reaches `Done` / `Test passed — workflow updated`.
- Report has **no** app_url card (no `DEPLOYED · cloud`, no `Open`).
- Deploy note (verbatim): `Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).`
- Report notes carry the Studio import steps: `… Steps in Dify Studio: ① Studio → Create app → "Import DSL" → ② paste the YAML (or upload the file) → ③ Create.`
- The copyable YAML is on the `main.yml` tab.

**Selfhost (AC#5, AC#16) — creds-gated:**
- ④ parks at the Import gate with buttons exactly `Import to Dify` · `Skip import` · `Discard build`.
- `Import to Dify` → `Done`; Report shows an app_url card with meta `DEPLOYED · selfhost` + clickable `Open`.
- `Skip import` → `Done`; **no** app_url card; pre-import note `Not imported — use the Import button, or check Dify (see notes).`

---

## Negative / edge variants

- **Confirm `auto` + Deploy `selfhost` (AC#16 exception):** with `Confirm: auto`, the selfhost import runs **WITHOUT** an explicit Import button — `auto` auto-confirms the first confirm action (`import`), so the build proceeds straight through ④ to `Done` and produces the `DEPLOYED · selfhost` app_url card with **no** parked Import gate. (This is the AC#16 exception: the explicit `Import to Dify` button appears only when Deploy≠none **and** Confirm is not `auto`.) — Note it; this typically spends extra turns, so run only if budget allows.
- **Still-failing Implement in `auto` + selfhost (AC#25):** a still-failing Implement under `Confirm: auto` **hard-stops before any import** — the build parks at the still-failing gate (badge `Lint still failing`, title `Still failing after the cap-5 attempts`, buttons `Accept anyway` · `Keep trying` · `Abandon`) and does **not** push to Dify. Cross-ref **T04** (auto hard-stop) and **T03** (still-failing gate). Browser-assert only if the condition arises naturally; forcing it is **Impl‑CLI‑1**.
- **No double-click at any gate:** a second click on `Continue to Test` / `Import to Dify` while a turn or push is in flight returns 409 `a turn is already running — try again in a moment` — do not trigger it.

---

## Pass / Fail

**PASS** (cloud, always required) iff:
1. ④ reaches `Done` / `Test passed — workflow updated` with **no** Import gate and **no** ④ turn; AND
2. Report has **no** app_url card; AND
3. The deploy note matches `Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).` character-for-character; AND
4. The report notes contain the ordered Studio steps `Studio → Create app → "Import DSL"` → `paste the YAML` → `Create`; AND
5. The `main.yml` tab shows the produced YAML.

**PASS** (selfhost, only if creds present) iff:
6. ④ parks at the Import gate with buttons exactly `Import to Dify` · `Skip import` · `Discard build`; AND
7. `Import to Dify` → `Done` + app_url card meta `DEPLOYED · selfhost` with a clickable `Open`; AND
8. `Skip import` → `Done` + **no** app_url card + note `Not imported — use the Import button, or check Dify (see notes).`

**SKIP** (selfhost) is an acceptable outcome iff the operator confirmed creds are absent — report it explicitly as `SELFHOST: SKIPPED (creds-gated)`; cloud must still PASS.

**FAIL** if any required assertion's seen string differs from expected, if an Import gate appears for cloud, if a duplicate app is created, or if a gate 409s from a double-click.

**Evidence:** on any FAIL, capture a screenshot of the gate/Report tab and **quote the exact text seen vs the expected string** above. For SKIP, record which env var(s) were missing per the operator.

---

## Cleanup

- **BUILD‑F (cloud):** if it has not reached a terminal `Done`/`Cancelled`, click `Discard build` at its current gate to free the turn-lock and leave no parked turn. If it reached `Done`, no action needed (terminal builds hold no lock). Source: cancel/discard is non-destructive — `projects/` + `.runs/` stay on disk ([00-README §1.3](00-README.md#13-conventions-every-test-file-assumes)).
- **Selfhost builds:** discard any still-parked selfhost build (`Discard build` at the Import or any gate).
- **Manual (filesystem / Dify):** any Dify app created by step 9's `Import to Dify` may need **manual deletion in Dify** (the browser test does not delete it). Note the created app's name/URL in the run log so the operator can remove it. Local `projects/<slug>/` scaffolding may also be removed manually if a clean repo is desired.
- After cleanup, confirm no build remains in the sidebar `In progress` section holding the turn-lock.

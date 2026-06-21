# Dify Workflow Builder — Browser QA Suite (spec 009 + 010)

> **Audience:** a Claude Chrome-extension browser agent (can *see the page, click, type, wait, read*) plus a human operator who runs the few CLI/manual checks.
> **Goal:** certify the Builder app to professional-QA standard, with every test traceable to a real acceptance criterion (AC #1–#25) or a post-QA fix (F1 / F2‑A / F4) or a fixed-bug regression.
> **Status of strings:** every "Expected" assertion in this suite is pulled **verbatim from the app source** (file:line cited in the [String Dictionary](#string-dictionary)). Where the older `ui-test-plan.md` / `ui-test-plan-010.md` quoted a *different* string (e.g. the artifact tab "Yaml", the gate `✔/💬` glyph prefixes, the collision toast wording), **this suite is authoritative** — assert the dictionary value, not the old plan's.

---

## 1. How to run the suite

### 1.1 Preconditions (human, one-time)
From the repo root `/Users/quyenbt/Desktop/MyProjects/dify-projects`:

```bash
./scripts/setup.sh                 # creates .venv/ + skills/ (prerequisite, AC#1)
claude auth login                  # the only extra Claude setup (AC#1)
cd apps/builder
npm install
npm run build
npm start                          # serves the built UI on http://127.0.0.1:4123
```

- App URL: **http://127.0.0.1:4123** (host hardcoded to `127.0.0.1`; only the *port* is overridable via `BUILDER_PORT`). Source: `apps/builder/server/index.ts:82,283`.
- Node 20.6+ (22 recommended).
- **Dify creds are NOT required** for the bulk of the suite. They are needed only for **T12 selfhost import** (`DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` in `apps/builder/.env`). The cloud path of T12 is browser-testable *without* creds.

### 1.2 The browser agent
Point the Chrome agent at `http://127.0.0.1:4123`. The agent should already see the loaded SPA (Preact). No login wall — it's a localhost single-user app.

### 1.3 Conventions every test file assumes
- **A "build turn" is real model spend.** Phases ①Analyze, ②Spec, ③Implement each spawn one headless `claude` turn and can take **up to ~5 minutes**. ④Test (for `Deploy: none`/`cloud`) is backend-only — **no turn**.
- **Waiting:** after an `act` that starts/advances a turn, **poll the page** until the next deterministic signal appears (a gate card, a status badge, an error banner) — do **not** assume instant. Default per-turn timeout: **300 s**. If a signal hasn't appeared in the stated timeout, **STOP and report** (do not click again — a 2nd click can 409 the turn-lock).
- **Asserting:** compare against the **exact** on-screen string in §[String Dictionary](#string-dictionary). "Looks right" is a FAIL.
- **Evidence:** on any FAIL, capture a screenshot and **quote the exact text seen** vs expected.
- **Cleanup:** every test ends by Discarding/Cancelling any build it started so no parked turn is left holding context. Cancel is non-destructive (`projects/` + `.runs/` stay on disk).

### 1.4 Run order & the build-reuse plan (cost discipline)
Full P0+P1 suite costs **≈5 full builds (~15 model turns)**. A **minimal P0 path** is **≈2 builds**. Reuse is mandatory — do **not** start a fresh build per test.

| Shared build | Settings | Started by | Reused by | Turns |
|---|---|---|---|---|
| **BUILD‑A** (spine) | `Workflow: none`, `Confirm: each step`, `Deploy: none`, requirement `R-fresh` | T02 | T03 (gates), T07 (artifacts), T06 (reconnect at a gate), T08 (discard variant), T09 (patch a parked gate), T10 (done-composer) | ①②③ ≈3 |
| **BUILD‑B** | `Confirm: auto`, `Deploy: none`, `R-fresh-2` | T04 (auto) | T05 collision partner is **not** B (B runs hands-free) | ≈3 |
| **BUILD‑C / D** | `Confirm: each step`, `Deploy: none`, two short reqs, each parked at **Analyze** only | T05 (multi-build/turn-lock) | — | ①+① ≈2 |
| **BUILD‑E** | `Confirm: each step`, `Deploy: none`, requirement that derives the existing slug `workflow_start_node_one` | T10 (F4 collision) | — | up to ③ ≈3 |
| **BUILD‑F** | `Confirm: each step`, `Deploy: cloud`, `R-fresh-3` | T12 (cloud) | — | ≈3 |

**Suggested requirements** (deterministic, cheap to analyze):
- `R-fresh`  = *"A workflow that takes a topic string as input and returns a one-paragraph summary of it."*
- `R-fresh-2` = *"A workflow that takes a city name and returns a short weather-style description string."*
- `R-fresh-3` = *"A workflow that takes a product name and returns a one-line marketing tagline."*
- `R-existing` (F4) = a requirement that derives the slug `workflow_start_node_one` — e.g. *"workflow start node one"* (the repo already contains `projects/workflow_start_node_one/` and `projects/workflow_start_node_one_2/`, so a fresh derive collides → expect `workflow_start_node_one_3`).

> ✅ **Standing authorization for the runner (so you never dead-end on a precondition):** when a named reuse target (e.g. BUILD‑A) is **absent**, you **ARE authorized** to (a) **start a fresh build** for that test — just note the turn cost and Discard it in cleanup — and (b) **use or cancel the stale leftover parked builds** (`1781258629769`, `1781188571273`, `1781188159495` and similar old junk — they are not owned by any planned test; cancelling them is also the intended T08 cleanup). Do **NOT** STOP+report *solely* because BUILD‑A is missing — start a fresh one instead. Only STOP+report if the **app itself is unreachable** or a step's outcome is genuinely ambiguous. (Exception: still never advance/PATCH a build you can't identify *if* a step's whole point is the handoff to a later test — but with the chain decoupled below, that rarely applies.)

> ⚠️ **Finding a reused build (parked vs done):** the sidebar **`In progress`** section lists **only non-terminal** builds (parked at a gate / running). A build that has reached **`done`** is terminal and **moves to the `Projects` tree** (it scaffolded `projects/<slug>/`) — it is **not** in `In progress`. So: reuse a *parked* build from `In progress`; reuse a *done* build (e.g. for T07's Report tab, T10's dead-end composer, T09's reject-on-done) by opening it from the **`Projects` tree**. A fresh QA-agent session has no memory of which build is BUILD‑A — identify it by **state** (its requirement / `.runs/<taskId>/` / phase), and never mistake a stale leftover parked build for it.

**Recommended order:** T01 (Chrome agent) → T11 (run in a **terminal**, not the Chrome agent — see T11) → T02 (start BUILD‑A; it runs ①②③ then ④ to `done`) → T03 → T07 → T06 → T09 → T08 → T10 → finish BUILD‑A to `done` → T04 (BUILD‑B) → T05 (BUILD‑C/D) → T12 (optional, BUILD‑F).

---

## 2. Coverage matrix

`B` = browser-testable here · `CLI` = CLI/manual (see [Appendix](#appendix-not-browser-testable)) · `obs` = observable only if the condition naturally occurs.

| AC / Fix | One-line | Test ID(s) | Priority | Mode |
|---|---|---|---|---|
| **AC#1** | boot + serve built UI; `/health` non-OK if `.venv/`/`skills/` missing | T01 (boots/serves), **App‑CLI‑1** (`/health`) | P0 | B + CLI |
| **AC#2** | seed picker lists Dify apps; Analyze produces summary & **stops** | T02 (Analyze stops), T01 (seed picker empty-state), **App‑CLI‑2** (real seed list, creds) | P0 | B + CLI |
| **AC#3** | Spec writes `SPEC.md`, stops; edit reflected in Implement | T02, T07 (edit+Save) | P0 | B |
| **AC#4** | Implement → `main.yml`, 3 lints exit 0, diff/empty-base | T02, T07 | P0 | B |
| **AC#5** | Test&Report: `none`→path no app_url; `selfhost`→app_url | T07 (none), T12 (selfhost, creds) | P0 | B + CLI |
| **AC#6** | `each step` → no auto-advance; pause at each gate | T04, T02 | P0 | B |
| **AC#7** | `/reply` revises current phase without advancing | T03 | P0 | B |
| **AC#8** | Implement validate→fix self-corrects ≥1 seeded error | T02 (obs), **Impl‑CLI‑1** (force) | P1 | obs + CLI |
| **AC#9** | Cloud: skip import, copyable YAML + Studio steps | T12 (cloud, no creds) | P1 | B |
| **AC#10** | no turn hangs on permission prompt | T02 (turns complete, implicit), **Sec‑CLI‑1** | P1 | obs + CLI |
| **AC#11** | no runtime dep on claude-nexus | **Repo‑CLI‑1** | P2 | CLI |
| **AC#12** | README covers install/auth/.env/4-phase | **Doc‑CLI‑1** | P2 | CLI |
| **AC#13** | sidebar = `projects/` tree; hover project → New task; static crumb | T01 | P1 | B |
| **AC#14** | settings below input: Workflow/Confirm/Deploy only; no model/pattern picker; defaults | T01, T10 | P0 | B |
| **AC#15** | confirm modes: each-step / spec-only / auto | T04 | P0 | B |
| **AC#16** | inline gate buttons; import button when `Deploy≠none` (except auto) | T02, T03, T12 | P0 | B |
| **AC#17** | standalone repo untouched; Python gates pass | **Repo‑CLI‑2** | P2 | CLI |
| **AC#18** | new-workflow slug/name proposed at Spec gate; scaffold on confirm | T02 | P0 | B |
| **AC#19** | phase error → `status:error` + `Retry phase`, no advance; restart re-runnable | T03 (error gate, obs/force), **Recover‑CLI‑1** (restart) | P1 | obs + CLI |
| **AC#20** | validate-loop cap ≤5 → still-failing gate, never loops | T04/T03 (still-failing gate UI, obs), **Impl‑CLI‑1** | P1 | obs + CLI |
| **AC#21** | turn-level lock: 2 parked builds OK (no Busy); turn-collision → 409 + Open it | T05 | P0 | B |
| **AC#22** | SSE reconnect restores phase/status/gate; parked builds listed | T06 | P0 | B |
| **AC#23** | confinement-revert; token-never-in-turn; bind 127.0.0.1; cross-origin 403 | T11 (403 + binding — **terminal/curl, NOT the Chrome agent**), **Sec‑CLI‑2/3** (revert, token) | P0 | CLI |
| **AC#24** | cancel frees lock → new build starts; boot clears lock | T08 (cancel→new build), **Recover‑CLI‑1** (boot) | P0 | B + CLI |
| **AC#25** | clean vs still-failing gate distinct; auto hard-stops; push idempotent | T03 (distinct actions), T04 (auto hard-stop, obs/CLI), **Deploy‑CLI‑1** (push idempotency) | P0 | B + CLI |
| **F1** | Discard on every gate + sidebar hover-× | T08, T03 | P0 | B |
| **F2‑A** | live-patch confirm-mode via PATCH; takes effect; Workflow/Deploy read-only mid-build; PATCH-on-done rejected | T09 (patch+effect+read-only = B; **PATCH-on-done 409 = CLI** — the done-view chips are next-build settings, so the UI never PATCHes a done task) | P0 | B + CLI |
| **F4** | slug-collision auto-suffix `_2`/`_3` + gate note; original untouched | T10 | P1 | B |

**No AC is silently uncovered.** Every AC maps to ≥1 browser test or to a named CLI/manual check in the [Appendix](#appendix-not-browser-testable).

---

## 3. Test files

| File | Group | P | Cost (turns) |
|---|---|---|---|
| [T01-smoke.md](T01-smoke.md) | Boot, empty state, sidebar, settings defaults | P0 | 0 |
| [T02-build-happy-path.md](T02-build-happy-path.md) | Full 4-phase build → done; optimistic-dup regression; slug propose | P0 | ~3 (BUILD‑A) |
| [T03-gates-and-decisions.md](T03-gates-and-decisions.md) | Gate actions; Request-changes re-runs same phase; error/Retry; distinct still-failing | P0 | 0–1 (reuse A) |
| [T04-confirm-modes.md](T04-confirm-modes.md) | auto / spec-only / each-step; auto + still-failing hard-stop | P0 | ~3 (BUILD‑B) |
| [T05-multibuild-turnlock.md](T05-multibuild-turnlock.md) | 2 parked builds no Busy; turn-collision 409 + Open it | P0 | ~2 (C/D) |
| [T06-recovery-reconnect.md](T06-recovery-reconnect.md) | reload mid-build restores phase/gate; parked persists | P0 | 0 (reuse A) |
| [T07-artifacts-panel.md](T07-artifacts-panel.md) | Spec/main.yml/Diff/Report tabs; lint rows; Spec edit+Save | P1 | 0 (reuse A) |
| [T08-cancel-discard.md](T08-cancel-discard.md) | Discard from gates (F1); sidebar × ; cancel frees lock | P0 | 0–1 |
| [T09-confirm-mode-patch.md](T09-confirm-mode-patch.md) | live-patch confirm mode (F2‑A); read-only chips; reject on done | P0 | 0 (reuse A) |
| [T10-validation-negative.md](T10-validation-negative.md) | empty req; double-click gate; blank Spec save; no pickers; F4 slug collision | P0/P1 | ~3 (BUILD‑E) |
| [T11-security.md](T11-security.md) | cross-origin POST/PATCH → 403; 127.0.0.1-only — **terminal/curl, NOT the Chrome agent** | P0 | 0 |
| [T12-deploy-dify.md](T12-deploy-dify.md) | cloud (no creds) + selfhost import (creds-gated) | P1 | ~3 (BUILD‑F) |
| [T13-build-capability.md](T13-build-capability.md) | **Engine builds > single-LLM**: verify node types (`if-else`/`code`/`iteration`/`agent`/…) in the produced `main.yml` via the artifact panel | P1 | ~3 + ~3/extension |
| [T14-input-robustness.md](T14-input-robustness.md) | **Legal-but-hard requirements**: vague / ambiguous / contradictory / out-of-scope / over-limit / long / multilingual / adversarial → graceful open-questions & scope notes, no crash | P1 | cheap (stop at Spec) |
| [T15-edit-existing.md](T15-edit-existing.md) | **Workflow ≠ none**: Analyze summarizes the existing workflow, Implement edits in place, Diff has a non-empty (pre-edit) base. *(Exercises the local edit-existing path fixed in [GAP #14](GAP-REPORT.md) — `localEditSeed`, 2026‑06‑18.)* | P1 | ~3 (reuse a `done` target) |

> **Companion corpus (not a pass/fail test):** [BUILD-PROMPT-CORPUS.md](BUILD-PROMPT-CORPUS.md) — the *workflow-requirement* prompts (every node type, branch/iteration/aggregate shapes, edit/seed, confirm/deploy matrix, `/reply`, edge/negative/over-limit/adversarial). **T13–T15 are the Chrome-agent realizations of this corpus** (they type its requirements and assert the produced YAML/Spec): the corpus is the requirement+expectation bank; T13–T15 drive and verify it in the browser. T01–T12 certify *how the app behaves* (gates/settings/recovery on trivial builds); T13–T15 certify *what the engine can build* and *how it handles bad input*.

> **⚠️ i18n (added after T01–T12 were written):** the app now localizes its UI chrome **EN ⇆ JA** via a top-right toggle (`apps/builder/web/src/lib/i18n.ts`; `localStorage` key `lang`, default `en`). **The String Dictionary in §4 is the *English* column** and a few entries are now **stale** (e.g. the Diff-empty string is `No diff yet — a diff appears once a workflow is seeded from a Dify app or pattern.` and the seed-empty string dropped the `(Lát 5)` parenthetical). For deterministic assertions, **pin the language to English** before a run (toggle until the composer placeholder reads `Describe the workflow or change…`), or substitute the `ja` column from `i18n.ts`. **Build content (YAML / SPEC.md / report / lint lines) is never translated** (`i18n.ts:9–13`), so structural assertions (node `type:` tokens, lint row names) are language-independent.

---

## 4. String Dictionary

Authoritative on-screen strings, verbatim from source. Assert these exactly.

### 4.1 Empty state / composer (`App.tsx`, `Chat.tsx`)
| Element | Exact string | Source |
|---|---|---|
| Empty composer placeholder | `Describe the workflow or change…` | App.tsx:300 |
| Live-build composer placeholder | `Reply, or describe another change…` | App.tsx:212 |
| Terminal-state composer placeholder | `Describe another change to start a new build…` | App.tsx:217 |
| Seed picker label | `SEED FROM` | App.tsx:307 |
| Seed picker empty | `No seed apps — connect Dify to seed from a workspace app (Lát 5). New workflows start from scratch.` | App.tsx:310 |
| Seed "none" chip | `none` | App.tsx:314 |
| Suggestions label | `TRY` | App.tsx:325 |
| Empty-state crumb | `New task` | App.tsx:295 |
| Settings chip: Workflow | `Workflow` (value when none: `none (new)`) | Chat.tsx:344,334 |
| Settings chip: Confirm | `Confirm` (options `each step` / `spec only` / `auto`) | Chat.tsx:347,348 |
| Settings chip: Deploy | `Deploy` (options `none` / `selfhost` / `cloud`) | Chat.tsx:351,352 |
| Confirm chip disabled tooltip | `change confirm-mode once the build pauses at a gate` | Chat.tsx:350 |
| Workflow chip disabled tooltip (rendered) | `workflow target is fixed when the build starts` | Chat.tsx:346 |
| Deploy chip disabled tooltip (rendered) | `deploy target is fixed when the build starts` | Chat.tsx:354 |
| (generic fallback, NOT rendered for the 3 composer chips — each passes its own `title`) | `set when the build started — not changeable mid-build` | Chat.tsx:287 |

### 4.2 Phase track + run disclosure (`Chat.tsx`)
| Element | Exact string | Source |
|---|---|---|
| Phase labels | `Analyze` · `Spec` · `Implement` · `Test` | Chat.tsx:26–29 |
| Running disclosure | `Running` | Chat.tsx:85 |
| Stopped disclosure | `Stopped during` | Chat.tsx:87 |
| Working detail | `Working…` | Chat.tsx:104 |
| Connection dot | `Live` / `Reconnecting…` | App.tsx:157 |

### 4.3 Gate cards — badges / titles / summaries (`Chat.tsx`)
| Gate | Badge | Title | Summary line(s) | Source |
|---|---|---|---|---|
| Analyze | `Analyze complete` | `Ready to write the spec` | `Requirement analyzed.` / `Continue to draft the spec, or request changes.` | Chat.tsx:150–151 |
| Spec | `Spec ready` | `Spec drafted — review before I build` | `SPEC.md is editable in the panel — tweak it before implement (last-writer wins).` | Chat.tsx:153–154 |
| Implement (clean) | `Implemented` | `main.yml built and linted` | `Workflow YAML generated; all linters green.` | Chat.tsx:156–157 |
| Implement (still-failing) | `Lint still failing` | `Still failing after the cap-5 attempts` | `The agent self-corrected as far as it could in one turn.` / `Your call: accept anyway, keep trying, or abandon.` | Chat.tsx:144–145 |
| Done | `Done` | `Test passed — workflow updated` | `Linters re-run on the produced main.yml.` / `Open the report in the panel for the details.` | Chat.tsx:136–137 |
| Error | `Phase failed` | `<phase> errored` (+ `exit 1` meta) | `No files were written. Retry re-runs only this phase from the approved input.` | Chat.tsx:129–130 |
| Cancelled | `Cancelled` | `Build abandoned` | `Cancelled by user — the spec/artifacts so far are preserved.` | Chat.tsx:133 |

### 4.4 Gate action buttons (`gate.ts`) — assert exact label per phase
| Phase / variant | Buttons (advance · re-run-same-phase · cancel) | Source |
|---|---|---|
| Analyze | `Continue to Spec` · `Request changes` · `Discard build` | gate.ts:63,64,46 |
| Spec | `Implement this spec` · `Edit spec` · `Discard build` | gate.ts:72,73,46 |
| Implement (clean) | `Continue to Test` · `Request changes` · `Discard build` | gate.ts:91 |
| Implement (still_failing) | `Accept anyway` · `Keep trying` · `Abandon` | gate.ts:82–84 |
| Test (selfhost `awaiting_import`) | `Import to Dify` · `Skip import` · `Discard build` | gate.ts:107,108 |
| Error (any phase) | `Retry phase` (re-run only) | gate.ts:49 |

> Gate-strip links: `open SPEC.md` (Chat.tsx:208), `main.yml` (212), `view diff` (213), `open report` (217).
> Gate reply box: placeholder `What should change before continuing?` (230); buttons `Cancel` (234) / `Send & re-run` (237).

### 4.5 Artifact panel (`ArtifactPanel.tsx`)
| Element | Exact string | Source |
|---|---|---|
| Panel title / close | `Artifact` / `Hide panel` | 207 / 210 |
| **Tabs (exact casing)** | `Spec` · `main.yml` · `Diff` · `Report` | 194–197 |
| Spec tab title / empty | `SPEC.md` / `No SPEC.md yet — it appears after the Spec phase.` | 44 / 45 |
| Save button | `Save spec` (while saving: `Saving…`) | 51 |
| Save status | `Saved · feeds Implement` / `Unsaved changes` | 55 / 56 |
| Spec footer note | `API token redacted · never shown` | 59 |
| main.yml empty | `No main.yml yet — it appears after the Implement phase.` | 85 |
| Lint section / pass / fail | `Lint results` / `ok` / `exit {code}` | 90 / 98 |
| Lint row names | `validate_workflow` · `lint_refs` · `lint_plugin_hashes` | 68–70 |
| Diff title / empty | `Split diff` / `No diff yet — the seed/pattern diff producer lands in Lát 5.` | 113 / 114 |
| Report title / empty | `Run report` / `No report yet — it appears after the Test phase.` | 131 / 132 |
| Report rows | `Workflow file` · `Lint` (`all passed`/`failures recorded`) · `Deploy` (`not deployed (local)`) · `Accepted` (`lint failure overridden (human)`) | 139–143 |
| app_url card | meta `DEPLOYED · {deploy}` + button `Open` | 158 / 161 |
| Report deploy notes | none: `Deploy is off — no app URL. Set Deploy ≠ none to import & get a link.` · cloud: `Cloud deploy — import the YAML manually in Dify Studio (steps in the notes below; the YAML is in the main.yml tab).` · selfhost(pre-import): `Not imported — use the Import button, or check Dify (see notes).` | 173 / 165 / 169 |

### 4.6 Sidebar (`Sidebar.tsx`)
| Element | Exact string | Source |
|---|---|---|
| Heading | `Projects` | 161 |
| Buttons | `New project` · `New task` · `New task in this workflow` | 163 / 168 / 50 |
| Active section header | `In progress` | 127 |
| Status hints | `gate` (awaiting_confirm) · `running` (running/scaffolding) | 96 |
| Hover-× tooltip | `Cancel this build` | 134 |
| Empty states | `No projects yet` / `no tasks yet` | 173 / 55 |

### 4.7 Stop dialog + collision banner (`App.tsx`)
| Element | Exact string | Source |
|---|---|---|
| Stop pill / title | `Stop` / `Stop the running build` | 153 / 152 |
| Stop dialog title | `Stop this build?` | 111 |
| Stop dialog body | `Cancel <title>? Its running turn will be stopped and this phase's progress discarded.` | 112 |
| Stop dialog confirm btn | `Stop build` | 113 |
| Turn-collision banner btn | `Open it` | 269 |

### 4.8 Backend messages (status banners / 4xx bodies) — `tasks.ts`, `ui.ts`, `index.ts`
| When | Exact `error` string | Code | Source |
|---|---|---|---|
| Turn busy (any start/confirm/reply) | `a turn is already running — try again in a moment` (+ `holder`) | 409 | tasks.ts:43 |
| Empty requirement | `requirement is required` | 400 | tasks.ts:99 |
| Confirm missing actionId | `actionId is required` | 400 | tasks.ts:153 |
| Confirm wrong status | `task is ${status}, not awaiting_confirm` | 409 | tasks.ts:162 |
| Confirm stale action | `'${actionId}' is not a current confirm action` | 409 | tasks.ts:168 |
| Reply empty text | `text is required` | 400 | tasks.ts:237 |
| Reply wrong status | `task is ${status}; /reply needs awaiting_confirm or error` | 409 | tasks.ts:248 |
| PATCH missing mode | `confirm_mode is required` | 400 | tasks.ts:205 |
| PATCH on terminal | `task is ${status} — confirm_mode is no longer changeable` | 409 | tasks.ts:214 |
| PATCH while turn running | `this build has a turn running — change confirm-mode once it pauses at a gate` | 409 | tasks.ts:218 |
| PATCH on cancelled | `task was cancelled — confirm_mode is no longer changeable` | 409 | tasks.ts:224 |
| Blank Spec save | `SPEC.md cannot be empty` | 400 | ui.ts:109 |
| Invalid task id | `invalid task id` | 400 | ui.ts:70,88 |
| Cross-origin mutating req | `origin not allowed` | 403 | index.ts:217–218, sse.ts:165–166 |
| Boot reconcile (restart) | `interrupted by backend restart — phase re-runnable` | — | lock.ts:133 |
| Confinement breach | `confinement breach (reverted): <path>` | — | post-turn.ts:182 |

---

## 5. Appendix: NOT browser-testable {#appendix-not-browser-testable}

These behaviors cannot be verified from a browser (server-side git/state, restart, env isolation, real Dify). Run them as CLI/manual checks. Each has a stable ID referenced from the coverage matrix.

| ID | What | AC | Command / procedure | Pass |
|---|---|---|---|---|
| **App‑CLI‑1** | `/health` non-OK when `.venv/` or `skills/` missing | #1 | With server running: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4123/health` → 200. Then temporarily rename `skills/` → restart → expect non-200 + a clear message: `curl -s http://127.0.0.1:4123/health`. Restore `skills/`. | non-OK status + clear message when missing |
| **App‑CLI‑2** | Seed picker lists real Dify apps | #2 | Set `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN`; `curl -s http://127.0.0.1:4123/api/seeds` → `{seeds:[{id,name,mode},…]}`. Without creds → `{seeds:[],reason,note}` (HTTP 200). | non-empty seeds with creds; graceful empty without |
| **Impl‑CLI‑1** | Force a still-failing Implement (cap-5) / self-correct (AC#8) | #8,#20,#25 | Drive a build whose requirement/seed deterministically yields a lint error (e.g. a fixture with a bad node-id), via the curl harness or a crafted seed; confirm Implement stops at the still-failing gate after ≤5 passes with the last linter error + partial `main.yml`. | ≤5 passes, stops, no loop |
| **Sec‑CLI‑1** | No turn hangs on a permission prompt | #10 | Inspect a live phase turn: `claude` spawned with `--permission-mode acceptEdits --setting-sources local` (claude-session.ts:90–92); turn exits 0 without prompting. Tail `apps/builder/.runs/<id>/` logs. | turn completes, exit 0, no prompt |
| **Sec‑CLI‑2** | Confinement-revert of out-of-scope write (incl. opaque Bash) | #23 | Seed a phase that writes outside scope (e.g. `python -c "open('tools/x','w')"`); after the turn, `git status` shows **no** `tools/x` (reverted) and the task → `status:error` with `confinement breach (reverted): tools/x`. | out-of-scope write reverted; task error |
| **Sec‑CLI‑3** | Dify token never in turn / SSE / `.runs` JSON | #23 | `export DIFY_CONSOLE_TOKEN=SENTINEL123…`; run any build; then `grep -rs "SENTINEL123" apps/builder/.runs/` → **no hits**; capture `/stream` → token absent (redacted). Verify strip in claude-session.ts:101–105. | zero hits anywhere |
| **Recover‑CLI‑1** | Restart recovery + lock clear (AC#19/#24 boot clauses) | #19,#24 | Start a build to `running`; `kill` the server mid-turn; restart. Expect the `running` task.json → `error` = `interrupted by backend restart — phase re-runnable`; **parked** (`awaiting_confirm`) builds survive untouched; turn-lock cleared so a new `POST /api/tasks` succeeds. | running→error; parked survive; new build OK |
| **Deploy‑CLI‑1** | Push idempotency (no duplicate Dify app) | #25 | With selfhost creds: complete a selfhost import; simulate a mid-push crash (kill after `push_intent.json` written, before app_id captured); restart → `reconcilePushIntents` recovers the id via `sync.py list` (no re-push). `sync.py list` shows exactly **one** app. | exactly one app; no duplicate |
| **Repo‑CLI‑1** | No runtime dependency on claude-nexus | #11 | `grep -ri "claude-nexus" apps/builder/server` → only vendored/copied code, no runtime import/require of an external nexus package; `npm ls` shows none. | no external nexus dep |
| **Repo‑CLI‑2** | Standalone repo gates still pass | #17 | From repo root: `bash scripts/check_dsl_version.sh` and `python skills/.../regen_vscode_settings.py` exit 0; existing CI/pytest unchanged; `apps/` doesn't trip Python gates. | all gates exit 0 |
| **Doc‑CLI‑1** | README covers install/auth/.env/4-phase | #12 | Read `apps/builder/README.md`; confirm it documents install, `claude auth login`, `.env`, and the 4-phase run. | all four covered |

---

## 6. Honesty about scope
- **Browser-covered (Chrome agent):** AC #2(partial)/#3/#4/#5(none)/#6/#7/#9/#13/#14/#15/#16/#18/#21/#22/#24(cancel)/#25(distinct gates) and F1/F2‑A/F4.
- **CLI/terminal-only:** AC #1(`/health`), #2(real seeds), #8/#20(force), #10, #11, #12, #17, #19(restart), **#23 entirely — cross-origin 403 + 127.0.0.1 binding (T11, curl) AND revert/token (Sec‑CLI‑2/3)**, #24(boot), #25(push idempotency). *(The Chrome browser agent cannot forge an `Origin` header, so T11 must run in a real shell.)*
- **obs (only if it occurs naturally):** AC#8 self-correction, AC#19 error gate, AC#20 still-failing gate — the browser asserts the UI **if** the condition arises; forcing the condition is a CLI check.

See [GAP-REPORT.md](GAP-REPORT.md) for which behaviors the code exposes that have **no** acceptance criterion (spec gaps worth flagging), and [REVIEW-and-risk-register.md](REVIEW-and-risk-register.md) for the Phase-1 architecture + safety review.

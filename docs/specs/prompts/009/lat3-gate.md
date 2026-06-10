# Implementation Prompt — Spec 009, Lát 3: GATE (pause/confirm/reply + run-lock + cancel)

> Copy-paste vào fresh session.

---

You are implementing **Lát 3 — GATE (the crux, net-new)** for the dify-projects repo. This is
the slice that turns the auto-advancing 4-phase chain (Lát 2) into a **human-gated** build: the
orchestrator pauses `awaiting_confirm` at each phase boundary, advances **only** on
`POST /confirm`, lets `/reply` revise within a phase (resumed session), and adds a run-lock +
cancel + lock-release + Confirm-mode + the two Implement gate variants. Still curl-driven (no SSE,
no UI — that's Lát 4).

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST** (only the parts your slice touches):
  - [docs/specs/009-implementation-plan.md](../../009-implementation-plan.md) → the **"### Lát 3 — GATE"**
    section (your (a)–(g)); plus **"Cross-cutting decisions"**, **"Divergences"**, and the
    **"Spec-update ledger"** at the bottom.
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) →
    **§D Gating** (Confirm-mode table + the two Implement gate variants), **§I Error handling &
    recovery** (status machine, run-lock granularity, per-phase idempotency, boot reconcile),
    the **§Revision 2026-06-10** blocks "Gating / auto mode" + "Concurrency / lifecycle", the
    **Endpoints** table (`/api/tasks`, `/confirm`, `/reply`, `/cancel`), the **gate-action schema**
    `{id,label,kind,route}` (§Revision Cleanups + §D), §A "Phase state machine", §Data model
    "Slug/name derivation", and **Acceptance criteria #6, #7, #8, #15, #18, #19, #20, #21, #24, #25**.
  - [docs/specs/009-spike-findings.md](../../009-spike-findings.md) → §5 (model C: the canonical
    spawn invocation + `headless-settings.json`) and §3 E5 (`--resume <session_id>` carries
    context — the mechanism `/reply` relies on).
  - [.claude/skills/dify-build/SKILL.md](../../../../.claude/skills/dify-build/SKILL.md) +
    [implement.md](../../../../.claude/skills/dify-build/implement.md) — the phase engine (the
    backend reads these bodies; do **not** edit them in this slice).

## Why this matters

The gate is the **one decisive technical reason this is a dedicated app and not a nexus config**:
because *our* orchestrator runs one bounded Claude turn per phase and decides **when to issue the
next turn**, stop-and-confirm is enforced structurally — not by a soft prompt instruction, not by
nexus's unfinished `review_each_phase` (#079). Lát 2 proved the chain runs; Lát 3 makes it
**stop**, makes a second build wait (run-lock 409), makes a stuck build cancellable, and makes a
restart recoverable. Everything in Lát 4 (UI buttons) and Lát 5 just renders/extends what this
slice's state machine emits.

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                              # note pre-existing modifications; you branch below
git log --oneline -3                                    # confirm Lát 2 landed (4-phase chain)

# Lát 2 artifacts MUST exist (this slice extends them — do NOT recreate):
ls apps/builder/headless-settings.json                  # model-C seed (Lát 1)
ls apps/builder/server/index.ts
ls apps/builder/server/lib/claude-session.ts apps/builder/server/lib/turn-runner.ts
ls apps/builder/server/lib/post-turn.ts apps/builder/server/lib/shell.ts
ls apps/builder/server/lib/phases.ts apps/builder/server/lib/orchestrator.ts apps/builder/server/lib/report.ts
ls apps/builder/server/state/task.ts                    # task JSON in .runs/<taskId>/

# environment the backend shells into:
ls .venv/bin/python skills/mango-svip/scripts/generate_id.py skills/mango-svip/scripts/validate_workflow.py
ls tools/dify_base/lint_refs.py tools/dify_base/lint_plugin_hashes.py tools/dify_base/init_project.py
ls .claude/skills/dify-build/implement.md

claude --version                                        # spike pinned 2.1.156; record if different
```

If any Lát-2 file above is missing, **STOP** — Lát 3 strictly depends on Lát 2's auto-advance chain
+ `session_id` persistence in `.runs/<taskId>/task.json`. Do not re-implement Lát 1/2 here.

Create a working branch before any edits:

```bash
git checkout -b lat3-gate
```

## Mission

Convert auto-advance into a **gated state machine**. Concretely:

1. **Pause at each boundary.** When a phase turn ends and verify passes, set
   `status: awaiting_confirm`, attach `gate.actions[]`, and **do not** issue the next turn —
   unless the task's `confirmMode` says to auto-advance this boundary.
2. **Advance only on `/confirm`.** `POST /api/tasks/:id/confirm {actionId}` resumes the
   orchestrator: run the **next** phase as a **fresh turn** handed the prior artifact PATH
   (no cross-phase `--resume`).
3. **`/reply` revises within a phase.** `POST /api/tasks/:id/reply {text}` re-runs the **current**
   phase via `--resume <sessionIds[currentPhase]>` — Lát 2 persists a **per-phase map**
   `sessionIds:{analyze?,spec?,implement?}` in `.runs/<taskId>/task.json` (NOT a flat `session_id`
   field), so index it by the current phase — then re-verifies and re-gates **without advancing**.
4. **Run-lock + cancel + lock-release + boot reconcile** (one build at a time → 409).
5. **Confirm-mode** (`confirm each step` / `confirm at spec only` / `auto`) drives which boundaries
   pause vs auto-advance.
6. **Two Implement gate variants** (clean vs still-failing cap-5); **`auto` hard-stops** at
   still-failing and never imports a lint≠0 workflow.
7. **Re-home scaffold behind the gate:** `init_project.py` + the `SPEC.md` move now fire on the
   `/confirm` that closes Spec (not on raw auto-advance), and that confirm payload may carry a
   user-edited `slug`/`name` (AC #18).

**Out of scope (do NOT build):** SSE relay / `/stream` (Lát 4), any UI / web (Lát 4), `selfhost`
push / `app_url` / `--json-out` / `sync.py` Dify I/O (Lát 5), the seed picker `/api/seeds` (Lát 5),
the SPEC.md `PUT` editor backend (Lát 4), the `--json-out`/`--group` tool changes (Lát 5). Keep
`deploy=none` throughout (Phase ④ = backend validate + `report.json`, no Dify contact). Curl only.

## Tasks

### 1 — `server/lib/lock.ts` (run-lock, build-level single-build)

Create `apps/builder/server/lib/lock.ts`. v1 is **build-level single-build-at-a-time** (spec §I
"Run-lock granularity"): a task in `running` **or** `awaiting_confirm` HOLDS the lock; only
`done | error | cancelled` RELEASE it (a build paused for human review at a gate still holds it).

- A single in-memory holder `{ taskId } | null` is the source of truth for the live process; the
  persisted truth is the set of `.runs/<taskId>/task.json` statuses (so a restart can reconcile).
- `acquire(taskId)` → throws/returns-false if a holder exists (caller maps to **409**).
- `release(taskId)` → clears the holder iff it matches.
- `holder()` → current `{taskId}|null`.
- **Boot reconcile** (exported `reconcileOnBoot()`, called once from `server/index.ts` at startup):
  scan `apps/builder/.runs/*/task.json`; any task in `running` → rewrite to `status: error`
  (message "interrupted by backend restart — phase re-runnable"), and **clear** the lock; a task in
  `awaiting_confirm` is left as-is **but re-acquires the lock** (it's a live gated build the user can
  still confirm/cancel). `done|error|cancelled` are ignored. **Tie-breaker:** the single-build invariant
  means at most one non-terminal task should exist; if reconcile finds **more than one** `running`/
  `awaiting_confirm` task (corrupt state), `error` all but the most-recently-updated and re-acquire the
  lock for that one. (AC #19, #24.)

### 2 — `server/lib/gate.ts` (gate-action computation)

Create `apps/builder/server/lib/gate.ts`. Each gate action has the schema **`{id, label, kind, route}`**
(spec §Revision Cleanups + §D), where `kind` distinguishes the primary `/confirm` action from a
composer-focus `/reply`. Export `computeGate(phase, verifyResult, deploy)` → `{actions:[…]}`:

- **① Analyze (success):** `[{id:"continue", label:"Continue to Spec", kind:"confirm", route:"/confirm"},
  {id:"changes", label:"Request changes", kind:"reply", route:"/reply"}]`.
- **② Spec (success):** `[{id:"continue", label:"Implement this spec", kind:"confirm", route:"/confirm"},
  {id:"changes", label:"Edit spec", kind:"reply", route:"/reply"}]`. (The `/confirm` that closes Spec
  is where scaffold fires — Task 5.)
- **③ Implement — CLEAN** (all 3 linters exit 0): `[{id:"continue", label:"Continue to Test",
  kind:"confirm", route:"/confirm"}, {id:"changes", label:"Request changes", kind:"reply", route:"/reply"}]`.
- **③ Implement — STILL-FAILING** (cap 5 reached, lint≠0): `[{id:"accept", label:"Accept anyway",
  kind:"confirm", route:"/confirm"}, {id:"keep", label:"Keep trying", kind:"reply", route:"/reply"},
  {id:"abandon", label:"Abandon", kind:"cancel", route:"/cancel"}]`, plus a top-level
  `gate.flag = "still_failing"` on the task state so `auto` and the UI can detect it.
- **④ Test&Report (success, deploy=none):** terminal — set `status: done`, **no** gate actions (or an
  empty list). (The `selfhost` Import button is Lát 5.) *(Defensive branch: the ③→④ path in
  `confirmAdvance` writes `report.json` + sets `done` directly without calling `gateAfterPhase(④)`, so
  this is rarely reached — keep it for completeness.)*
- **error** (any phase): `[{id:"retry", label:"Retry phase", kind:"reply", route:"/reply"}]` (spec §I:
  the gate never auto-advances out of `error`).

`computeGate` is **pure** (no I/O) — the orchestrator owns the lint exit codes from the post-turn
verify (Lát 1's `post-turn.ts`) and the cap-5 loop bookkeeping, and passes them in.

### 3 — extend `server/lib/orchestrator.ts` (pause/resume; re-home scaffold; gate variants)

Refactor the Lát-2 orchestrator so it no longer auto-advances unconditionally. Split it into two
entry points so a separate HTTP request (`/confirm`, `/reply`) can drive the next step:

- **`runPhase(task, phaseId)`** — spawn the fresh turn for `phaseId` (canonical model-C spawn, Task 7),
  parse stream-json, capture+persist the init event's session id into `sessionIds[phaseId]` in
  `.runs/<taskId>/task.json` (Lát 2 already does this per-phase — reuse), run post-turn verify
  (correctness + confinement, Lát 1's `post-turn.ts`). On
  confinement violation or correctness failure → `status: error` + `gate=computeGate(phase,err,…)`
  (Lát 1 already reverts out-of-confinement writes — keep that; the gate just exposes Retry).
- **`gateAfterPhase(task)`** — set `status: awaiting_confirm`, attach
  `gate = computeGate(phase, verify, task.deploy)`, persist, and **return** (do NOT issue the next
  turn). Then `maybeAutoAdvance(task)` decides per **Confirm-mode** (Task 6) whether to immediately
  call `confirmAdvance(task, "<primary actionId>")` or leave it paused for a human `/confirm`.
- **`confirmAdvance(task, actionId)`** — the `/confirm` handler's core. Validate `actionId` is a
  `kind:"confirm"` action currently in `task.gate.actions` (else 409/400). Then:
  - **closing Spec (②→③):** **re-home the scaffold here** (Task 5) — if a no-slug new-workflow task,
    apply any user-edited `slug`/`name` from the confirm payload, run `init_project.py`, move
    `SPEC.md`, then `runPhase(task, "implement")`.
  - **Implement clean → Test (③→④):** `runPhase`-equivalent for ④ is **backend** (Lát 2's
    `report.ts`, no turn) → write `report.json`, `status: done`, **release lock**.
  - **Implement still-failing + `actionId:"accept"`:** the spec allows manual "Accept anyway" → proceed
    to ④ even with lint≠0 (this is a **human** override; `auto` may NOT take it — Task 6). The Phase-④
    report should note the accepted lint failures. (Still `deploy=none` here.)
  - **other boundaries (①→②, etc.):** `runPhase(task, nextPhase)` then `gateAfterPhase`.
  - After any terminal phase, `release(taskId)`.
- **`replyWithin(task, text)`** — the `/reply` handler's core (Task 4 below).
- **Implement cap-5 = the agent's IN-TURN budget, NOT backend re-spawns.** `runPhase("implement")`
  spawns **exactly ONE** Implement turn; the 5-pass validate→fix loop runs **inside** that turn — the
  agent self-corrects per [implement.md](../../../../.claude/skills/dify-build/implement.md) (it re-runs
  the 3 linters and fixes until all exit 0, or 5 passes elapse). **After the single turn ends**, the
  backend (`post-turn.ts`) re-runs the 3 linters **once** on the produced file to pick the variant:
  all exit 0 → **clean**; any lint≠0 → **still-failing** (`gate.flag="still_failing"`). The backend does
  **NOT** re-spawn the turn 5 times (that would double-apply edits and break §I idempotency). On a YAML
  parse error the agent regenerates from pattern+`SPEC.md` (its in-turn rule); `validate_workflow.py` is
  0/1 only — never branch on exit code (always regenerate on retry, spec §I). A mid-turn **timeout** is
  `status: error` (re-runnable, regenerate-from-scratch), **distinct** from the still-failing gate (spec §I:826).

### 4 — `/reply` = `--resume <sessionIds[phase]>` WITHIN the phase

`replyWithin(task, text)`:

- Read `sessionIds[<current phase>]` from `.runs/<taskId>/task.json` (Lát 2 persists the per-phase map
  `sessionIds:{analyze?,spec?,implement?}`) — **not** a flat `session_id`, **not** a live variable.
- Re-spawn the **current** phase's turn with the canonical model-C invocation **plus**
  `--resume <sessionIds[phase]>` and the user's `text` as the new prompt (fed via stdin). Spike E5 proved
  `--resume` carries context. If the stored id is missing/expired (resume errors) →
  fall back to a **fresh turn seeded with the current phase's artifact PATH** (spec §A persistence
  caveat / Q3), do not crash.
- Re-run post-turn verify, then `gateAfterPhase(task)` — i.e. **re-gate without advancing**
  (`status` returns to `awaiting_confirm` for the **same** phase). For Implement, "Keep trying"
  (`/reply` on the still-failing gate) runs another implement attempt and re-gates.
- `/reply` is also the **Retry** path out of `error` (spec §I): it re-runs the failed phase.

Cross-phase is **always** a fresh turn (no `--resume`); only the within-phase `/reply` resumes.
This is what makes a restart re-runnable (spec Q3 / AC #19).

### 5 — Re-home scaffold behind the Spec gate (AC #18)

Move the `init_project.py` + `SPEC.md`-move side effects (Lát 2 ran them on raw auto-advance) so they
fire **inside `confirmAdvance` on the ②→③ confirm**, for a no-slug new-workflow task only:

- The `/confirm` payload may carry `{actionId, slug?, name?}` — a user-edited slug/name at the Spec
  gate. Apply them (slug sanitized to snake_case) before scaffolding.
- Backend runs (cwd = `DIFY_PROJECTS_DIR`, via `server/lib/shell.ts`):
  `.venv/bin/python tools/dify_base/init_project.py --non-interactive --name "<name>" --slug <slug>
  --app-type workflow --primary-lang <lang>` with **`--slug` == the active task slug** (arg-validation,
  spec §J). Then **move** `.runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md` (idempotent).
- Use `status: scaffolding` during the non-atomic move (spec §I / QĐ #9) — a **transient internal
  sub-state of `running`** (inherited from Lát 2), **not** a sixth queryable/terminal status (the spec's
  five are running/awaiting_confirm/done/error/cancelled); it exists only so a crash mid-move is
  recoverable. Then proceed to `runPhase(task, "implement")`. `init_project.py` writes the whitelisted side-effects
  (`.vscode/settings.json`, `projects/<slug>/.dify-workspace.yaml`) — already in the post-turn
  confinement whitelist (Lát 1); do not flag them.
- Edit-existing / slug-supplied tasks **skip** staging — they already wrote straight to
  `projects/<slug>/` (no scaffold at the gate).

### 6 — Confirm-mode wiring (`maybeAutoAdvance`)

In `server/lib/phases.ts` (or orchestrator), read `task.confirmMode` and decide at each boundary.
**Wire-field note (avoid API drift):** the spec's public field is **`confirm_mode`** with the
**verbose** values `"confirm each step"` (default) / `"confirm at spec only"` / `"auto"` (spec §A
Endpoints + AC #15). Accept those on the `POST /api/tasks` body and **normalize on input** to the
internal `confirmMode ∈ {"each_step" | "spec_only" | "auto"}` used below — or just use the verbose
strings throughout; do not ship a *different* public contract than the spec.

| confirmMode | behavior at boundary |

| confirmMode | behavior at boundary |
|---|---|
| `each_step` (default) | **pause** at every boundary (①②③); advance only on `/confirm` |
| `spec_only` | pause **only after Spec** (②); auto-issue the next turn for ① and ③ |
| `auto` | auto-issue every next turn — **except** hard-stop at a **still-failing** Implement gate (lint≠0): leave `awaiting_confirm` + `gate.flag="still_failing"` and never auto-advance to ④ (never imports lint≠0). A **clean** Implement gate `auto` may advance. |

`maybeAutoAdvance(task)`: if the mode says auto-advance THIS boundary **and** it is not a
still-failing Implement gate, call `confirmAdvance(task, <primary confirm actionId>)`; else leave
`awaiting_confirm`. Phase-④ import-button auto-suppression is a Lát-5 concern (deploy=none here).

### 7 — `server/routes/tasks.ts` (the HTTP surface)

Create `apps/builder/server/routes/tasks.ts` (Fastify plugin) and register it in `server/index.ts`.
All mutating POSTs bind `127.0.0.1` only (already hardcoded) — no SSE here. The **canonical model-C
spawn** every turn uses (verbatim, spike §5):

```
claude -p --output-format stream-json --verbose \
  --permission-mode acceptEdits \
  --settings apps/builder/headless-settings.json \
  --setting-sources local
```

(prompt fed via **stdin**; cwd = `DIFY_PROJECTS_DIR`; `/reply` adds `--resume <sessionIds[phase]>`.)

| Route | Method | Behavior |
|---|---|---|
| `/api/tasks` | POST | `{requirement, workflow?, confirmMode?, deploy?, seed?, slug?, name?}` → `acquire` the run-lock (**409 Busy** if held), create `.runs/<taskId>/task.json`, `runPhase(task,"analyze")` → `gateAfterPhase` → `maybeAutoAdvance`. Returns the task state. `confirmMode` default `each_step`; `deploy` default `none`. |
| `/api/tasks/:id` | GET | Current task state (phase, status, `gate.actions`, `gate.flag`, artifact paths). |
| `/api/tasks/:id/confirm` | POST | `{actionId, slug?, name?}` → reject (409) if task not `awaiting_confirm` or `actionId` not a current `kind:"confirm"` action → `confirmAdvance` → `gateAfterPhase`/`maybeAutoAdvance` on the new phase. Returns new state. |
| `/api/tasks/:id/reply` | POST | `{text}` → reject (409) if not `awaiting_confirm`/`error` → `replyWithin`. Returns re-gated state. |
| `/api/tasks/:id/cancel` | POST | if a child is live, kill it; **if paused at a gate (no live child — e.g. Abandon on the still-failing gate), just** set `status: cancelled` and **`release` the lock**. Works in both states. Returns final state. |

Run the orchestrator step **asynchronously** w.r.t. the HTTP response only if you keep the task
state queryable via GET; the simplest correct v1 is to **await** the turn inside the POST handler so
the response carries the resulting gate (acceptable for curl; SSE in Lát 4 makes it live). Pick one
and be consistent. `cancel` must work **whether or not a turn is live**: keep a handle to the child
process on the task's in-memory record so the handler can `kill` it when running; when the task is
paused at a gate (`awaiting_confirm`, e.g. Abandon) there is **no child** — just set `cancelled` +
release the lock (do not throw on a null handle).

### 8 — Demo harness (curl through all gates)

Add `apps/builder/scripts/demo-gates.sh` (or document the exact curl sequence in the PR body). It
must exercise, end-to-end on localhost (start the server first: `cd apps/builder && npm start` or the
Lát-2 dev command):

1. **each_step pauses at all boundaries:** `POST /api/tasks {confirmMode:"each_step", deploy:"none", …}`
   → GET shows `awaiting_confirm @ analyze`; `POST /confirm {actionId:"continue"}` → `awaiting_confirm
   @ spec`; `/confirm` (with `slug`/`name` for a new-workflow task → scaffold fires, AC #18) →
   `awaiting_confirm @ implement` (clean); `/confirm` → ④ → `done`. (AC #6, #15, #18.)
2. **`/reply` revises Spec without advancing:** at `awaiting_confirm @ spec`,
   `POST /reply {text:"add a JP-translation step"}` → still `@ spec`, SPEC.md changed. (AC #7.)
3. **seeded self-correcting error in Implement:** a requirement/seed that makes the first implement
   pass fail one linter, fixable in ≤5 → ends **clean** and still **stops** for confirm. (AC #8, #20.)
4. **still-failing cap-5 hard-stop:** an unfixable seeded error → after ≤5 passes,
   `awaiting_confirm @ implement` with `gate.flag="still_failing"` + actions `[Accept anyway / Keep
   trying / Abandon]`; in `auto` mode it **hard-stops** here (does NOT reach ④). (AC #20, #25.)
5. **409 on 2nd build:** while build #1 holds the lock (even paused at a gate),
   `POST /api/tasks` → **409**. (AC #21.)
6. **cancel frees the lock:** `POST /:id/cancel` → `cancelled`; a new `POST /api/tasks` now
   **succeeds**. (AC #24.)
7. **boot reconcile:** kill the server mid-`running`, restart → that task is `error`, lock cleared, a
   new build starts. (AC #19, #24.)

### 9 — Commit (LOCAL only) + spec confirmation

When **every** Acceptance box below passes:

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
npx tsc -p apps/builder/tsconfig.json --noEmit    # type-check passes (no UI yet)
git add apps/builder/ docs/specs/prompts/009/
git commit            # pre-commit MUST run; do NOT use --no-verify
```

Commit message ends with:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Spec-update ledger:** the plan's Lát 3 row (g) says **"None new"** — this slice **implements**
§D/§I/§Revision (cancel + lock) rather than diverging from them. So **do not** rewrite the spec for
new behavior. The one required action: **confirm AC #24 + #25 wording matches what you built** (run
them; if your implementation made a forced wording-level deviation — e.g. an action `id`/`label` or a
status name — fix the **code** to match the spec, not the spec to match the code; the repo forbids
silent drift). If you discover a genuine spec contradiction you had to resolve, record the exact edit
in the plan's **Spec-update ledger** and apply it to
[009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) — do not leave it implicit.
Do **not** push.

## Acceptance

Map each to the spec's Acceptance criteria; all must pass via curl:

- [ ] **AC #6** — in default `each_step`, **no** phase auto-advances: the build observably sits in
  `awaiting_confirm` at each of ①②③; advancing requires a `/confirm` POST.
- [ ] **AC #7** — `/reply` at a gate revises the current phase's output **without** advancing (status
  returns to `awaiting_confirm @ same phase`).
- [ ] **AC #8** — the Implement validate→fix loop self-corrects ≥1 seeded error without human help,
  then **still stops** for confirmation.
- [ ] **AC #15** — `Confirm mode` works: `each_step` pauses every phase; `spec_only` pauses only after
  Spec; `auto` runs through without pausing (modulo the still-failing hard-stop).
- [ ] **AC #18** — a `Workflow:none` no-slug task gets slug+name proposed at the Spec gate; on
  `/confirm` (payload may edit slug/name) `init_project.py` scaffolds `projects/<slug>/` and the build
  proceeds to Implement.
- [ ] **AC #19** — a phase whose turn errors/produces no artifact lands `status: error` with a
  `Retry phase` (`/reply`) action and does **not** advance; a turn killed by a backend restart is
  re-runnable on reboot (boot reconcile → `error`, lock cleared).
- [ ] **AC #20** — an unfixable seeded error stops at the Implement gate after **≤5** passes with the
  last linter error + partial `main.yml`, never looping (`gate.flag="still_failing"`).
- [ ] **AC #21** — starting a second build while one runs returns **409**; the first build is
  unaffected (lock held even while paused at a gate).
- [ ] **AC #24** — `POST /:id/cancel` kills the running turn, sets a terminal status, frees the lock so
  a new `POST /api/tasks` succeeds; on boot the lock is cleared and any `running` task → `error`.
- [ ] **AC #25 (gate-variant half)** — a clean Implement (lint 0) and a still-failing Implement
  (cap-5, lint≠0) render **distinct** gate actions; in `auto` mode the still-failing gate
  **hard-stops** and no advance to ④ occurs (never imports lint≠0). *(The `push_intent` duplicate-app
  half of #25 is Lát 5 — `deploy=none` here means no import path to test; note this explicitly.)*
- [ ] `npx tsc --noEmit` clean; `git status --porcelain` shows only intended paths under
  `apps/builder/` + `docs/specs/prompts/009/`; pre-commit passes (no `--no-verify`).

## On blocker

- **Lát 2 didn't persist `session_id` into `.runs/<taskId>/task.json`** → `/reply` can't resume.
  First fix the Lát-2 persistence (it was specified as a Lát-2 deliverable, plan §Lát 2 (b)); if you
  truly cannot, implement `/reply` as the **fresh-turn-seeded-with-artifact** fallback (spec Q3) and
  note the degradation — do not block the whole slice.
- **`--resume` errors** ("no such session" / expired) → that is the **expected** fallback path
  (spec §A persistence caveat): catch it, re-run as a fresh turn seeded with the current artifact PATH,
  continue. Record it; don't crash.
- **`init_project.py` flags differ** from the prompt (e.g. no `--primary-lang`) → run
  `.venv/bin/python tools/dify_base/init_project.py --help`, use the real flags, note the correction.
  Do **not** invent a `--group` flag (it does not exist yet — that's a Lát-5 tool change).
- **A turn hangs** → check you used the **exact** model-C spawn (`--permission-mode acceptEdits
  --setting-sources local`, prompt via stdin); a missing `--setting-sources local` re-introduces the
  repo's `permission-gate.js` hook (spike §2) which can hang the turn for ~31 min. Confirm
  `claude auth login` was done.
- **Can't kill the child on `/cancel`** → ensure the spawn keeps a process handle on the in-memory
  task record (not just the persisted JSON); `cancel` operates on the live process, lock-release on
  the persisted state.
- **Anything contradicts the spec** (e.g. §D says a boundary should pause but you find you must
  auto-advance) → STOP, write it up, surface it; do not silently reshape the gate.

## Guardrails

- **Scope:** gate + lock + cancel + confirm-mode + Implement variants + scaffold-re-home **only**. No
  SSE, no `/stream`, no UI/web, no `sync.py`/Dify I/O, no `selfhost`/`app_url`, no seed picker, no
  `--json-out`/`--group` tool edits, no SPEC.md `PUT`. Those are Lát 4/5.
- **Permission model C, verbatim:** every generating turn spawns with
  `claude -p --output-format stream-json --verbose --permission-mode acceptEdits --settings
  apps/builder/headless-settings.json --setting-sources local`, prompt via **stdin**. Do not
  re-derive or "improve" it.
- **Post-turn verify after EVERY generating turn** (reuse Lát 1's `post-turn.ts`): `yaml.safe_load`
  first (truncation) → re-run all 3 linters (exit 0) → regex `^\d{13}$` on node IDs → artifact
  non-empty; **confinement** = `git status --porcelain`, any path outside the whitelist
  `{projects/<slug>/, apps/builder/.runs/<taskId>/, .vscode/settings.json,
  projects/<slug>/.dify-workspace.yaml}` is **REVERTED** (`git checkout`/`clean`) → `status: error`.
  **Never trust `is_error` alone** (spike E5: tool failures don't fail the turn).
- **Phase = fresh turn (①–③) handed the prior artifact PATH; no cross-phase `--resume`. Phase ④ =
  backend (no turn).** `/reply` = `--resume <session_id>` **within** a phase only.
- **Backend-owned Dify I/O:** phases never run `sync.py`; the token never enters a turn. (Moot here —
  `deploy=none` — but keep the boundary.) Scaffold (`init_project.py`) is backend-run at the Spec gate.
- **Localhost only:** bind `127.0.0.1` hardcoded; one build at a time (409 on a 2nd `POST /api/tasks`).
- **Commit LOCAL only** after the slice's acceptance passes; do **not** push; do **not** `--no-verify`.
- Do not edit `.claude/skills/dify-build/*` (the phase engine) or the repo Python tools in this slice.

# Implementation Prompt — Spec 009, Lát 2: 4-phase chain (auto-advance, no gate)

> Copy-paste vào fresh session.

---

You are implementing **Lát 2 — 4-phase chain (auto-advance, no gate)** for the dify-projects repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST** (only the parts your slice touches):
  - [docs/specs/009-implementation-plan.md](../../009-implementation-plan.md) → the **"### Lát 2 — 4-PHASE CHAIN"** section (goal/scope/files/commands/acceptance/gotchas/spec-to-update) **plus** "Cross-cutting decisions", "Divergences", and the "Spec-update ledger" row for Lát 2.
  - [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md) → §A (turn-I/O table :469–490, endpoints, the §C phase table :609–614), §C templates, §D Confirm modes (context only — no gate yet), §I post-turn checks, Acceptance #2 / #3 / #5.
  - [docs/specs/009-spike-findings.md](../../009-spike-findings.md) → §1 canonical spawn invocation, §5 winning **model C** + the `headless-settings.json` content.
  - [.claude/skills/dify-build/SKILL.md](../../../../.claude/skills/dify-build/SKILL.md) + [analyze.md](../../../../.claude/skills/dify-build/analyze.md) + [spec.md](../../../../.claude/skills/dify-build/spec.md) + [implement.md](../../../../.claude/skills/dify-build/implement.md) + [test.md](../../../../.claude/skills/dify-build/test.md) — the four phase prompt bodies + the inject-var contract.

## Why this matters

Lát 1 proved one phase (③ Implement) can spawn, stream-parse, and post-turn-verify. Lát 2 turns that single shot into the **engine's backbone**: a sequential state machine that runs ①Analyze→②Spec→③Implement as three **fresh** turns (each handed only the prior artifact's *path*, no `--resume` across phases), then runs ④Test&Report **in the backend with no turn at all**, verifying after every generating turn and persisting each phase's `session_id` so Lát 3's `/reply` can resume it. This is the slice that makes "describe a workflow → get a validated `main.yml` + `report.json`" true end-to-end with one curl — still no human gate, every boundary auto-advances.

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                            # note the baseline; you commit only at the end
claude --version                                      # expect 2.1.156 (model-C spawn is version-sensitive)
ls .venv/bin/python tools/dify_base/find.py skills/mango-svip/scripts/generate_id.py   # repo tools exist (run ./scripts/setup.sh if .venv missing)
# Lát 1 artifacts MUST already exist — Lát 2 extends them, it does not recreate them:
ls apps/builder/headless-settings.json                # the model-C settings seed (copied in Lát 1)
ls apps/builder/package.json apps/builder/server/index.ts
ls apps/builder/server/lib/claude-session.ts apps/builder/server/lib/turn-runner.ts \
   apps/builder/server/lib/post-turn.ts apps/builder/server/lib/shell.ts
ls templates/patterns/                                # ② Spec's find.py picks one of these
```

If any Lát-1 file above is missing, STOP — Lát 2 depends on the Lát-1 skeleton (spawn shell, turn-runner, post-turn.ts, shell.ts). Do not scaffold them from scratch here.

## Mission

Build the phase state machine that auto-advances ①→②→③→④ for one task in `apps/builder/.runs/<taskId>/`, drives a **new-workflow** requirement (no seed) through all four phases, and ends with a validated `projects/<slug>/workflows/main.yml` + `apps/builder/.runs/<taskId>/report.json` — each artifact verified, confinement clean. **No** gate, **no** `/confirm`, **no** run-lock, **no** SSE, **no** UI, **no** Dify I/O (`deploy=none`). Phases ①–③ are claude turns; **Phase ④ is backend code, never a turn**.

Anchor every decision to the files above. Match the cross-cutting decisions exactly — do not invent a different spawn, a different artifact path, or a different verify.

## Tasks

### 1. `server/state/task.ts` — the per-task JSON state

Create `apps/builder/server/state/task.ts`. One task = one JSON file at `apps/builder/.runs/<taskId>/task.json`. Fields (per spec §A :491–493, extended for Lát 2):

```ts
type Phase = "analyze" | "spec" | "implement" | "test";
type Status = "running" | "awaiting_confirm" | "done" | "error" | "cancelled";
interface Task {
  taskId: string;            // 13-digit ms-timestamp string (use generate_id.py or Date.now())
  project: string | null;    // slug; null until Spec proposes one
  workflow: string | null;   // workflow name; null for new
  workflowFile: string;      // "main.yml" for a new workflow
  requirement: string;
  seedPath: string | null;   // null for the no-seed/new-workflow path (Lát 2's only path)
  deploy: "none";            // Lát 2 is none-only
  phase: Phase;
  status: Status;
  slug: string | null;       // == project once Spec proposes one
  name: string | null;
  sessionIds: { analyze?: string; spec?: string; implement?: string };  // PERSIST per-phase session_id
  artifacts: { analyze?: string; spec?: string; implement?: string; report?: string };
  error?: string;
}
```

Export: `createTask(input)` (mints `taskId`, writes the dir + `task.json`), `loadTask(taskId)`, `saveTask(task)` (atomic write — write a temp file then `rename`). **Persist `sessionIds[phase]` the moment a turn's init event yields a `session_id`** — Lát 3's `/reply` is a *separate request* that reads it back from `task.json`, not from a live variable. The `.runs/<taskId>/` dir is the canonical artifact home (`apps/builder/.runs/`, spec §A :517).

### 2. `server/lib/phases.ts` — the 4 phase definitions

Create `apps/builder/server/lib/phases.ts`. One definition per phase, in order. Each definition carries:

- `id`: `"analyze" | "spec" | "implement" | "test"`.
- `kind`: `"turn"` for ①②③, `"backend"` for ④.
- `promptFile`: the skill body path for turn phases — `.claude/skills/dify-build/{analyze,spec,implement,test}.md` (resolve relative to `DIFY_PROJECTS_DIR`). (④'s `test.md` is **not** sent as a turn; the backend reproduces its steps.)
- `artifactPath(task)`: where the authoritative artifact lands —
  - ① → `apps/builder/.runs/<taskId>/analyze.json`
  - ② → `apps/builder/.runs/<taskId>/SPEC.md` while `slug` is null, else `projects/<slug>/SPEC.md` (spec §A :477)
  - ③ → `projects/<slug>/workflows/<workflowFile>` (`main.yml`)
  - ④ → `apps/builder/.runs/<taskId>/report.json`
- the inject vars each phase needs (Task 3).

**Inject-var contract** (substitute these literal `{{...}}` tokens in the rendered prompt body — SKILL.md :42–51):

| Var | ① Analyze | ② Spec | ③ Implement |
|---|---|---|---|
| `{{TASK_ID}}` | taskId | taskId | taskId |
| `{{SLUG}}` | (empty) | (empty until ② proposes) | active slug |
| `{{WORKFLOW_FILE}}` | — | — | `main.yml` |
| `{{SEED_PATH}}` | `""` (no seed) | — | `""` |
| `{{REQUIREMENT}}` | requirement | requirement | — |
| `{{PRIOR_ARTIFACT}}` | — | `…/analyze.json` | **current `SPEC.md` path** |
| `{{DEPLOY}}` | — | `none` | — |

**③ Implement gets `{{PRIOR_ARTIFACT}}` = the *current* `SPEC.md` path** and the prompt body already tells it to **re-read it fresh** (implement.md :13–18; last-writer). Render = read the `.md` body, `.replaceAll("{{TASK_ID}}", …)` etc. for every var. Leave a var empty (`""`) rather than dropping the token.

### 3. `server/lib/orchestrator.ts` — run → verify → advance

Create `apps/builder/server/lib/orchestrator.ts`. Export `runTask(taskId)` that loops the phase list in order. For each phase:

**If `kind === "turn"` (①②③):**
1. Render the phase prompt (Task 2) and **spawn one fresh turn** via the Lát-1 turn-runner. Spawn contract (spike §1, NEVER vary it):
   - `cwd = DIFY_PROJECTS_DIR`, prompt fed on **STDIN** (not a `-p "text"` arg — a body starting with `#`/`-` must not be parsed as flags).
   - flags: `-p --output-format stream-json --verbose --permission-mode acceptEdits --settings apps/builder/headless-settings.json --setting-sources local`.
   - **No `--resume`** between phases — each phase is a brand-new session (spec Q3 / plan §f). `--resume` is reserved for in-phase `/reply` (Lát 3).
2. From the turn's stream: capture `session_id` off the `system`/`init` event → `saveTask` into `sessionIds[phase]` **immediately**; detect turn end off the terminal `result` event (`is_error`).
3. **Post-turn verify (call the Lát-1 `post-turn.ts`). NEVER trust `is_error` alone** (spike E5: a per-tool `is_error:true` does not fail the turn; `is_error:false` ≠ phase success):
   - **#3 correctness:** `yaml.safe_load` the artifact **first** (truncation/corruption) → then re-run all 3 linters `validate_workflow.py` / `lint_refs.py` / `lint_plugin_hashes.py` (all exit 0) → regex `^\d{13}$` on every node id → artifact exists + non-empty. (For ①/② the "linters + 13-digit" checks apply only to the YAML phase ③; for ①/② verify = artifact exists, non-empty, and `analyze.json` is valid JSON / `SPEC.md` non-empty.)
   - **#3b confinement:** `git -C $DIFY_PROJECTS_DIR status --porcelain` + an mtime scan of untracked files. Any path **outside** the whitelist `{ projects/<slug>/, apps/builder/.runs/<taskId>/, .vscode/settings.json, projects/<slug>/.dify-workspace.yaml }` is **REVERTED** (`git checkout -- <path>` if tracked, else `git clean -f <path>` / `rm`) and the turn → `status:error`. Detection alone is not enough — model C lets an opaque Bash write land *during* the turn (spike E2d), so #3b must undo it.
4. On verify failure → set `status:error`, write `task.error`, **stop the chain** (do not advance).

**② Spec — scaffold-on-advance (provisional, Lát 2 only):** when ② passes and the chain advances out of Spec, the **backend** (not a turn) scaffolds the new workflow:
```bash
.venv/bin/python tools/dify_base/init_project.py --non-interactive \
  --name "<name>" --slug <slug> --app-type workflow --primary-lang <lang>
```
- `--slug` **must equal the active task slug** (arg-validation; the slug ② proposed and you stored on the task). If ② did not propose a slug, derive `<name>`/`<slug>` from the requirement deterministically and store them before scaffolding.
- `init_project.py` has **no `--group`** flag — do not pass one (verified). `--primary-lang` ∈ `{en,ja,vi,zh,ja-en,vi-en,ja-vi}`; default `en`.
- Then **move** `apps/builder/.runs/<taskId>/SPEC.md → projects/<slug>/SPEC.md`. Make this **idempotent** (set `status: scaffolding` around it; if `projects/<slug>/SPEC.md` already exists, treat as done — re-running must not crash). Update `task.slug = task.project = slug` and `artifacts.spec` to the new path.
- `init_project.py` scaffolds an **empty** `workflows/` (only `.gitkeep`) and writes the repo-root `.vscode/settings.json` (best-effort side-effect) and `projects/<slug>/.dify-workspace.yaml` — **all three are in the #3b whitelist**, so they will not trip confinement. `main.yml` comes from ③, not the scaffold.
- ⚠ **Provisional:** in Lát 2 this fires on raw auto-advance. **Lát 3 re-homes it behind the `/confirm` that closes Spec** (so the user can edit slug/name at the gate, AC #18). Do **not** bake a contract here that Lát 3 must break — keep the scaffold call factored into a single helper (`scaffoldOnSpecAdvance(task)`) that Lát 3 can move.

**If `kind === "backend"` (④ Test&Report) — NO claude turn (Task 4).**

After each phase: persist the task, advance `phase` to the next, loop. After ④: `status: done`.

### 4. `server/lib/report.ts` — Phase ④ backend (no turn)

Create `apps/builder/server/lib/report.ts`. `runReport(task)` (called by the orchestrator for the `test` phase, `deploy=none`):
1. Re-run the 3 linters on `projects/<slug>/workflows/<workflowFile>` via the Lát-1 `shell.ts` (relative `.venv/bin/python …`, cwd = `DIFY_PROJECTS_DIR`); capture each exit code.
2. Write `apps/builder/.runs/<taskId>/report.json` (shape per `test.md` :36–44, but `deploy:"none"`):
   ```json
   { "workflow_file": "projects/<slug>/workflows/main.yml",
     "lint": { "validate": 0, "lint_refs": 0, "lint_plugin_hashes": 0 },
     "deploy": "none", "app_url": null, "duplicate_warning": null, "notes": "..." }
   ```
3. **Gate for ④ = `report.json` exists + non-empty** (there is no `result` event — ④ is backend, not a turn). Set `artifacts.report`. **Never** run `sync.py` here (`deploy=none`; Dify I/O is backend-owned and out of scope for Lát 2). Token never appears anywhere.

### 5. Dev endpoint to drive the full chain

Add a `POST /api/dev/run-chain` route (extend the Lát-1 Fastify server; localhost only — bind `127.0.0.1` hardcoded) that takes `{ requirement }` (new-workflow, no seed), calls `createTask` then `runTask(taskId)`, and returns the final task JSON. (This is the Lát-2 dev harness; the real `/api/tasks` + run-lock + gate land in Lát 3 — do not add the lock or `/confirm` here.) One build at a time is a Lát-3 concern; do not add the 409 yet.

### 6. Demo — one curl, full 4-phase build

Start the server, then run a single new-workflow build and confirm all four artifacts:

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects/apps/builder
npm run build && npm start &        # or npm run dev — bind 127.0.0.1
# in another shell:
curl -sXPOST 127.0.0.1:4123/api/dev/run-chain \
  -H 'content-type: application/json' \
  -d '{"requirement":"A workflow that takes a topic string and returns a 3-sentence summary."}' | tee /tmp/lat2-result.json
```

Then verify on disk (replace `<taskId>` / `<slug>` from the result):
```bash
cat apps/builder/.runs/<taskId>/analyze.json          # ① artifact, valid JSON, seed:null
ls  projects/<slug>/SPEC.md                            # ② moved here on advance
.venv/bin/python skills/mango-svip/scripts/validate_workflow.py projects/<slug>/workflows/main.yml   # exit 0
.venv/bin/python tools/dify_base/lint_refs.py                   projects/<slug>/workflows/main.yml   # exit 0
.venv/bin/python tools/dify_base/lint_plugin_hashes.py         projects/<slug>/workflows/main.yml   # exit 0
cat apps/builder/.runs/<taskId>/report.json           # ④ deploy:"none", lint all 0
git status --porcelain                                # only whitelisted paths (projects/<slug>/, apps/builder/, .vscode/settings.json)
```

### 7. Spec edit — apply the Lát-2 ledger row (repo forbids silent drift)

The Spec-update ledger (plan, Lát 2 row) requires reframing Phase ④ from a turn to backend in [docs/specs/009-browser-workflow-builder.md](../../009-browser-workflow-builder.md). Apply:

- **§A turn-I/O table (:479)** — the ④ row's gate currently reads `file exists + result event is_error:false`. Rewrite it so ④ is **backend, no turn**: gate = **`report.json` exists + non-empty** (there is no `result` event for ④). Make the ④ row consistent with §C :614 (which already says "backend (no claude turn) … gate = `report.json` exists+non-empty" and tags this as "the remaining Lát-2 reframe") — and **remove that "remaining Lát-2 reframe" parenthetical from §C :614** once §A matches, since the reframe is now done.
- **§C ① / ④ Tooling → "backend"** — confirm ① reads a backend-pulled local seed (turn never runs `sync.py`) and ④ is backend; `sync.py` is **not** in any turn allowlist (already excluded by the model-C settings — this is a wording edit, not a permission change).
- Keep the edit surgical and consistent; do not touch §D/§E permission wording (owned by Lát 0, already applied). If you discover §A and §C already agree post-edit, note it in the commit message rather than forcing a change.

## Acceptance

- [ ] **AC #2 (Analyze stops; ① half):** one `/api/dev/run-chain` runs ①Analyze first → writes `apps/builder/.runs/<taskId>/analyze.json` (valid JSON, `seed:null` for the no-seed path), turn ends, post-turn verify passes, chain advances. (Seed-picker UI is Lát 4/5 — this is the no-seed half.)
- [ ] **AC #3 (Spec writes + scaffolds + last-writer):** ②Spec writes `SPEC.md` to `apps/builder/.runs/<taskId>/` (pre-slug); on advance the backend scaffolds `projects/<slug>/` and **moves** `SPEC.md` into it (idempotent, `status: scaffolding`); ③Implement re-reads `projects/<slug>/SPEC.md` fresh so a manual edit would win (last-writer; the `/confirm`-time edit path is Lát 3/4).
- [ ] **AC #5 (Test & Report, `Deploy: none`):** ④ runs in the **backend** (no turn), validates `main.yml`, writes `report.json` with `deploy:"none"` + lint summary; no Dify contact, no token anywhere.
- [ ] **Implement (#4 layer):** ③ produces `projects/<slug>/workflows/main.yml` passing all 3 linters (exit 0), node IDs `^\d{13}$`.
- [ ] **Chain end-to-end:** the single curl walks ①→②→③→④ with **no gate/pause** (auto-advance); each artifact present + verified after its phase; `status: done`.
- [ ] **No cross-phase `--resume`:** each generating phase is a fresh session; `sessionIds.{analyze,spec,implement}` are persisted in `task.json` (proven by inspecting the file — Lát 3 reads them back).
- [ ] **Confinement clean:** `git status --porcelain` shows only whitelisted paths; a deliberately seeded out-of-confinement write (e.g. `touch tools/_lat2_probe.txt` mid-turn) is **reverted** and flips the phase to `status:error`.
- [ ] **Spec drift closed:** §A :479 + §C :614 reframed (④ = backend, gate = `report.json` exists+non-empty); the §C "remaining Lát-2 reframe" parenthetical removed.

## On blocker

- **A turn hangs / never emits `result`** → confirm `claude auth login` was done and the spawn uses **exactly** the spike §1 flags incl. `--setting-sources local` (a default spawn loads the repo's `permission-gate.js` hook, timeout 1860s — it will hang). Record the exact failing invocation; do not work around the spawn contract.
- **`init_project.py` rejects an arg** (`--group`, a bad `--primary-lang`, slug mismatch) → it has **no `--group`**; `--primary-lang` must be one of `{en,ja,vi,zh,ja-en,vi-en,ja-vi}`; `--slug` must equal the active task slug. Fix the call, do not add flags to the tool here (tool edits are Lát 5).
- **② proposed no slug** → derive `<name>`/`<slug>` deterministically from the requirement (lowercase `[a-z0-9_-]`), store on the task **before** scaffolding, then proceed. Do not block.
- **③ can't pass the linters in 5 passes** → that's the Lát-3 still-failing gate; in Lát 2 (no gate) record the last linter error in `task.error`, set `status:error`, stop the chain. Do not loop forever, do not auto-import.
- **A result contradicts the plan/spec** (e.g. ④ would need a turn, or scaffold must be atomic) → STOP, surface it in your final report; do not silently reshape the state machine.

## Guardrails

- **In scope:** the sequential auto-advance state machine (①②③ turns + ④ backend), per-phase prompt render + var inject, per-phase post-turn verify (#3 + #3b), persist per-phase `session_id`, scaffold-at-Spec (provisional), `report.json` (`deploy:none`), one dev curl. Extend the **Lát-1** `apps/builder/` — reuse its turn-runner / post-turn / shell, do not rewrite them.
- **Out of scope (do NOT build):** the gate / `awaiting_confirm` pause / `/confirm` / `/reply` / `/cancel`, the run-lock + 409, SSE, any UI, Dify I/O (`sync.py` list/pull/push), `deploy=selfhost`/`cloud`, the seed/Dify-app path (Lát 2 is no-seed/new-workflow only). These are Lát 3–5.
- **Permission MODEL C, unchanged:** every generating turn spawns with `--permission-mode acceptEdits --settings apps/builder/headless-settings.json --setting-sources local`, prompt via STDIN, `cwd = DIFY_PROJECTS_DIR`. Never `--dontAsk`, never `--allowedTools` fail-fast.
- **Backend-owned Dify I/O:** phases never run `sync.py`; in Lát 2 the backend doesn't either (`deploy=none`). The Dify token enters **nothing** — not a turn, not the SSE, not `.runs/`.
- **Phase = fresh turn (①–③), no cross-phase `--resume`; ④ = backend (no turn).** `/reply`'s in-phase resume is Lát 3 and reads the persisted `session_id`.
- **Localhost only:** bind `127.0.0.1` hardcoded. Commands are the relative `.venv/bin/python tools/…` form, cwd = `DIFY_PROJECTS_DIR`, byte-identical to the skill prompts.
- **Commit LOCAL only** after the slice's acceptance passes (the curl produces `main.yml` + `report.json`, all verified, confinement clean, and the §A/§C spec edits are applied). Do **not** push; do **not** `--no-verify`. If on `main`, branch first.

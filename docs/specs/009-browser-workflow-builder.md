# Spec 009 — Dify Workflow Builder App (conversational, phased, human-gated)

**Status**: Done — merged (builder Lát 0–6); residual R10 live-run verification tracked in spec 011. (2026-06-08, iterated — now a **dedicated app**, not a nexus
config and not a one-shot wrapper; **revised 2026-06-09** after a grounded
technical review — contract fixes (`main.yml` filename, `project.group` key,
mandatory headless `--yes`, `generate_id.py` in the allowlist), plus new
Error-handling, Security, and slug-derivation sections. The review's blockers
are **resolved in-design**: slug/name in §Data model; Q1/Q5/Q6 marked RESOLVED
below. Q2 (frontend stack) is now **RESOLVED → Preact + Vite + TS** (build, reuse
nexus client). **Remaining open questions are non-blocking defaults to confirm in
Nhịp 1**: Q3 (within-phase resume), Q4 (SPEC.md edit), Q7 (multi-pattern).
**Revised 2026-06-10** — review resolutions grounded against the repo + claude-nexus;
see **Design → Revision 2026-06-10** for the full list (security model corrected to
path-scoped permission rules with **no custom hook**; backend recovery/gate/seed-routing
fixes; 4 product decisions locked).)
**Effort**: L — ~2–3 days Nhịp 1 (validate the procedure on stock claude-nexus)
+ ~3–4 weeks Nhịp 2 (build the app; revised up from 2–3 after the review found
the phase state machine + gate are net-new, not copied, and error-handling was
unbudgeted). No repo migration (flat layout kept).
**Depends on**: 003 (variable-ref linter), 007 (capability docs + patterns),
008 (shares the 5 pattern templates + the `/apps/imports` contract).
**Prior art (copied from, not depended on)**:
[claude-nexus](/Users/quyenbt/Desktop/MyProjects/claude-nexus) — its
spawn-`claude`-CLI shell + stream-json parsing and SSE relay. (The nexus
**gate-token** mechanism does **not** transfer — 009 gates out-of-band via
`POST /confirm`, not an in-band token; see References. The per-phase **state
machine + gate are net-new**, not copied.)

> A small, **purpose-built app for Dify projects** — a simpler, Dify-only
> sibling of claude-nexus. The user opens a chat, optionally seeds it with an
> **existing Dify workflow**, and Claude walks through
> **Analyze → Spec → Implement → Test & Report**, **stopping at every phase for
> the user to review and confirm** before continuing. It runs the user's own
> Claude (their subscription, no API key) and imports into their own Dify, using
> the existing `dify-projects` tooling and conventions as its backbone.

## Context

### What this is, and how the design got here

This spec went through three framings as the vision sharpened:

1. **Dify-builds-Dify** (Spec 008) — generation logic inside a Dify workflow.
   Rejected as the engine for this product (sandbox limits Q6, template-sync
   debt, weak planner).
2. **One-shot web wrapper** — a thin server that spawned a single
   `claude -p "build it"` and returned a finished app. Rejected: the user wants a
   **step-by-step, human-confirmed** flow, not one shot.
3. **This spec — a dedicated, simpler-than-nexus app for Dify** (chosen
   2026-06-08). A conversational, phased builder that *embodies the
   `dify-projects` development logic* (Analyze→Spec→Implement→Test, the
   [AGENTS.md](../../AGENTS.md) conventions, the repo tooling) as its backbone.

### Why a dedicated app, not "configure claude-nexus"

claude-nexus is a **generic** dev orchestrator. We could run it as-is and add a
Dify config layer, but that means: users install the entire heavyweight nexus
(issue graphs, compliance, worktrees, audit, multi-project) and operate it
through a generic dev dashboard — poor UX for "anyone with Dify should be able to
use this". More importantly, nexus's **per-phase pause is a stub** (issue #079):
it cannot reliably stop-and-confirm at *every* phase, which is the core
requirement here.

A dedicated app fixes both:

- **Dify-shaped UX** — only the 4 phases, a Project▸Workflow▸Task sidebar, a DSL
  diff viewer, inline confirm buttons. None of nexus's unrelated surface.
- **Structurally-guaranteed gating** — because *our* orchestrator runs **one
  bounded Claude turn per phase** and decides when to issue the next turn, the
  stop-and-confirm gate is enforced by the app itself — not by a soft prompt
  instruction, not by nexus's unfinished mode. This is the decisive technical
  reason the dedicated app beats the nexus-config approach.

We still **lean on nexus heavily** — by copying its proven, hard-won pieces
(the spawn-`claude`-CLI shell, the `stream-json` parser, the SSE relay) rather
than reinventing them. We do **not** copy the gate-token validator (different
problem), and the **phase state machine + gate are built fresh** (nexus has no
reusable per-phase gate — that is exactly #079). nexus is prior art and a
validation harness (Nhịp 1), not a runtime dependency of the shipped app.

### Auth & distribution (unchanged, the core value prop)

The app spawns the **local `claude` CLI**, which uses the user's existing
`claude auth login` — their **subscription**, **no `ANTHROPIC_API_KEY`, no
per-call billing**. (The Claude **Agent SDK** was evaluated and rejected: it
requires an API key and cannot use subscription login.) Distribution: ship the
app as source in this repo (`apps/builder/`); each user runs it locally next to
their `dify-projects` checkout, with their own Claude + their own Dify.

## Goals

1. **Conversational + phased** — a chat-driven flow through
   Analyze → Spec → Implement → Test & Report.
2. **Human gate at every phase, enforced by the app** — each phase is one
   bounded Claude turn; the app stops, shows the result, and issues the next
   phase **only after the user clicks confirm**. The user can request changes
   (another turn) at any boundary.
3. **Seed from an existing workflow** — analyze an existing Dify app, then build
   a new/modified workflow derived from it.
4. **Embody the repo's dev logic** — phases call the existing tooling
   (`sync.py`, `find.py`, `init_project.py`, the validators) and follow
   [AGENTS.md](../../AGENTS.md) conventions; the app does not re-implement them.
5. **Simpler than nexus** — only what a Dify build needs: a Project▸Workflow▸Task
   sidebar, chat with inline gate buttons, a slim phase indicator, artifact/diff
   viewer, import. No DB-heavy machinery, no unrelated tabs.
6. **User's own Claude + own Dify** — subscription auth, local, no API key, no
   shared server.
7. **Validation guarantee** — generated/edited YAML passes the same linters as
   hand-authored workflows before import (same bar as 008).

## Non-goals

1. **Autonomous as the _default_** — the default is `confirm each step`. An
   `auto` (autonomous) Confirm mode exists as an opt-in, but the product is
   built around stop-and-confirm; `auto` is not the out-of-box behavior.
2. **A general orchestrator** — this is Dify-only; it is not a nexus replacement.
3. **Multi-tenant / hosted SaaS** — each user runs their own local instance.
4. **Anthropic-API / Agent-SDK engine** — CLI spawn only (subscription auth).
5. **Complex workflows (>15 nodes)** — same ceiling as 008 Non-goal 1.
6. **Cloud Dify full automation** — Cloud CSRF blocks login-based import (008 Q3);
   Cloud falls back to "produce YAML for manual Studio import".
7. **Persisting full build history / audit** — v1 keeps just enough per-build
   state to resume a session; no analytics DB.
8. **In-place update of an existing Dify app** — `sync.py push` always *imports a
   new* app (no update endpoint, §A). An edit-existing task with
   `deploy=selfhost` therefore creates a second app; updating-in-place is out of
   scope for v1 (the report warns; user replaces the old app via the Dify UI).

## Design

### Revision 2026-06-10 — review resolutions

A grounded review (every load-bearing claim verified against the actual repo tooling
and the claude-nexus source) resolved the items below. **These resolutions are now
integrated into their home sections** (§A, §B, §C, §D, §E, §G, §I, §J, Endpoints,
Acceptance, Data model); this block remains as the dated **2026-06-10 changelog +
decisions log** — a consolidated record of what changed and where it now lives, not a
forward-pointing override.

#### Security / permissions (supersedes §E, §J)

- **DECISION — Lát 0 spike chose model C (corrected): broad-allow `acceptEdits` + a
  dialect-fixed deny carve-out, with the #3b post-turn confinement check as the REAL
  boundary.** (Candidates: A = original `--allowedTools` fail-fast; B = `dontAsk`
  path-scoped; C = broad-allow + deny.) Spike evidence (`009-spike-findings.md`): with
  broad `Bash`, the deny blocks the `Write`/`Edit` tools AND naive shell redirects
  (`> tools/x`, statically parsed — E2b), but an **opaque** subprocess write
  (`python3 -c open().write()`) **escapes** (E2d); model B is airtight only by betting on
  byte-exact `dontAsk` commands — too brittle for a multi-command authoring agent. The
  conservative reading wins → C + a strict #3b.
- **The hard boundary is #3b, and it must REVERT, not just flag.** After every turn the
  backend runs `git status --porcelain` (+ untracked mtime scan); any path outside the
  whitelist — `projects/<slug>/`, `apps/builder/.runs/<taskId>/`, plus the known
  `init_project.py` side-effects (`.vscode/settings.json`,
  `projects/<slug>/.dify-workspace.yaml`) — is **reverted** (`git checkout` / `clean`) and
  the turn → `status:error`. Detection alone is insufficient: model C lets an opaque Bash
  write LAND during the turn (E2d), which the deny-list cannot catch. This replaces the
  earlier "confinement via `dontAsk` path rules" framing (and the H1 gap).
- **Permission layer = defense-in-depth (NOT the boundary).** `--permission-mode acceptEdits`
  + a deny carve-out (dialect-fixed, **no leading slash**): `Read(~/.ssh/**)`,
  `Read(~/.aws/**)`, `Read(~/.claude/**)`; `Write`/`Edit` on `tools/**`, `skills/**`,
  `.venv/**`, `.git/**`, `.claude/**`; `Read(projects/*/envs/*.env)`; `Bash(sudo:*)`,
  `Bash(rm -rf /)`, `Bash(rm -rf ~)`; plus `//etc`/`//usr`/`//bin`/`//System` absolute
  denies. This stops the `Write`/`Edit` tools and naive Bash redirects; it does **not** stop
  opaque subprocess writes (→ #3b). Optionally graft model B's per-spawn path-scoped
  `Write/Edit(projects/<slug>/**)` allow for extra blast-radius reduction — it does not
  replace #3b.
- **Dialect (spike E0, BLOCKING):** repo-relative patterns take **NO leading slash**
  (gitignore-style); `Write(/tools/**)` is a silent no-op. `//` = absolute, `~` = home
  (both **untested** — verify in Lát 1). Path-scoped rules are honoured in BOTH
  `settings.json` and the bare `--allowedTools`/`--disallowedTools` CLI flags (E6); we ship
  a `--settings` file for `defaultMode` + readability.
- **Host + project isolation = `--setting-sources local` (spike E4 + §2 of findings).** A
  default nested spawn loads BOTH the host `~/.claude` layer AND the repo's **project**
  `.claude/settings.json` — which injects a `permission-gate.js` `PreToolUse` hook (timeout
  1860s, can hang a turn). Spawn with `--setting-sources local` so only the candidate
  `--settings` file is authoritative (caveat: assumes no untrusted
  `.claude/settings.local.json`). The brief anticipated only the host leak; the
  project-layer hook is a spike-surfaced isolation target.
- **Bash-tool writes are NOT fully covered by file rules (H2) — refined by E2.** A naive
  shell redirect to a denied path (`> tools/x`) IS caught (E2b); only an **opaque**
  subprocess write (`python -c`, etc.) escapes (E2d) — exactly why #3b is load-bearing.
  Mitigation still applies: the backend **validates tool arguments** (`--slug`/`--project`
  MUST equal the active slug) on the pinned scripts.
- **Command-match is NOT permission-load-bearing under model C** (broad `Bash` allows
  command variants — the old model-B `dontAsk` near-miss auto-deny is gone, a reason C is
  less brittle). The phase prompt templates still mandate the **exact literal**
  `.venv/bin/python tools/…` command for **correctness/predictability**, not permission.
- **Secret redaction:** `Read(projects/*/envs/*.env)` is denied; an SSE/`.runs` scrubber
  strips known secret patterns; confirm `sync.py` errors don't echo the `Authorization`
  header; `Deploy=none` loads no token; the token never enters a turn (backend-owned Dify I/O).
- **Bind host:** hardcode `127.0.0.1` (not env-overridable; only `BUILDER_PORT` is
  configurable) + an Origin/same-origin check on the mutating POST endpoints.

#### Backend correctness (supersedes §A, §C, §I)

- **Implement retry never re-seeds a half-written `main.yml` (H8).**
  `validate_workflow.py` only exits **0/1** (exit 2 lives only in `lint_refs.py` /
  `lint_plugin_hashes.py`), so the old "exit 2 → regenerate" heuristic never fires for
  a truncated file. New rule: **every Phase-③ retry re-instantiates from
  `pattern + SPEC.md`** (or a pre-turn snapshot of `main.yml`); the exit-code
  distinction is dropped as load-bearing.
- **No duplicate app on restart (④ idempotency).** Write a `push_intent` marker to
  `.runs/<taskId>/` **before** calling `sync.py push`. Recovery: if `push_intent`
  exists without a confirmed `app_id`, **do NOT re-push** — reconcile via `sync.py
  list` or surface "push may have completed — check Dify". The guard keys off the
  pre-push marker, not the post-push `report.json`.
- **`workflowFile` added to task state.** State shape becomes `{taskId, project,
  workflow, workflowFile, phase, status, sessionId, seedRef, gate}`. New workflow →
  `main.yml`; edit-existing → the selected `*.yml`; dify-seed → the pulled
  `<app-name-slug>.yml` coexists with a produced `main.yml`. Phase-④ push uses
  `--file workflows/<workflowFile>` (NOT a hardcoded `main.yml`).
- **Stream-json event contract pinned in Nhịp 1.** The copied `claude-session.ts` is
  pure transport (it captures neither turn-end nor `session_id`). Add a §A subsection
  naming the event `type` for the init event (carries `session_id`), the terminal
  `result` event (`is_error`), and error subtypes — a **required Nhịp-1 deliverable**;
  pin the `claude` CLI version alongside `.dify-tag`.
- **`diff vs seed` baseline per case:** no-seed → an **empty base** (the whole produced
  `main.yml` renders as additions — the auto-selected pattern is chosen *inside* the
  Implement turn and is agent-internal prose in `SPEC.md`, not a tracked field, so a
  pattern-template base is not produced; a true pattern-delta is a Phase-3+ enhancement);
  edit-existing → a pre-edit snapshot of the selected file; dify-seed → the pulled
  file. A backend-computed patch (NOT `sync.py diff`, which compares by remote app
  name).

#### Gating / auto mode (supersedes §D)

- **Two Implement gate variants:** *clean* (lint exit 0 → actions `[Continue to Test /
  Request changes]`, `auto` may advance) vs *still-failing* (cap-5 reached, lint≠0 →
  actions `[Accept anyway / Keep trying / Abandon]`, flagged "still failing").
  **`auto` MUST hard-stop at a still-failing gate** and must not import a lint≠0
  workflow.
- **DECISION — `auto` + `selfhost` + edit-existing (duplicate app):** the run is
  **allowed**, but the Phase-④ report MUST surface a prominent "created a NEW app
  (duplicate)" warning. (We do **not** refuse the combination.)

#### Concurrency / lifecycle (supersedes §I, Endpoints)

- **Cancel endpoint + lock release.** Add `POST /api/tasks/:id/cancel` (kills the
  child, sets a terminal status, **releases the run-lock**). The run-lock releases on
  `done | error | cancelled`; on boot it is cleared and any `running` task → `error`.
  Note orphaned-child reconciliation as a Week-4 concern.
- **Turn timeout is per-turn**, and Phase ③'s 5-pass loop runs within one turn under
  that budget; a timeout mid-loop is `error` (re-runnable, regenerate-from-scratch),
  **distinct** from the still-failing gate. Timeout is per-phase-configurable.

#### Frontend model (supersedes §B, Data model)

- **DECISION — Workflow node = the folder; editing picks a file.** A Workflow tree
  node maps to `projects/<slug>/`; choosing "edit existing" expands/offers a file
  selector over the folder's `*.yml` (default `main.yml`), persisted as `workflowFile`.
  (A folder genuinely holds several files — e.g. `eiken_stem_proofread/workflows/` has
  5.)
- **DECISION — Ungrouped = each slug is its own Project row.** Absent `group` defaults
  to the slug, so the tree is always structurally 3-level and every Project row has a
  hover "+".
- **Phase indicator is SSE-driven** (not nexus's poll-based `PipelineTimeline`); it
  reads the same `phase/status` SSE events — a data-source rewrite, re-budgeted in
  Week 3.
- **DECISION — SSE reconnect (v1): restore the gate only.** On drop, re-fetch
  `GET /api/tasks/:id` for phase/status/gate; streamed output produced *during* the
  disconnect is **not** backfilled in v1 (documented gap — artifacts/files are the
  source of truth).
- **`settings-below-input` is net-new UI** (nexus's run settings live in a modal;
  `ChatInputBar` exposes only a `topSlot`) — re-budgeted, not a light copy.

#### New-workflow / seed routing (supersedes §A Endpoints, §G)

- **`seed` schema:** `null | {kind:"dify_app", app_id, name} | {kind:"local",
  project, file}`.
- **Routing at `POST /api/tasks`:** existing workflow → edit-existing (no scaffold);
  `none` + (null | `local`) → **no-slug path** (Spec proposes slug, scaffold on the
  Spec-gate confirm); `none` + `dify_app` → slug/name **REQUIRED up-front**, scaffold
  **before** Phase ① (because `sync.py pull` requires `projects/<slug>/` to pre-exist).

#### Cleanups

- `.claude/skills/dify-build/` ✅ **now authored** (Lát 0.5): `SKILL.md` +
  `analyze.md`/`spec.md`/`implement.md`/`test.md` — the shared engine the backend reads phase
  prompts from. (Prompts mandate `generate_id.py`, treat seeds as data, and **never run
  `sync.py`** — Dify I/O is backend-owned.)
- `sync.py` line refs: `import_app()` is called at `sync.py:314` (the POST to
  `/apps/imports` is inside `import_app` at `sync.py:141`) — reference by function name,
  not the brittle line number.
- `init_project.py` scaffolds `workflows/.gitkeep` (not a truly empty dir) — emptiness
  checks must ignore `.gitkeep`.
- Define the `gate.actions` item schema: `{id, label, kind, route}`.
- SPEC.md in-place edit: add `PUT /api/tasks/:id/spec`, an explicit Save, and a
  last-writer policy (Implement re-reads `SPEC.md` at phase start, so a manual edit
  wins).

### How it works (operation walkthrough — the implemented flow)

```
  Browser (the Builder app UI — 3 regions)
  ┌─ Sidebar ───────────┐┌─ Chat pane ─────────────────────────────────┐
  │ 📁 eiken        [+] ││  📁 eiken                  (new task: project only)│
  │  ▸ stem_proofread   ││  ┌────────────────────────────────────────┐ │
  │     • Build         ││  │ describe the workflow / change…         │ │ chat
  │     • Add JP        ││  └────────────────────────────────────────┘ │ input
  │  ▸ vocab_quiz       ││  + │Workflow:none▾│Confirm:each step▾│Deploy:none▾│ ← settings
  │ 📁 mitsui_chem  [+] ││  ──────────────────────────────────────────│   (no Model)
  │  ▸ rag_helpdesk     ││  🤖 [① Analyze] … inline gate buttons …      │
  └─────────────────────┘└──────────────────────────────────────────────┘
   ▲ eiken = virtual label; stem_proofread = folder in projects/   hover→[+]    Artifact ▸
        │ POST /api/tasks {project, workflow?, requirement, seed?, confirm_mode?, deploy?}
        ▼
  Builder backend  ── spawns ONE bounded `claude` turn per phase ──┐
        │  (cwd = dify-projects, user's CLI auth, acceptEdits + deny carve-out, --setting-sources local)
        ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │ ① ANALYZE   sync.py pull (or read seed) → summarize X             │
  │             → app marks build "awaiting confirm @ Analyze", STOPS │
  │  user: reviews; may reply "add a JP-translation step"; clicks ✔   │
  ├──────────────────────────────────────────────────────────────────┤
  │ ② SPEC      draft SPEC.md staged in .runs/, moved on confirm     │
  │             → "awaiting confirm @ Spec", STOPS                    │
  │  user: reviews/edits SPEC.md or asks changes (multi-turn); ✔      │
  ├──────────────────────────────────────────────────────────────────┤
  │ ③ IMPLEMENT instantiate/edit <workflowFile> (main.yml if new);     │
  │             validate→fix loop (cap 5); clean vs still-failing gate │
  │             → show YAML + lint results + diff vs X; STOPS         │
  │  user: ✔  (auto hard-stops if still-failing; §D)                  │
  ├──────────────────────────────────────────────────────────────────┤
  │ ④ TEST&REPORT  deploy=none (default): validate + write main.yml    │
  │             selfhost: sync.py push → import; cloud: YAML+Studio    │
  │             → report: path/app_url, lint, diff (+dup-app warn). DONE│
  └──────────────────────────────────────────────────────────────────┘
        │ (only if deploy≠none) POST /console/api/apps/imports via sync.py push
        ▼
  User's Dify  ── new app appears, clickable from the report

  Walkthrough shows the default `confirm each step` mode: the app never issues
  phase N+1 until the user confirms phase N. (`confirm at spec only` / `auto`
  modes auto-advance some/all boundaries — §D.)
```

### Data model & hierarchy (3-level *view*, flat on disk)

The app presents **Project → Workflow → Task**, but this is a **display grouping
only — the on-disk layout stays flat and unchanged** (decision 2026-06-08, per
the "app is an optional layer" principle — §Integration):

| Level | Meaning | Maps to (repo) |
|---|---|---|
| **Project** | A **virtual** client/domain grouping (e.g. "Eiken") | a `project.group` **sub-key** inside the existing `project:` mapping in the folder's `.dify-workspace.yaml` — **no folder for it** |
| **Workflow** | One Dify workflow (e.g. `stem_proofread`) | `projects/<slug>/` (flat, exactly as today: its `workflows/`, `SPEC.md`, `envs/`) |
| **Task** | One build/edit conversation on a workflow (initial build, "add JP step", "fix top_k"…) — a 4-phase run | a per-task JSON state file under `apps/builder/.runs/` |

> **⚠ Terminology — "project" is overloaded (clarified 2026-06-10).** The word means
> two different things, which is a common point of confusion:
> 1. **repo / tooling "project"** = a `projects/<slug>/` folder = the storage for **one
>    Workflow**. This is what `sync.py --project <slug>` and `init_project.py` operate
>    on. A folder may hold several `*.yml`, but they are **variants of the *same*
>    workflow** (e.g. `main.yml`, `main_v2.yml`, `test_*.yml`), picked via `workflowFile`
>    when editing — not separate workflows.
> 2. **sidebar "Project" (top level)** = a **real-world project / client** grouping
>    (e.g. "Eiken"), derived purely from the optional `project.group` sub-key. It has
>    **no folder**.
>
> So a **real-world project = several `projects/<slug>/` folders that share the same
> `group`** (DECISION 2026-06-10, confirmed). The `projects/` directory name is
> therefore misleading: its sub-folders are *Workflows* in the UI, not real-world
> projects. Display: the Workflow label may strip the group/slug prefix or use
> `project.name`; the app may write `group` on first task so the user need not hand-edit
> `.dify-workspace.yaml`.

**No migration, no tooling churn.** Disk stays `projects/<slug>/` — so
`init_project.py`, `sync.py`, `build_index.py` globs, pre-commit regexes, CI, and
every standalone CLI/AI workflow keep working untouched. The app derives the
**Project** grouping at read time:

- It reads an **optional `project.group` sub-key** *inside* the existing
  `project:` mapping in each `projects/<slug>/.dify-workspace.yaml`, e.g.

  ```yaml
  project:
    name: "Eiken Stem Proofread"
    slug: "eiken_stem_proofread"
    dsl_version: "0.6.0"
    group: "Eiken"          # ← NEW: the app's virtual grouping label
  ```

  **Do NOT add a top-level scalar `project:`.** `project:` is already a *mapping*
  that [`scripts/check_dsl_version.sh:39`](../../scripts/check_dsl_version.sh)
  and [`scripts/regen_vscode_settings.py:54`](../../scripts/regen_vscode_settings.py)
  read as `(data.get("project") or {}).get("dsl_version")`; a **truthy scalar**
  bypasses the `or {}` guard, so `.get` is then called on a `str` →
  `AttributeError` and **breaks the pre-commit DSL gate**. A sibling `group`
  sub-key is ignored by both tools.
  Graceful default: if `group` is absent, the workflow shows ungrouped / under
  its own slug. Sidebar groups folders sharing the same `group` under one Project.
- A new workflow created via the app derives a `slug` + human `name` in the Spec
  phase (see below), calls `init_project.py --non-interactive --name <name>
  --slug <slug> --app-type workflow --primary-lang <lang>` to make a flat
  `projects/<slug>/`, and writes the chosen `group` into its `project:` mapping.

**Slug/name derivation (new workflow).** `/api/tasks` may omit `slug`/`name`. In
that case the **Spec phase (②) proposes both** from the requirement (slug =
sanitized snake_case) and writes the draft to `apps/builder/.runs/<taskId>/SPEC.md`
(the slug folder does not exist yet). The user can override slug+name at the Spec
gate; **on confirm**, the backend (a) runs `init_project.py --non-interactive` to
scaffold `projects/<slug>/`, then (b) **moves** the staged `SPEC.md` into it. So
the **scaffold happens at the moment the slug is accepted (the Spec gate), not
"before Implement" loosely** — and the ② gate-check path is `.runs/<taskId>/SPEC.md`
pre-scaffold, `projects/<slug>/SPEC.md` after (§A). From Phase ③ on, the slug
folder exists and `projects/<slug>/workflows/main.yml` is the target. This removes
both the "paths reference a slug nobody supplied" gap and the "gate a file that
can't exist yet" gap. (Edit-existing / slug-supplied tasks skip staging — they
write straight to `projects/<slug>/`.)

This keeps the 3-level UX **without** forcing the repo's standalone layout to
nest — the grouping is the app's concern, not the filesystem's.

**Sidebar = a view of `projects/`.** Top-level entries are exactly the folders
under `projects/`. Hovering a project shows **only a "+" (New task)** button — no
gear/settings.

**One creation action: "+" on a Project → New task.** It opens the chat pane
showing just the project name; the **Workflow is chosen in the task settings**
(below the input). The `Workflow` selector **defaults to `none` (unselected)**
and **lazily lists the project's workflows only when opened**:
- left `none` → the task creates a **new** workflow in that project.
- an existing workflow → the task **fixes/extends** it (its current `main.yml` is
  the base), and the settings **prefill what's already known** about it (pattern,
  last deploy). This is the "edit an existing workflow" case.

Reopening an **already-run task** shows its stored settings/info (workflow,
confirm mode, deploy) rather than defaults. There is no separate per-level "+":
whether a task makes a new workflow or edits one is just the Workflow setting.

**Breadcrumb is static, not auto-updated.** A new task shows only the project
(e.g. `eiken`). Once a task has a chosen workflow + an auto-derived title, those
are **stored** and shown when the task is reopened — there is no live breadcrumb
updating during a run.

Tasks (conversations) are app state, not committed repo artifacts; only the
workflow's `SPEC.md` + `main.yml` are versioned files.

### A. Backend — `apps/builder/server` (thin, no DB)

Node + Fastify. Responsibilities:

- **Spawn one `claude` CLI turn per phase** with `--output-format stream-json`
  `--verbose` (verbose is required for stream-json), the prompt fed on **stdin**
  (no `-p` text arg needed for a non-interactive stream-json run), `cwd` = the
  `dify-projects` checkout, and the **model-C** permission config
  `--permission-mode acceptEdits --settings apps/builder/headless-settings.json
  --setting-sources local` (see §Permission / §Revision; spike-verified). Parse
  `stream-json` line-by-line (NDJSON; buffer partial lines)
  — the `claude-session.ts` spawn shell is **transport only** (~40 lines, near
  self-contained bar its logger): copy the spawn + line-buffer logic, **drop**
  nexus-specific env (`SWARM_*`/`NEXUS_*`), MCP config and multimodal handling,
  and **re-implement turn-end detection + `session_id` capture yourself**. The
  per-task spawn orchestration in nexus's `task-spawning.ts` is a **reference,
  not a copy target**.
- **Invoke repo Python tools via the venv created by `scripts/setup.sh`** (a
  documented prerequisite, see §F). The backend never `pip install`s; it shells
  the existing CLIs. **Spawn with `cwd = DIFY_PROJECTS_DIR` and invoke as the
  relative `.venv/bin/python tools/…`** for **correctness/predictability** (and so
  any optional per-spawn path-allow rule matches). Under model C's broad `Bash`
  allow, a non-byte-exact prefix does **not** fail the turn (acceptEdits permits it),
  but keeping the canonical relative form is mandated by the phase prompts and avoids
  surprising diffs.
- **Canonical workflow filename = `main.yml`** (a backend constant
  `WORKFLOW_FILENAME`, matching [AGENTS.md](../../AGENTS.md) §3 — `init_project.py`
  scaffolds an *empty* `workflows/`, so Phase ③ creates `workflows/main.yml`).
  For an **edit-existing** task, the filename is the selected workflow's existing
  file (a folder may hold several `*.yml`; the task settings carry which one).
- **Multi-turn within a phase** via `--resume <session_id>` (the Claude session
  id captured from the first turn), so "ask for a change" continues context.
- **Turn I/O contract** — the backend detects **turn end** via the terminal
  `stream-json` `result` event (and reads `session_id` from the init event). It
  does **not** parse Claude's prose for results. Every phase has a
  **machine-readable artifact** the backend inspects for the gate — and the two
  prose-y phases get an explicit file so the gate is never prose-dependent:
  | Phase | Authoritative artifact | Gate check |
  |---|---|---|
  | ① Analyze | `.runs/<taskId>/analyze.json` (the turn writes it) | file exists + `result` event `is_error:false` |
  | ② Spec | `.runs/<taskId>/SPEC.md` (no-slug task, **pre-scaffold**) **or** `projects/<slug>/SPEC.md` (slug known) | file exists + non-empty |
  | ③ Implement | `projects/<slug>/workflows/<workflowFile>` (`main.yml` for a new workflow; the selected `*.yml` for edit-existing) | backend **re-runs the linters itself**; **clean** = all exit 0 → clean gate, else **still-failing** gate after cap 5 (§D) |
  | ④ Test&Report | `.runs/<taskId>/report.json` (path/app_url/lint summary) — **backend synthesizes it** from facts it owns (file path, lint exit codes, push `app_id`), not transcribed by Claude | **backend, no claude turn** → gate = `report.json` **exists + non-empty** (there is no `result` event for ④) |
  Files + exit codes are the source of truth; the chat stream is only for live
  visibility. For a phase with no source file, "turn success" = the terminal
  `result` event with `is_error:false` (matching the prior-art parser, §References)
  plus the convention artifact above. **Path note (no-slug new workflow):** the
  slug folder does **not** exist until `init_project.py` runs **on the Spec-gate
  confirm**, so the ② gate checks `.runs/<taskId>/SPEC.md`; on confirm the backend
  scaffolds `projects/<slug>/` and **moves** `SPEC.md` into it (see §Data model).
  (The phase prompt templates, §C, instruct the turn to write `analyze.json` and
  the staged `SPEC.md`; `report.json` is backend-synthesized.) The `.runs/` JSON
  shapes are finalized in Nhịp 1 (§Testing) — the gate only checks existence +
  the `result` event, so a sample/example block per file is enough at spec stage.
- **Phase state machine** — each **task** owns `{taskId, project, workflow, workflowFile,
  phase, status: running|awaiting_confirm|done|error|cancelled, sessionId, seedRef,
  gate: {actions:[{id,label,kind,route}]}}` (`workflowFile` + the gate-action item
  schema added in §Revision 2026-06-10). When a phase turn ends, status → `awaiting_confirm` and
  the backend emits the **gate actions** (the inline buttons, §B/§D); the next
  phase's prompt is sent **only on an explicit confirm**. This is the gate.
- **SSE relay** — `GET /api/tasks/:id/stream` forwards Claude output +
  phase/status/gate changes to the browser. **Adapt** nexus's SSE pattern
  (`sse.ts` is coupled to nexus's Container/auth/RingBuffer — lift the relay +
  backpressure/RingBuffer, drop the nexus wiring). **Reconnect**: the stream is
  best-effort live visibility, not the source of truth — on a dropped connection
  the UI re-opens `/stream` and re-fetches `GET /api/tasks/:id` to restore the
  authoritative phase/status/gate (no event-offset replay needed in v1).
- **Import** — only when `deploy ≠ none`: Phase ④ calls
  `sync.py push --project <slug> --file workflows/<workflowFile> --yes` (selfhost) or
  returns YAML (cloud). `workflowFile` = `main.yml` for a new workflow, the selected
  `*.yml` for edit-existing (**not** a hardcoded `main.yml`). **`--yes` is mandatory**:
  `sync.py push` prompts on stdin (in `cmd_push`) and a headless turn would hang without
  it (this is the acceptance-#10 "never blocks" guarantee). **`sync.py push` always
  creates a NEW Dify app** (no in-place update — `import_app()` POSTs `/apps/imports`);
  so an *edit-existing* task with `deploy=selfhost` produces a **second app** in Dify.
  The Phase ④ report must surface a prominent "created a NEW app (duplicate)" warning
  for that case, and in-place update is a **Non-goal** (§Non-goals).
  The import keeps an explicit confirm button (touches live Dify), except in
  `auto` Confirm mode. With the default `deploy=none`, Phase ④ only validates +
  reports the file — no Dify contact.
  - **`app_id` capture *(Lát 5)*.** `sync.py push --json-out` (a Lát-5 flag) prints
    the raw import-endpoint `r.json()` on one line; the backend `JSON.parse`s it and
    reads **`app_id`** (PRIMARY — a real Cloud `/console/api/apps/imports` returns
    `{app_id, status, error, current_dsl_version}`, verified spec 008), falling back
    to `id` / nested `app.id`. If the id is absent (or the push crashed), the backend
    **reconciles via `sync.py list` matched by slugified app name**; since push always
    creates a new app, repeats slugify identically → it picks the **most-recently-created**
    match (slug-ambiguous tiebreaker). The clickable `app_url` =
    `DIFY_CONSOLE_URL` with `/console/api` stripped + `/app/<app_id>/workflow`.
- **Persistence** — minimal: a per-task JSON file under `apps/builder/.runs/`
  holding the state machine fields, enough to resume after a restart. No SQLite.
  Caveat: a stored `sessionId` may not survive a backend restart or may have
  expired; recovery does **not** assume `--resume` works — it falls back to a
  **fresh turn seeded with the prior phase's artifact** (Q3), and a task caught
  mid-turn by a restart is marked `status: error` with the current phase
  re-runnable (see §I).

**Endpoints** (resources mirror Project ▸ Workflow ▸ Task):

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | Serve the SPA |
| `/api/tree` | GET | Sidebar: projects → workflows → tasks (folder scan of `projects/` + `.runs/`) |
| `/api/active` | GET | The in-progress (non-terminal) builds, newest first (Lát 6). With the turn-level lock multiple builds may sit parked at gates; the SPA fetches this on load to list + reach them all so a parked build is never stranded (extends AC #22 to the no-taskId case). |
| `/api/tasks` | POST | `{project, workflow?, requirement, seed?, confirm_mode?, deploy?, name?, slug?}` → start a task, run Phase ①. `workflow` omitted/`none` → scaffolds a **new** workflow (`name`/`slug` optional — if omitted, the **Spec phase proposes them** and the user confirms at the Spec gate, see §Data model); an existing name → edits it. **`seed` shape + scaffold-timing routing per §Revision 2026-06-10** — a `{kind:"dify_app"}` seed for a *new* workflow makes `slug`/`name` **required up-front** (scaffold before Phase ①); a `local`/absent seed uses the Spec-proposes-slug path. `confirm_mode` defaults to `confirm each step`; `deploy` defaults to `none`. No `model` (auto). No pattern (auto-selected in Spec). Returns `409` (with the running `holder`) **only if a turn is actively running** (turn-level run-lock, Q6 / Lát 6); a build parked at a gate does **not** block — multiple builds may park at once. |
| `/api/tasks/:id` | GET | Current state + artifact paths/contents |
| `/api/tasks/:id/confirm` | POST | Advance to the next phase (the gate; carries the chosen gate action) |
| `/api/tasks/:id/reply` | POST | Change request / question within the current phase |
| `/api/tasks/:id/cancel` | POST | Cancel/abandon the task: kill the live turn if one is running (its dispatch `finally` then frees the turn lock), else just flip the parked gate to a terminal status (a parked build holds no lock) (§Revision 2026-06-10; turn-level Lát 6) |
| `/api/tasks/:id/spec` | PUT | Persist an in-place `SPEC.md` edit from the artifact panel (Q4) |
| `/api/tasks/:id/stream` | GET (SSE) | Live Claude output + phase/status/gate events |
| `/api/seeds` | GET | Existing Dify apps (via `sync.py list`) for the seed selector. **Degrades gracefully**: if Dify creds are absent (`sync.py list` exits 1), returns `{seeds: [], note: "connect Dify to seed from a workspace app"}` rather than erroring — seeding from a **local** workflow needs no creds (§G). |
| `/health` | GET | readiness |

### B. Frontend — `apps/builder/web` (chat-first SPA, 3 regions)

**Preact + Vite + TypeScript + @preact/signals** — the **same stack as
claude-nexus** (Q2 RESOLVED), chosen so the chat-conversation surface is
**copied/adapted from nexus's `src/client`** rather than rebuilt (see References).
Modeled on the claude-nexus layout. Toolchain (`vite.config`, `tsconfig`) lifts
from nexus; the app needs `npm install && npm run build` (dev: `vite dev`).
**Three regions**:

1. **Left sidebar — a view of `projects/`** (Project ▸ Workflow ▸ Task tree).
   Top-level = **virtual Project labels** (from each folder's `project:`
   metadata); under each, the **Workflow folders** (`projects/<slug>/`); under
   each, its Tasks. Collapsible. **Hovering a project shows only a "+" (New
   task)** — no gear. Clicking a task opens its
   conversation. A **static breadcrumb** at the top of the chat pane shows the
   project (new task) or the stored `project ▸ workflow ▸ title` (reopened task);
   it is not auto-updated mid-run.

2. **Center — chat pane** (the primary surface; **chat-first, not a form**):
   - A **chat input** ("describe the workflow / change…").
   - **Run settings sit directly BELOW the input** (like nexus's selectors), not
     in a modal. **No model picker** — the model is auto (max available / Claude
     Code's setting). The settings are:
     - `Workflow ▾` — **default `none` (unselected)**; opening the selector
       lazily lists the existing workflows in this project. Leaving it `none` →
       the task creates a **new** workflow; picking an existing one → the task
       **edits/fixes** it (its `main.yml` is the base) and **prefills the
       known info** (its pattern, last deploy, etc.). Reopening an already-run
       task shows its stored settings.
     - `Confirm mode ▾` — how much the run pauses for you:
       - `confirm each step` (**default**) — stop at every phase (§D);
       - `confirm at spec only` — stop only after Spec, auto-advance the rest;
       - `auto` — run all phases without stopping (autonomous).
     - `Deploy ▾` — **`none` (default)** = produce/validate the `main.yml` only, no
       import; or `selfhost` (auto-import via `sync.py push`) / `cloud` (YAML +
       Studio instructions).
     Set once before the first send. (The Dify **pattern is auto-selected** in
     the Spec phase — no manual pattern picker; state a preference in the
     requirement text if needed.)
   - Below that, the **conversation thread**: streamed Claude output per phase,
     with **inline gate buttons** at each decision point (§D) — e.g.
     `[ ✔ Continue to Spec ] [ 💬 Request changes ]`, then
     `[ ✔ Implement this spec ] [ ✏ Edit spec ]`, then (only if Deploy ≠ none)
     `[ ✔ Import into Dify ] [ 💬 Review again ]`. The text box stays available
     for ad-hoc steering.
   - A slim **phase indicator** (① Analyze · ② Spec · ③ Implement · ④ Test).

3. **Right — artifact panel** (slides in when relevant): renders `SPEC.md`
   (phase ②, editable in place), `main.yml` + lint results (phase ③), the **diff
   vs the seed workflow**, and the final report (with `app_url` when Deploy ≠
   none) (phase ④).

**Gate buttons** are the heart of the UX: every confirm/approve is an inline
button in the thread (the nexus permission-button pattern), driven by the
backend's gate actions (§D). The user mostly clicks buttons; the text box is for
"actually, change X".

### C. Domain logic — the 4-phase procedure (the backbone)

Each phase is driven by a **prompt template** the backend sends to that phase's
Claude turn. Templates live in **`.claude/skills/dify-build/`** (shared engine,
usable without the app — Q1 / §H); the backend reads those bodies. Each template:

- references [AGENTS.md](../../AGENTS.md) §3–§4 + §9 (does not restate
  conventions), and names the exact commands to run;
- ends with **"present your result, then STOP — do not begin the next phase"**
  (belt-and-suspenders; the real gate is the backend not issuing the next turn).

| Phase | Does | Artifact (authoritative) | Tooling |
|---|---|---|---|
| ① Analyze | summarize the seed workflow (pattern, nodes, var flow, plugins, change points) | `.runs/<taskId>/analyze.json` (+ prose in chat) | **backend** pulls the seed (`sync.py pull`, token stays backend-side); the turn only **reads the local YAML** (never runs `sync.py`) |
| ② Spec | draft target behavior, chosen pattern, nodes to add/modify, refs, plugins; **propose slug+name if new** | `.runs/<taskId>/SPEC.md` (new, pre-slug) → moved to `projects/<slug>/SPEC.md` on gate confirm; or directly `projects/<slug>/SPEC.md` (slug known) | `find.py --json` |
| ③ Implement | re-read `SPEC.md` (last-writer) → generate node IDs → instantiate/edit YAML; validate→fix loop (cap 5, Q5) with **clean vs still-failing gate** (§D); diff vs seed (baseline per case: **empty/new** / pre-edit snapshot / pulled seed) | `projects/<slug>/workflows/<workflowFile>` (`main.yml` if new) | **`generate_id.py`** (mandatory — hand-made IDs render as literal text, AGENTS.md §4.1/§9) + validators. *(Scaffold via `init_project.py` is **backend-run at the Spec-gate confirm**, not this turn.)* |
| ④ Test&Report | import (self-host) or emit YAML (cloud); report | `.runs/<taskId>/report.json` (+ prose in chat) | **backend (no claude turn)** — backend runs `sync.py push --yes` itself (token backend-side); gate = `report.json` exists+non-empty. |

### D. Gating — guaranteed by the app, driven by Confirm mode

This is the crux and the reason for a dedicated app. The backend runs **exactly
one Claude turn per phase** and **decides when to issue the next turn** — so the
gate is enforced by the orchestrator, not by a soft "stop" instruction nor by
claude-nexus's unfinished `review_each_phase` (#079). When a turn completes, the
task sits in `awaiting_confirm`; whether the backend pauses or auto-advances is
set by the task's **Confirm mode**:

| Confirm mode | Backend behavior at each phase boundary |
|---|---|
| `confirm each step` (default) | Pause at **every** boundary; advance only on `/confirm` |
| `confirm at spec only` | Pause **only after Spec**; auto-issue the next turn for the others |
| `auto` | Auto-issue every next turn; no pauses (fully autonomous) — **except** it hard-stops at a *still-failing* Implement gate (lint≠0) and never imports a lint≠0 workflow |

Because *we* control turn issuance, all three modes are deterministic here (no
stub). "Ask for a change" = `/reply` → another turn **within** the same phase
(resumed session); a paused phase advances only on confirm.

**Gates render as inline buttons.** At `awaiting_confirm`, the backend attaches a
small set of **gate actions** to the task state; the UI renders them as inline
buttons in the thread (nexus's permission-button pattern). Typical actions:
`Continue to <next phase>` / `Request changes`. Clicking the primary action POSTs
`/confirm`; "request changes" focuses the text box → `/reply`.

**Implement has two gate variants** (the validate→fix loop, §C/§I, caps at 5): a
**clean** gate when all linters exit 0 — actions `[ ✔ Continue to Test ] [ 💬 Request
changes ]`, which `auto` may auto-advance; and a **still-failing** gate when the cap is
reached with lint≠0 — actions `[ Accept anyway ] [ Keep trying ] [ Abandon ]`, flagged
"still failing", which **`auto` must hard-stop at** (it never imports a lint≠0
workflow). Each gate action has the shape `{id, label, kind, route}` (`kind` = the
primary `/confirm` action vs a composer-focus `/reply`).

**Two button kinds, deliberately separated:**
- **Phase-gate actions** (above) — the app's own confirm points; always shown.
- **Tool-permission prompts** (Claude asking to run a tool) — routine repo
  commands run without a prompt under **model C** (`--permission-mode acceptEdits`
  + broad `Bash` allow; §Revision) so they do *not* nag.
  The one place a tool action keeps an explicit confirm is **Phase ④ import**
  (`sync.py push`, only when Deploy ≠ none) — it mutates live Dify, so the user
  clicks `Import into Dify` before it runs. (In `auto` Confirm mode this too runs
  without a prompt — that's the point of `auto`.)

> ⚠ **Footgun: `auto` + `Deploy: selfhost` + edit-existing.** Because
> `sync.py push` always creates a **new** app (Non-goal 8) and `auto` suppresses
> the import confirm, an autonomous run that *edits* an existing workflow will
> **silently create a duplicate app** in Dify with no pause. **DECISION (2026-06-10):**
> the run is **allowed** but the Phase-④ report MUST surface a prominent "created a NEW
> app (duplicate)" warning — we do **not** refuse the combination. (See §Revision
> 2026-06-10. Note `auto` still hard-stops at a *still-failing* Implement gate and never
> imports a lint≠0 workflow.)

### E. Permission scope (headless turns must not block)

> **FULLY SUPERSEDED by §Revision 2026-06-10 → "Security / permissions" (model C, decided
> by Lát 0 spike).** The pre-spike draft body (an explicit `--allowedTools` fail-fast allowlist
> that still listed `sync.py`) has been **removed** (spec 019 L6) so no contributor copies a dead
> allowlist; its fail-fast framing and "**not** `--permission-mode acceptEdits`" claim were **wrong**.
> Authoritative model: **broad-allow `--permission-mode
> acceptEdits` + a dialect-fixed deny carve-out (no leading slash) + `--setting-sources
> local` isolation, with the #3b post-turn `git status` confinement check (reject + revert)
> as the real boundary.** A tool call outside the deny-list does **not** "fail fast" — under
> `acceptEdits` it runs; confinement is enforced *after* the turn by #3b, not by the
> permission layer (spike E2d proved an opaque Bash write escapes the deny). `sync.py` is
> **not** in any turn allowlist (Dify I/O is backend-owned). See §Revision + `009-spike-findings.md`.

### F. Configuration (per user)

**Prerequisite**: the `dify-projects` checkout must have been bootstrapped once
with `./scripts/setup.sh` — it creates the gitignored `.venv/` + `skills/` that
every phase tool lives in (AGENTS.md §2). A fresh `git clone` alone is **not**
runnable; `/health` fails fast if `${DIFY_PROJECTS_DIR}/.venv/bin/python` or
`skills/` is missing.

A top-level `apps/builder/.env` (with `.env.example`):

```
DIFY_PROJECTS_DIR    = ../..               # path to the dify-projects checkout (must have run setup.sh)
DEFAULT_DEPLOY       = none                # none (default) | selfhost | cloud
BUILDER_PORT         = 4123
# Only needed when a task's Deploy ≠ none, OR when seeding from a Dify workspace app:
DIFY_CONSOLE_URL     = http://localhost/console/api
DIFY_CONSOLE_TOKEN   = <bearer token>      # selfhost import; per sync.py docs
```

The backend shells repo tools via `${DIFY_PROJECTS_DIR}/.venv/bin/python` — it
never `pip install`s. `DIFY_CONSOLE_URL`/`TOKEN` are required when a task's
Deploy is `selfhost`/`cloud` **or** when Phase ① seeds from a *Dify workspace*
app (which calls `sync.py pull`). With `Deploy=none` **and** seeding from a
**local repo workflow** (or no seed), the app needs no Dify connection at all
(it only writes `main.yml`); the seed picker (`/api/seeds`) then degrades
gracefully (§endpoints).

#### Backend-owned Dify I/O; token never enters a turn *(Lát 5 — supersedes the older "reuse `dev.env`" wording)*

All Dify-touching `sync.py` calls — `list` (seed picker), `pull` (Phase ①
Dify-seed), `push` (Phase ④ selfhost import) — run **only in a backend
subprocess** (`apps/builder/server/lib/dify-io.ts`, cwd = `DIFY_PROJECTS_DIR`)
with `DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN` injected **into that child's env
directly** (read from the backend's `.env`/process env — **not** via
`projects/<slug>/envs/dev.env`+dotenv, which silently no-ops if dotenv is absent).
The token:

- **never enters a `claude` turn** — `claude-session.ts` strips every `DIFY_*`
  from the spawned turn's env (defense beyond "phases never run `sync.py`"), and
  no phase is ever handed a `sync.py` command;
- **never reaches the SSE stream or any `.runs/` JSON** — `dify-io.ts` redacts
  the token (and any `Bearer …`) from all captured stdout/stderr before it is
  logged, returned, or surfaced;
- **bind stays `127.0.0.1` (hardcoded)**; only `BUILDER_PORT` is configurable.

`/api/seeds` degrades gracefully: `sync.py list` exits 1 for **both** missing
credentials **and** a request failure (indistinguishable by code), so the backend
parses stderr (`not set` ⇒ `no-credentials`; `list_apps failed:` ⇒
`dify-unreachable`) and always returns HTTP 200 with an empty list + reason.

### G. Deploy modes (per task, set in settings)

| Deploy | Phase ④ behavior | Needs Dify? |
|---|---|---|
| **`none`** (default) | validate + report + write `main.yml`; **no import** | No |
| `selfhost` | also `sync.py push` → app appears in Dify; report `app_url` | Yes (token) |
| `cloud` | emit YAML + Studio-import steps (CSRF blocks auto-import) | Read-only |

Phase ① seeding from a *Dify workspace* app (`sync.py pull`) needs a connection
regardless; seeding from an **existing repo workflow** does not (reads the local
`main.yml`).

**Dify-workspace seed contract (important).** `sync.py pull --project <slug>`
(verified `sync.py` `cmd_pull`) (a) **requires `projects/<slug>/` to already
exist** and (b) writes `projects/<slug>/workflows/<app-name-slug>.yml` — **not
`main.yml`**. Consequences the implementation must honour:
- **Edit-existing** task: the project + its workflow file already exist; Phase ①
  reads them directly (or `pull --yes` to refresh), and Phase ③ edits the
  selected file (its existing name, per `WORKFLOW_FILENAME`).
- **New workflow seeded from a Dify app**: the slug must be fixed **up-front**
  (the seed picker supplies a provisional slug/name at `/api/tasks`), the backend
  scaffolds `projects/<slug>/` **before** Phase ①, then `pull` writes the seed as
  `<app-name-slug>.yml`. Phase ① analyzes that pulled file; it is the **seed/base
  for the diff**; Phase ③ produces the canonical `main.yml` from it. (The pulled
  seed file and the target `main.yml` may coexist — the report notes both.)
This reconciles the seed filename with `WORKFLOW_FILENAME=main.yml` and the
"folder must exist before pull" constraint.

### H. Integration — the app is an OPTIONAL layer

**Core principle**: `dify-projects` stays **fully usable without the app**. A
human or any AI agent can build workflows via the CLI + [AGENTS.md](../../AGENTS.md)
exactly as today; the app is one convenience surface for people who want a visual
flow. Two rules keep this true:

1. **No build logic in the app.** Everything that generates/validates/imports
   lives in the **shared substrate** — the repo tooling (`sync.py`, `find.py`,
   `init_project.py`, the validators) and the **4-phase procedure** in
   `.claude/skills/dify-build/`. The app only *orchestrates* (spawns Claude,
   gates phases, streams, renders). Anyone without the app runs the same skill /
   reads the same procedure with their own Claude/AI.
2. **The app is self-contained under `apps/`** and does not alter the standalone
   layout or gates. Flat `projects/<slug>/` is kept; the Project grouping is
   virtual metadata.

**Repo prep checklist (small, isolated — Nhịp 0)**:

| Change | Why | Touches standalone? |
|---|---|---|
| `.gitignore` += `apps/*/node_modules/`, `apps/*/dist/`, `apps/*/.runs/`, `apps/*/.env*` | keep Node/Vite build cruft out of git | No |
| `.pre-commit-config.yaml` += `exclude: ^(apps/\|node_modules/)` | stop `check-yaml` choking on `package.json` | No (only adds an exclude) |
| optional `scripts/setup-node.sh` (separate from Python `setup.sh`) | app-only bootstrap | No (opt-in) |
| optional root `package.json` (npm workspace `apps/*`) | run the app | No |
| optional `project.group` sub-key in `projects/<slug>/.dify-workspace.yaml` | app sidebar grouping | No (sibling key, ignored by tooling; **not** a top-level scalar) |
| `.claude/skills/dify-build/` (the 4-phase procedure) | shared engine for app **and** CLI | **Additive** — also helps no-app users |
| README/CLAUDE.md note: "Optional: builder app" | discoverability | No |

The repo tooling is already subprocess-friendly (clean CLI args, Unix exit
codes, documented env vars), so the app calls it as-is. `find.py --json` gives
structured output; the others return human text (fine — Claude, not the app,
reads them inside a phase turn).

### I. Error handling & recovery

The state machine has five statuses: `running → awaiting_confirm → done | error | cancelled`
(`cancelled` via `POST /api/tasks/:id/cancel`). `error` is **terminal-but-retryable** —
the user can `/reply` to re-run the failed phase, or abandon the task. Concrete failure
paths and handling:

| Failure | Detection | Handling |
|---|---|---|
| Claude turn exits non-zero / crashes | spawn exit code ≠ 0, or no terminal `result` event | `status: error`; surface stderr tail; phase re-runnable via `/reply` |
| Turn timeout (**per-turn** budget, default 10 min, per-phase configurable) | wall-clock timer | kill the child, `status: error`, "phase timed out — retry or simplify". Phase ③'s 5-pass loop runs **inside one turn**, so a mid-loop timeout is `error` (distinct from the still-failing gate) |
| Claude rate-limit / auth lapse | `result` event error subtype, or known stderr signature | `status: error`; message tells the user to wait / re-run `claude auth login`; **no auto-retry** (avoids hammering the shared subscription) |
| Turn ends but **no artifact** produced (no `SPEC.md` / `main.yml` / `.runs` json) | post-turn artifact check (the §A contract) | `status: error`, "phase produced no artifact"; do **not** advance |
| Implement validate→fix loop doesn't converge | iteration cap reached (Q5, default 5) | stop at Implement with the last linter error + partial `main.yml`; `awaiting_confirm` with a "still failing" flag — user decides |
| Backend restart mid-turn | on boot, any task in `running`/`scaffolding` | mark `status: error` (turn-level lock is in-memory → `turnHolder` simply starts null; a paused `awaiting_confirm` build survives untouched and stays reachable — no re-acquire, no single-build tie-break, Lát 6), current phase re-runnable; **do not assume `--resume`** — re-run the phase as a fresh turn, seeding **per the per-phase idempotency rules below** (③/④ are not simply re-seeded from a partial artifact); an orphaned child / `sync.py push` subprocess that outlived the crash is reconciled via the ④ `push_intent` guard |
| Second build's **turn** collides with a running turn | turn-level run-lock (Q6, Lát 6) | `POST /api/tasks`/`/confirm`/`/reply` returns `409 "a turn is already running"` **with the running `holder`** (the UI offers "open it"); a build merely **parked at a gate does NOT block** — multiple builds may park at once |

Every `error` is streamed to the UI as a thread message with a `Retry phase`
gate button (→ `/reply`). The gate never auto-advances out of `error`.

**Per-phase idempotency on re-run** (a fresh turn "seeded with the prior
artifact" is not uniformly safe — pin this in Nhịp 1/Week 2):
- **③ Implement** — do **not** re-seed from a half-written `main.yml`; **every retry
  re-instantiates from the pattern + `SPEC.md`** (or restores a pre-turn snapshot) so a
  crash mid-edit can't double-apply. Do **not** branch on the linter exit code to decide
  regenerate-vs-fix — `validate_workflow.py` only emits exit 0/1 (exit 2 lives only in
  `lint_refs.py`/`lint_plugin_hashes.py`), so always regenerate on retry.
- **④ Test&Report selfhost** — write a `push_intent` marker to `.runs/<taskId>/`
  **before** calling `sync.py push`. On re-run, if `push_intent` exists without a
  confirmed `app_id`, do **not** re-`push` (it would create another duplicate app) —
  reconcile via `sync.py list` or surface "push may have completed — check Dify". The
  guard keys off the **pre-push marker**, not the post-push `report.json` (written only
  after the push returns).

**Run-lock granularity.** ~~v1 is build-level single-build-at-a-time~~ **(Lát 6 / Phase 3:
now TURN-LEVEL).** The lock is held only while a `claude` turn (or a backend write-unit)
is **actually running**, and **released when the build parks at a gate** (`awaiting_confirm`)
or terminates. A build paused at a human gate (possibly for minutes) therefore holds
**nothing**, so **any number of builds may sit parked at gates**; only turn *execution* is
serialized 1-at-a-time. The single in-memory `turnHolder` slot is what keeps the #3b
post-turn `git status` confinement check valid **unchanged** (at most one build writes the
tree at a time — concurrent turns would need per-build confinement scoping, out of scope).
A second `POST /api/tasks` (or `/confirm`/`/reply`) gets `409` **only when a turn is
genuinely running** — a parked build no longer triggers it. The lock is acquired
synchronously in the route right before the turn is dispatched (which also closes the
double-dispatch race), and released in the dispatch `finally` when the work settles.
*(Historical: Lát 3 was build-level — a gate held the lock; `409 Busy` on any 2nd build.
shared auth still motivates the 1-turn-at-a-time serialization, Q6.)*

### J. Security & threat model

The app spawns Claude with `Write`/`Edit`/`Bash` over the user's repo on the
user's subscription — low blast radius (local, single-user) but worth bounding:

- **Filesystem confinement** — the real boundary is the **#3b post-turn `git status`
  confinement check (reject + revert)**, not the permission layer (model C, decided by Lát 0
  spike; see §Revision + `009-spike-findings.md`). Defense-in-depth: `--permission-mode
  acceptEdits` + a dialect-fixed deny carve-out (**no leading slash**) on `tools/**`,
  `skills/**`, `.venv/**`, `.git/**`, `.claude/**`, `Read(projects/*/envs/*.env)`; host +
  project layers isolated via `--setting-sources local` (the repo's own `.claude` injects a
  `permission-gate.js` hook). The deny stops the `Write`/`Edit` tools and naive Bash
  redirects, but an **opaque** subprocess write (`python -c`, spike E2d) escapes — so after
  every turn the backend reverts any write outside `projects/<slug>/` +
  `apps/builder/.runs/<taskId>/` and marks `status:error`. It also **validates**
  `--slug`/`--project` against the active slug on the pinned scripts.
- **Untrusted seed YAML = prompt-injection surface** — a seeded workflow (esp.
  one pulled from a shared Dify workspace) is untrusted input fed to Claude.
  Treat its text as data, not instructions; the phase prompts must not execute
  directives found inside a seed. Note this in the Analyze template.
- **Secrets** — the Dify bearer token is read from `projects/<slug>/envs/dev.env`
  only when `Deploy ≠ none`; it is never logged to the SSE stream or `.runs`
  files. With `Deploy=none` the app needs no token at all.
- **No remote exposure** — the backend binds `127.0.0.1` only (**hardcoded, not
  env-overridable** — only `BUILDER_PORT` is configurable) and applies an
  **Origin/same-origin check** on the mutating POST endpoints (local-CSRF defense).
  Document that users must not expose `BUILDER_PORT` publicly (it would proxy arbitrary
  repo command execution).

## Open questions

> **Decisions locked 2026-06-10** (see §Design → Revision 2026-06-10): (a) `auto` +
> `selfhost` + edit-existing is **allowed** with a duplicate-app warning, not refused;
> (b) a sidebar **Workflow = the `projects/<slug>/` folder**, and editing picks a `*.yml`
> (default `main.yml`) as `workflowFile`; (c) **ungrouped** workflows render as their own
> Project row (group defaults to the slug); (d) **SSE reconnect** restores the gate only
> (no transcript backfill in v1). Q1/Q2/Q5/Q6 remain RESOLVED; Q3/Q4/Q7 remain open
> defaults.

### Q1. Where do the phase prompt templates live — `apps/builder/prompts/` or `.claude/`?

Per the "app is an optional layer" principle (§Integration), the procedure must
be usable **without** the app. **RESOLVED: put the 4-phase procedure in
`.claude/skills/dify-build/`** (a real skill any CLI/other-AI user can run), and
have the app **read the skill's body files** (per-phase prompt = the skill's
phase section) — so the engine is shared, not locked in the app.
`apps/builder/prompts/` would only hold app-specific glue, if any. **Creating
`.claude/skills/dify-build/` is a Nhịp 0 task** (it must exist before Nhịp 1
validates the procedure).

### Q2. Frontend stack — plain/no-build vs Preact+Vite+TS

**RESOLVED (2026-06-09): Preact + Vite + TypeScript + @preact/signals — the same
stack as claude-nexus**, so the chat-conversation UI is copied/adapted from
nexus's `src/client` rather than written from scratch (see References for the
copy-target components).

The decision was made on a grounded effort comparison (3-agent measurement of
nexus's real client code), **not** on "copy is fast" — net findings:
- To **first version**, build is actually ~3–4 days **more** effort than a
  no-build (Preact+htm) approach (~14d vs ~10d): the nexus "copy" is mostly
  *adapt*, and much of region-B is net-new for 009 (different data model,
  out-of-band gate). So upfront, no-build is marginally cheaper.
- **Total effort is ~equal** (~12–14d either way) because no-build only *defers*
  the toolchain + a later htm→JSX migration; it does not remove the work.
- Build wins on the axes that matter here: **compile-time safety on the
  load-bearing gate/SSE/API data plane** (009's correctness rides on these
  shapes), **verbatim reuse of dense logic** (the diff renderer/parser), and
  **drop-in `.tsx` for every future feature ported from nexus** — all compounding
  because the app is slated to grow (§Non-goals notwithstanding, more patterns +
  richer DSL viewer are planned).
- The usual reason to prototype no-build first (de-risk the unknown) is **already
  covered by Nhịp 1**, which validates the 4-phase procedure on stock nexus
  before any app code is written — so no-build-first buys little here.

Trade-off accepted: ~1–2d one-time toolchain setup (largely **liftable** from
nexus's `vite.config.*` + `tsconfig*.json`) and the `npm run build` step
(acceptance #1). Node/npm is in this repo regardless (the Fastify backend needs
it), so the only thing build "adds" is the frontend bundler.

### Q3. Session resume vs fresh context per phase

Resuming one session across all 4 phases preserves context but grows the
transcript; fresh turns with explicit handoff (pass the prior artifact path) are
cheaper and more deterministic. The **between-phases half is RESOLVED** (it is
now load-bearing for §I restart recovery): each phase is **always a fresh turn
seeded with the prior phase's artifact**, never a cross-phase `--resume` — this
is what makes a restart re-runnable (verified by acceptance #19). Only the
**within-phase change-request** style (resume the just-ended session vs new turn
+ artifact) remains a Nhịp-1 detail.

### Q4. SPEC.md editing during the gate — file edit vs chat

User may edit `SPEC.md` in their editor or ask Claude to revise it. **Default**:
support both; the Implement phase re-reads `SPEC.md` so a manual edit wins.

### Q5. Validate-loop iteration cap (Implement phase)

**RESOLVED**: cap at **5 passes**; on non-convergence, stop at the Implement gate
with the last linter error + the partial `main.yml` (status `awaiting_confirm`
flagged "still failing"), not an infinite loop. Verified by acceptance #20. This
is the sole mitigation for the Medium "validate→fix doesn't converge" risk.

### Q6. Concurrency / one Claude per build

Parallel builds share the user's single auth → possible rate limits. **RESOLVED**:
serialize **turn execution** with a **turn-level run-lock** — at most one `claude`
turn runs at a time, so the shared auth is never hit by two concurrent turns and the
#3b confinement check stays valid (1 writer). **Updated Lát 6 (Phase 3):** the lock is
turn-level, NOT build-level — it is held only while a turn runs and released when the
build parks at a gate, so **multiple builds may sit parked at gates** and only a real
**turn collision** returns `409` (`POST /api/tasks`/`/confirm`/`/reply`, with the running
`holder` so the UI can jump to it). *(Lát 3 shipped the build-level form — a gate held
the lock, any 2nd build got `409 Busy`.)* Verified by acceptance #21.

### Q7. Multi-pattern requirements

A requirement spanning ≥2 patterns (008 Q4). **Default**: the Spec phase picks
the closest single pattern and states the simplification for the user to accept
or redirect at the Spec gate.

## Acceptance criteria

MVP is **Done** when:

1. [ ] After `./scripts/setup.sh` (documented prerequisite — creates `.venv/`
   + `skills/`), `cd apps/builder && npm install && npm run build && npm start`
   boots and serves the built UI (dev: `npm run dev` via Vite); `claude auth login`
   is the only extra Claude setup. `/health` returns non-OK (with a clear message)
   if `.venv/` or `skills/` is missing.
2. [ ] The seed picker lists existing Dify apps (via `sync.py list`); selecting
   one feeds **Phase ① Analyze**, which produces a correct structural summary and
   **stops**.
3. [ ] **Phase ② Spec** writes `SPEC.md` (to `.runs/<taskId>/` for a no-slug task,
   else `projects/<slug>/`), **stops**, and proceeds only on confirm; on confirm a
   no-slug task scaffolds `projects/<slug>/` and moves `SPEC.md` into it; a user
   edit to `SPEC.md` is reflected in Implement.
4. [ ] **Phase ③ Implement** produces `projects/<slug>/workflows/main.yml` with
   node IDs minted by `generate_id.py` (no hand-made string IDs), passing
   `validate_workflow.py` + `lint_refs.py` + `lint_plugin_hashes.py` (exit 0)
   before stopping, and shows a diff vs the seed — **or**, when there is no seed
   (new workflow, `Workflow: none`), the full `main.yml` as additions against an **empty
   base** (the auto-selected pattern is agent-internal, not tracked — no pattern-delta).
5. [ ] **Phase ④ Test & Report** with default `Deploy: none` writes/validates
   `main.yml` and reports its path (no Dify needed); with `Deploy: selfhost` it
   also imports and reports a clickable `app_url`.
6. [ ] **In the default `confirm each step` mode, no phase auto-advances** —
   verified by observing the build pause in `awaiting_confirm` at each of the 4
   phases; advancing requires a confirm POST. (Orthogonal to #15, which covers the
   `confirm at spec only` / `auto` modes.)
7. [ ] A change request via `/reply` at a gate revises the current phase's output
   without advancing.
8. [ ] The Implement validate→fix loop self-corrects ≥1 deliberately seeded error
   without human help (then still stops for confirmation).
9. [ ] Cloud mode cleanly skips import and reports copyable YAML + Studio steps.
10. [ ] No spawned turn ever hangs on a permission prompt: under `--permission-mode
    acceptEdits` + `--setting-sources local` (host **and** project layers excluded — the
    repo's own `.claude` `permission-gate.js` hook would otherwise prompt/hang), a phase
    runs its repo commands and writes without a prompt and exits 0 (spike E1/E4). Confinement
    is **not** a fail-fast allowlist — it is the post-turn #3b check (criterion #23). (`sync.py`
    is backend-owned and never a turn command — model C, §Revision 2026-06-10.)
11. [ ] No runtime dependency on claude-nexus (only copied code, vendored in).
12. [ ] A README covers install, `claude auth login`, `.env`, and the 4-phase run.
13. [ ] Sidebar = the folders in `projects/` as a **Project ▸ Workflow ▸ Task**
    tree; hovering a project shows **only "+" (New task)**; the breadcrumb is
    static (new task shows just the project).
14. [ ] Run settings sit **below the chat input** (no modal) and are **Workflow /
    Confirm mode / Deploy** only — **no model picker** (auto), **no manual pattern
    picker** (auto in Spec). `Workflow` defaults to `none` (lazy list; `none` =
    new workflow); `Confirm mode` defaults to `confirm each step`; `Deploy`
    defaults to `none`.
15. [ ] `Confirm mode` works: `confirm each step` pauses every phase; `confirm at
    spec only` pauses only after Spec; `auto` runs through without pausing.
16. [ ] Every confirm/approve is an **inline gate button** in the thread; routine
    repo tools do not prompt, while **Phase ④ import keeps an explicit button when
    Deploy≠none** (except in `auto` mode).
17. [ ] **Standalone untouched**: flat `projects/<slug>/` kept; the app derives
    the Project grouping from the optional `project.group` sub-key; adding it does
    **not** break `check_dsl_version.sh`/`regen_vscode_settings.py`; existing CLI
    tooling/tests/CI pass unchanged. Adding `apps/` does not break any Python gate.
18. [ ] **New-workflow slug/name**: a task with `Workflow: none` and no `slug`/`name`
    gets a slug+name proposed at the Spec gate; on confirm, `init_project.py`
    scaffolds `projects/<slug>/` and the build proceeds.
19. [ ] **Error handling**: a phase whose turn exits non-zero, times out, or
    produces no artifact lands in `status: error` with a `Retry phase` button and
    does **not** advance; a turn killed by a backend restart is re-runnable on reboot.
20. [ ] **Validate-loop cap (Q5)**: an unfixable seeded error stops at the Implement
    gate after ≤5 passes with the last linter error + partial `main.yml`, never looping.
21. [ ] **Concurrency (Q6) — turn-level (Lát 6)**: a 2nd build whose **turn** collides with a
    running turn returns `409` (`holder` lets the UI offer "open it"); a build merely **parked at
    a gate does NOT 409** — two (or more) builds can sit parked at gates at once, both listed in the
    sidebar / `GET /api/active` and reachable. The running build is unaffected. *(Lát 3 form — any
    2nd build while one is non-terminal got `409 Busy` — is superseded.)*
22. [ ] **SSE resilience**: dropping and re-opening `/stream` mid-build restores the
    current phase/status/gate (via re-fetching `/api/tasks/:id`) without losing the gate.
23. [ ] **Security confinement (§J, §Revision 2026-06-10 — model C)**: a phase turn that
    writes outside `projects/<slug>/` or `apps/builder/.runs/<taskId>/` is caught and
    **reverted by the #3b post-turn `git status` check** (turn → `status:error`) — including
    an **opaque** write the deny-list cannot catch (e.g. a seeded `python -c open('tools/x','w')`,
    which the spike proved escapes the deny, E2d), not only a `Write`/`Edit`-tool attempt.
    The deny carve-out (dialect-fixed, no leading slash) + `Read(projects/*/envs/*.env)` deny
    are defense-in-depth; the Dify bearer token never appears in the SSE stream or any
    `.runs/` JSON (and never enters a turn); the backend binds `127.0.0.1` only (not
    env-overridable).
24. [ ] **Cancel + lock release (§Revision 2026-06-10)**: `POST /api/tasks/:id/cancel`
    kills the running turn, sets a terminal status, and frees the run-lock so a new
    `POST /api/tasks` succeeds; on backend boot the lock is cleared and any `running`
    task → `error`.
25. [ ] **Implement gate variants + push idempotency (§Revision 2026-06-10)**: a clean
    Implement (lint exit 0) and a still-failing Implement (cap-5, lint≠0) render distinct
    gate actions; in `auto` mode the still-failing gate **hard-stops** and no import
    occurs; a Phase-④ `selfhost` re-run after a simulated mid-push crash does **not**
    create a duplicate Dify app (the `push_intent` guard).

## Implementation plan

### Nhịp 0 — Non-disruptive repo prep (~½ day)

**No migration** — the flat `projects/<slug>/` layout is kept; the Project level
is a virtual grouping (Data model). Just the small, isolated additions so an
optional `apps/` dir doesn't trip Python-oriented gates (§Integration):

- [x] `.gitignore`: `apps/**/node_modules/`, `apps/**/dist/`, `apps/*/.runs/`, `apps/*/.env*` (+
  `!apps/*/.env.example`). **Done (Lát 5)** (`**` covers the nested `web/` package).
- [x] `.pre-commit-config.yaml`: top-level `exclude: ^(apps/|node_modules/)` so
  `check-yaml`/`trailing-whitespace` skip the Node app. **Done (Lát 5)** (additive — per-hook
  excludes still apply).
- [x] `scripts/setup-node.sh` (kept separate from the Python-only
  `setup.sh`) — installs + builds the builder backend and web SPA. **Done (Lát 5).**
- [x] Add an optional `project.group` **sub-key** (inside the existing `project:`
  mapping) to the `templates/_base/project/.dify-workspace.yaml` template (via `init_project.py
  --group`) — read by the app for grouping; ignored by
  `check_dsl_version.sh`/`regen_vscode_settings.py`. **Not** a top-level scalar `project:`. **Done
  (Lát 5)** — verified `regen` exits 0 + `check_dsl` reads `dsl_version` with the new key present.
- [x] Create `.claude/skills/dify-build/` with the 4-phase procedure (Q1) — the
  shared engine both the app and CLI users run. **Done (Lát 0.5):** `SKILL.md` +
  `analyze.md`/`spec.md`/`implement.md`/`test.md`.

### Nhịp 1 — Validate the 4-phase logic on stock claude-nexus (~2–3 days)

Before building the app, prove the **procedure** works, cheaply, on a runtime
that already exists:

- [ ] In stock nexus, create a task with `workingDir` = this repo; hand-write the
  Phase ① prompt (read a seed workflow → summarize → stop). Confirm the spawned
  Claude sees `.claude/` + `AGENTS.md`, and the scope allowlist lets it run
  `sync.py pull` + validators without blocking (Q E).
- [ ] Walk all 4 phases manually via nexus chat/reply, confirming each phase's
  prompt produces the right artifact and the stop behavior is workable.
- [ ] Lock down: phase prompt bodies, exact tool commands, artifact shapes, the
  diff-vs-seed format, the validate→fix loop. **Output of Nhịp 1 = the validated
  prompt templates + command list** that Nhịp 2 encodes.

> Rationale: the uncertain part is the *domain procedure*, not the app shell.
> Validate the procedure on a free runtime so the app is built around a known-good
> flow.

### Nhịp 2 — Build the dedicated app (~3–4 weeks)

**Week 1 — Backend core (spawn + gate)**: Fastify; spawn `claude` turn +
`stream-json` parser (copy the **transport shell** from nexus claude-session.ts,
re-implement turn-end + `session_id` capture — §A); **adapt** the SSE relay (not
a verbatim copy). The **phase state machine + gate are net-new** (§D) — build
them from scratch; this is the week's real work, not the copied transport.
`/api/tasks`, `/confirm`, `/reply`, `/stream`. Drive Phase ① + ② headless for one
seed workflow, no UI yet.

**Week 2 — Implement + Test phases**: slug/name proposal + `init_project.py`
scaffold; `generate_id.py` → instantiate YAML; validate→fix loop (cap 5, Q5) +
diff-vs-seed (phase ③); `sync.py push --yes` import + `report.json` + Cloud
fallback (phase ④). Note: **artifact-absent gating and the validate-loop cap land
WITH their phases here** (they are inseparable from the gate + Implement loop —
not deferred to Week 4). Exit check: a **curl/script harness drives
`/confirm`+`/reply` through all 4 gates headless** (no UI yet).

**Week 3 — UI** (Preact + Vite + TS, Q2): stand up the toolchain first
(lift `vite.config`/`tsconfig` from nexus, ~½d), then the SPA's **3 regions** —
Project▸Workflow▸Task sidebar (`/api/tree`), chat pane with settings-below-input
+ **inline gate buttons**, artifact/diff panel — **copying/adapting nexus client
components** (References): `ChatMessage`/`sse-client`/`ChatInputBar`/`useChatReply`
copy with light adapt; `InlinePermissionPrompt`+`PipelineTimeline` reuse the
visual shell but rewire to the out-of-band gate + 4 phases; the diff renderer
(`SplitDiffView`+`diff-parser`) copies near-verbatim; the sidebar tree and the
slim store are net-new (adapt nexus's `TaskList` grouping pattern + mine clean
fragments from `store.ts`). Seed selector via `sync.py list` (graceful when no
creds). (Net-new vs copy split per the effort analysis in Q2.)

**Week 4 — Hardening + polish + docs**: the recovery/robustness half of §I —
turn-timeout killer, restart recovery + per-phase idempotency, run-lock 409 (Q6),
SSE reconnect; security confinement + secret-redaction (§J, acceptance #23);
change-request `/reply` flow; per-build resume file; `.env.example`; README; run
all acceptance criteria; pre-commit on new repo files. (Basic error gating —
no-artifact/non-zero-exit — already landed in Weeks 1–2 with the gate.)

**Phase 3+ (out of MVP)**: more patterns beyond the first 1–2; multi-build
concurrency; optional autonomous toggle; richer DSL visualizer; GitOps
auto-commit of artifacts to `projects/<slug>/`.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Rebuilding nexus's spawn/stream/SSE is more work than expected | Medium | Schedule slip | Copy the spawn **transport shell** + adapt SSE (not verbatim); the net-new state machine is small; Nhịp 1 de-risks the procedure first |
| State machine + gate are net-new (not copyable from nexus) | Medium | Week 1 overrun | Budgeted as Week 1's real work (§Nhịp 2); the only moving part is "issue next turn on confirm" |
| Spawned turn hangs on a permission prompt | Low | Blocker | **`--permission-mode acceptEdits`** + `--setting-sources local` (no prompt, no host/project-hook hang — spike E1/E4 verified, exit 0); model C confinement is the post-turn #3b check, not a fail-fast allowlist |
| Opaque Bash write (`python -c`) escapes the deny carve-out | Medium | Out-of-confinement leak | The deny is defense-in-depth only; **#3b post-turn `git status` check reverts** any write outside `projects/<slug>/` + `.runs/<taskId>/` and fails the turn (spike E2d) |
| `sync.py push` hangs headless / duplicates the Dify app | Medium | Blocker / UX | Always pass `--yes`; document "import = new app" (Non-goal 8); report warns on edit-existing |
| Validate→fix loop doesn't converge | Medium | Bad UX in Implement | Cap + diagnostic (Q5) |
| Cloud can't auto-import (CSRF) | High (Cloud) | Degraded UX | Copy-YAML fallback (§G) |
| Seed pull endpoint shape varies across Dify versions | Medium | Analyze fails | `sync.py` already handles this; attach-YAML fallback |
| Session/transcript growth across 4 phases | Low–Med | Cost / context bloat | Per-phase handoff via artifact path, not full resume (Q3) |
| Engine produces subtly-broken YAML linters miss | Low | Broken app | Same linter bar as hand-authored; patterns pre-vetted |
| App scope creeps toward "nexus clone" | Medium | Effort blowup | Hold Non-goals; only the 4 phases + chat + diff + import |
| Adding `apps/` trips Python pre-commit/CI (e.g. check-yaml on package.json) | Medium | CI red | `exclude: ^(apps/|node_modules/)` + .gitignore (Nhịp 0); flat layout = no tooling change |

## References

### Project documents
- [AGENTS.md](../../AGENTS.md) — §3 build sequence, §4 conventions, §9 pitfalls
- [docs/specs/008-meta-workflow-builder.md](008-meta-workflow-builder.md) — sibling spec (Dify-in-Dify engine); shares patterns + import contract
- [docs/specs/003-variable-ref-linter.md](003-variable-ref-linter.md) — `lint_refs.py`
- [docs/specs/007-capability-docs-and-patterns.md](007-capability-docs-and-patterns.md) — pitfall log + plugin caps

### Reused tooling (already in repo)
- [tools/dify_base/sync.py](../../tools/dify_base/sync.py) — `list` (seed picker), `pull` (seed), `diff`, `push` (import); **Lát 5 adds `push --json-out`** (machine-readable import result for `app_id` capture)
- [tools/dify_base/init_project.py](../../tools/dify_base/init_project.py) — scaffold `projects/<slug>/` (flat); **Lát 5 adds `--group`** (→ `project.group` sub-key for app sidebar grouping)
- [tools/dify_base/find.py](../../tools/dify_base/find.py) — pattern/corpus search
- [skills/mango-svip/scripts/validate_workflow.py](../../skills/mango-svip/scripts/validate_workflow.py) — structure + schema validator
- [tools/dify_base/lint_refs.py](../../tools/dify_base/lint_refs.py), [tools/dify_base/lint_plugin_hashes.py](../../tools/dify_base/lint_plugin_hashes.py)
- [templates/patterns/](../../templates/patterns/) — the 5 vetted patterns

### Prior art (copied from / adapted, NOT a dependency)
- claude-nexus (`/Users/quyenbt/Desktop/MyProjects/claude-nexus`)
  - `src/server/lib/claude-session.ts` — **copy the transport shell** (spawn +
    NDJSON line-buffer; drop nexus env/MCP/multimodal, swap the logger);
    **re-implement** turn-end detection + `session_id` capture.
  - `src/server/lib/task-spawning.ts` — per-task spawn orchestration: **reference
    only**, do not copy (coupled to nexus internals).
  - `src/server/plugins/sse.ts` — SSE relay: **adapt** (coupled to nexus
    Container/auth/RingBuffer; lift the relay + backpressure, drop the wiring).
  - `src/server/lib/gate-token-validator.ts` — **does NOT apply** (inspiration at
    most): 009 gates out-of-band via `POST /confirm`, not an in-band token.
  - `docs/issues/079_pipeline_mode_enforcement_phase_review_gate.md` — the
    per-phase review gate nexus left unfinished; 009's backend-issues-the-turn
    design is exactly the structural fix #079 lacks.
- claude-nexus **frontend** `src/client` (Q2 stack = Preact + Vite + TS +
  @preact/signals; copy-targets, vendored — not a runtime dep). Copy/adapt
  verdicts from the 2026-06-09 effort measurement:
  - `components/ChatMessage.tsx` (389 LOC) — chat bubble: **copy + adapt** (keep
    bubble/markdown/activity-bar; drop synced-IDE/file-link/pins; bring or swap
    `lib/markdown.ts` to render stream-json).
  - `sse-client.ts` (200 LOC) — **copy + light adapt** (reuse connect/reconnect/
    jitter; keep `init`/`task:update`/`task:output`/`permission:*` events, drop
    the ~21 nexus-only event types + clientId/visibility).
  - `components/_chat/ChatInputBar.tsx` (142) + `hooks/useChatReply.ts` (145) —
    **copy near-verbatim** (pure props/callbacks; drop image fields if unused).
  - `components/InlinePermissionPrompt.tsx` (245) + `PermissionCard/Queue` — reuse
    the **visual shell** (button row / risk / timer / expand); **rewire** to 009's
    out-of-band `POST /confirm` gate (the in-band gate-token does not apply).
  - `components/PipelineTimeline.tsx` (143) — **copy + adapt** (reuse `PhaseBlock`
    + `formatDuration`; bind to 009's SSE-driven 4 phases instead of nexus's 5).
  - `components/SplitDiffView.tsx` (121) + `lib/diff-parser.ts` (327) — **copy
    near-verbatim** (language-agnostic unified-diff renderer for the YAML diff,
    given a backend-computed patch of `main.yml`).
  - `components/TaskList.tsx` (623) — **pattern reference** for the sidebar tree
    (reuse expand/collapse + grouping render; rewrite grouping to
    `project.group → projects/<slug>/ → .runs` and strip worktree/issue/git refs).
  - `store.ts` (981) / `api.ts` (688) — **mine fragments** into a slim ~250–350 LOC
    store + ~150–200 LOC api client (createTask/reply/cancel, SSE init wiring,
    `request()`/`qs()`); rename to 009's routes. signals reactivity is free here.
  - `styles/` (`chat_view.css` + inline-permission/gate-button + token `:root`
    block) — **copy + prune** (class names match 1:1; don't copy nexus-only chunks).
  - `vite.config.*`, `tsconfig*.json`, `package.json` scripts/devDeps — **lift +
    prune** for `apps/builder/web` (~1d one-time toolchain setup).

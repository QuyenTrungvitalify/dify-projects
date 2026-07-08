# Spec 052 — Promote a proven build to a reusable pattern, from the Builder (gated distill turn)

**Status**: Draft. **M–L**. The theme: spec 050 built the *mechanical* promotion gate (`promote_gate.py`) and
documented the *distillation* as a human-run `template-promote` skill invocation — but there is **no door in
the Builder UI**. A field user who just proved a build works has to drop to a CLI + a skill to turn it into a
house pattern. This spec adds that door: a **gated "Promote to pattern" flow** that runs the full 050
pipeline — eligibility gate → LLM distill turn → re-gate → candidate — and **parks at a review gate** where a
human sees the distilled pattern and **1-click Approves** before anything lands in `templates/patterns/`. The
distillation is automated (an LLM turn, exactly as the skill does it); the one irreversible step — writing to
the highest-precedence retrieval tier — stays human-gated, because *"promotion is the moment a mistake becomes
CONTAGIOUS"* (`promote_gate.py` docstring).

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-09.

**Builds on**: [050](050-proven-build-to-reusable-pattern-promotion.md) (the `promote_gate.py check`
eligibility gate — 4 linters + model-wiring + import-probe — and the `candidate` linter-rule channel D2/D4
drive wholesale; the `template-promote` skill's pattern-distillation procedure D3's turn prompt renders);
[009](009-browser-workflow-builder.md) (the phase/turn architecture — `PHASES`/`renderPrompt`/`runTurn`, the
gate state machine D3/D5 hook into; a `turn` phase reads a `.claude/skills/dify-build/*.md` body, spawns one
`claude` turn, writes an artifact, parks at a gate); [018](018-builder-turn-write-allowlist.md) (the PreToolUse
permission hook confines a turn's writes to its build roots — D6 leans on it so the distill turn CANNOT touch
`templates/` directly, only its staging root); [033](033-builder-gate-qa-chat-mode.md)/[034](034-builder-test-gate-terminal-qa.md)
(Ask/Request-changes gate mechanics D5 reuses); [035](035-builder-edit-again-from-done.md) (the same
`newTask({baseWorkflow})` resolution of a `{project, workflow}` pair the header pill reuses to identify the
promote source); [015](015-builder-security-turn-sandbox.md)
(D6: the source workflow is untrusted **DATA**, never instructions).

---

## Motivation — the highest-leverage artifact has no UI door

Spec 050 established the *optimal* reuse lever: distill **one proven `projects/` build** into a **generic
`templates/patterns/` pattern** (patterns rank highest in retrieval precedence — every future build of the
same shape benefits). It shipped the mechanical half (`promote_gate.py`: lint + model-wiring + real-Dify
import-probe → an `eligible` verdict) and the judgment half (the `template-promote` skill: replace domain
specifics with placeholders, blank the model, write `# GOTCHA:` lessons, stamp provenance). But both are
**CLI/skill-only**. A field user in the Builder who just watched their build go green — the *exact* moment a
build is "proven" (ran + tested, model wired) — has no button. The knowledge evaporates unless someone later
remembers to open a terminal.

Two things make this automatable now without loss of safety: (1) the distillation is precisely what an LLM
turn does — the Builder already runs gated LLM turns (Analyze/Spec/Implement) that read a skill body and write
an artifact; a "promote turn" is the same shape. (2) `promote_gate.py` already brackets that turn with a
mechanical eligibility check (before) and an output re-lint (after), so the turn's judgment is fenced by
deterministic gates on both sides. The only step that must stay human is the **final write to the curated
tier** — a bad distill (a mistranslated domain-bound workflow, a wrong placeholder) would teach the break to
every future build. So: automate the pipeline, park at a review gate, 1-click Approve to finalize.

## Decisions

- **D1 · One header affordance, one backend flow — `POST /api/promote` (proposed, committed).** A single
  "Promote to pattern" **ghost-pill in the detail-pane header** (`App.tsx`'s `.chat-top-right`, beside the
  `成果物`/language/theme pills) — always visible (not hover-gated), one place, covering every case. It renders
  whenever the current view has a **resolved on-disk workflow**: in the **conversation view** when
  `task.project`+`task.workflowSlug` are set and a `main.yml` has been produced (a proven/done build — the
  common trigger); and on the **new-task surface** when a base workflow is pre-selected via the sidebar
  workflow row (`editingSel.project`+`editingSel.workflow`) — so you can promote an existing repo workflow
  (incl. a spec-051 imported base, after it has been edited/proven) without opening a build. NOT the composer
  `ワークフロー` dropdown (a `<select>` can't host a per-item action) and NOT a sidebar hover action (the header
  is discoverable without hover). Click → `POST /api/promote { project, workflow }`, which starts a **new
  turn-bearing build kind** (`kind: 'promote'` on the Task), NOT a phase bolted onto an existing build — so the
  ①②③④ state machine is untouched (the 051 "separate route, no gate interaction" discipline).

- **D2 · B1 — the mechanical eligibility gate FIRST, no Dify side-effect (proposed, committed).** Before any
  turn, run `promote_gate.py check projects/<p>/<w>/workflows/<file> --json` via the existing `runPython`
  (which **strips `DIFY_*` from the child env** — so the gate's import-probe degrades to `skipped` and the
  button NEVER contacts Dify unexpectedly; the eligibility verdict rests on the 4 linters + model-wiring, which
  is the gating substance). A `eligible:false` verdict → **park immediately at a `blocked` gate** carrying the
  verbatim `reasons` (unwired model, a linter failure) — no turn is spawned, nothing is written. Rationale: the
  gate is cheap and deterministic; running the expensive LLM distill on an ineligible source wastes a turn and
  teaches nothing.

- **D3 · B2 — the distill LLM turn, writing to a STAGING path only (proposed, committed).** On `eligible:true`,
  spawn ONE `claude` turn whose prompt is a new `.claude/skills/dify-build/promote.md` body (rendering the
  `template-promote` pattern-distillation procedure — placeholders + `# TODO:` + `# GOTCHA:` header, blank the
  model, regen node IDs, a **retrievability-front-loaded `app.description`**, house-style rename). The turn:
  reads the source workflow as untrusted **DATA** (015 D6); writes the distilled pattern to a **staging root**
  `apps/builder/.runs/<taskId>/promote/<slug>.yml` — NOT `templates/patterns/`. The 018 write-allowlist
  **enforces** this: the turn's writable roots are its build roots, so a turn that tried to write `templates/`
  directly is denied by the permission hook — the curated write is structurally impossible from inside the turn
  (D6). The turn also emits the distillation notes (which gotchas are mechanical vs design) for D4 routing.

- **D4 · B2′+B3 — re-gate the output, route the candidate rules (mechanical) (proposed, committed).** After the
  turn, run `promote_gate.py check <source> --distilled <staged> --json` — the placeholder transform is the one
  step that can silently break a ref/schema, so re-linting the output is what carries the source's guarantee
  forward (050 D3.1). A non-clean output → park at a `distill_failed` gate with the reasons (the user Requests
  changes → re-run the turn). For each **mechanical** gotcha the turn surfaced, run
  `promote_gate.py candidate --rule "…" --citation "…"` (deduped); **design** gotchas stay in the pattern's
  `# GOTCHA:` header (and a human later logs them to AGENTS.md §9 — not automated, per 050 D2).

- **D5 · The review gate — human 1-click Approve is the ONLY path to `templates/patterns/` (proposed,
  committed).** On a clean re-gate the build parks at a `promote_review` gate showing: the staged pattern
  content (the artifact panel renders `promote/<slug>.yml`), the gate verdicts (both `eligible`, probe status),
  the proposed target path, and the candidate rules recorded. Actions: **Approve** → the backend **finalize**
  step (D6) stamps the `x-provenance` header, moves the staged file to `templates/patterns/<slug>.yml`, and
  runs `build_index.py` + `check_provenance.py`; **Request changes** (with a note) → re-run the distill turn
  (D3) against the same source, note-steered; **Discard** → terminal, staging swept, nothing written. Reuses
  the 033/034 gate-action machinery (Approve/Request-changes are explicit gate actions, never inferred from
  message text).

- **D6 · Finalize is a BACKEND move, gated by Approve — the curated write is never a turn (proposed,
  committed).** The move `staging → templates/patterns/` + provenance stamp + INDEX rebuild runs in the backend
  AFTER the human Approve action (like the ④ deploy step: outside any turn, so the permission hook can't and
  needn't gate it — the human gate is the control). Provenance follows the skill's `x-provenance` convention
  (LAST write, `source=original license=MIT spec=052 known_good_dify=<from B1 verdict>`). Confinement: the
  target basename is `sanitizeSlug`-derived and joined under `templates/patterns/` (no `..`); a collision with
  an existing pattern → the gate offers overwrite-vs-rename (never silent clobber). INDEX/provenance rebuilds
  are the same commands the skill runs.

## Non-goals

- **No fully-unattended write to `templates/patterns/`.** The human Approve gate (D5) is mandatory — the
  contagion risk (050) is the whole reason the gate exists. (A `--auto` escape hatch is OQ1, explicitly
  deferred.)
- **Not `templates/library/`** (the corpus-example curated tier) — that stays the human `template-promote`
  skill against `corpus/` (022 D5). This spec promotes a **proven `projects/` build**, the 050 D1 target.
- **No bulk / batch promotion** — one build per run (the skill's discipline).
- **Not a change to `promote_gate.py`** — D2/D4 call it as-is; any new mechanical rule goes through its
  `candidate` channel, never a fork (050 D2a).
- **No auto-promotion from the spec 051 upload modal** — a raw upload is unproven; promotion starts only from a
  *proven* build/workflow (051 D4 stands; this spec is its principled counterpart, one lifecycle stage later).

## Acceptance criteria

1. *(D1)* The detail-pane header shows a "Promote to pattern" pill whenever the view has a resolved on-disk
   workflow — an open/done build (`task.project`+`task.workflowSlug` + produced `main.yml`) OR the new-task
   surface with a base pre-selected from the sidebar (`editingSel`). It is absent on a from-scratch new task
   (workflow `none`). Click → POST `/api/promote {project, workflow}` and opens the promote build.
2. *(D2)* A source with an **unwired model** (empty `provider`/`name` on an `llm` node) → parks at `blocked`
   with `promote_gate.py`'s verbatim model-wiring reason; **no turn spawned, nothing written**. The gate makes
   **no Dify network call** (probe `skipped` — `DIFY_*` stripped by `runPython`).
3. *(D3)* An eligible source → a distill turn writes ONLY `apps/builder/.runs/<id>/promote/<slug>.yml`; an
   attempt by the turn to write under `templates/` is denied by the permission hook (write-allowlist), verified
   by a confinement test.
4. *(D4)* A distilled output that fails re-lint → parks at `distill_failed` with the linter's verbatim message;
   `templates/patterns/` is untouched. A surfaced mechanical rule lands in `docs/linter-candidates.md` (deduped).
5. *(D5)* At `promote_review`, **Approve** is the only action that writes `templates/patterns/<slug>.yml`;
   before Approve the file does not exist there. Request-changes re-runs the distill; Discard writes nothing.
6. *(D6)* On Approve: the pattern lands with an `x-provenance` header (`spec=052`, `known_good_dify` from the
   B1 verdict), `build_index.py` re-ran (INDEX lists it), `check_provenance.py` reports `current`. A slug
   collision is surfaced (overwrite/rename), never silent.
7. Server + web suites green; no change to the ①②③④ state machine, `/api/tree`, or `promote_gate.py`.

## Sequencing

- **S1** — D2 backend: `POST /api/promote` + the B1 gate (`promote_gate.py check --json` via `runPython`) +
  the `blocked` gate; the `kind:'promote'` Task shape. Unit tests AC1/2. Shippable behind the endpoint before
  any turn wiring.
- **S2** — D3/D4 the distill turn: `promote.md` skill body + a `promote` turn kind in the orchestrator (read
  body → render → `runTurn` → stage) + the B2′ re-gate + B3 candidate + the `distill_failed` gate. Tests AC3/4
  (confinement, re-gate reject).
- **S3** — D5/D6 the review gate + finalize: the `promote_review` gate (artifact panel renders the staged
  pattern) + Approve→finalize (provenance stamp + move + INDEX/provenance rebuild) + Request-changes/Discard.
  Tests AC5/6.
- **S4** — frontend: the header "Promote to pattern" pill (D1, shown on the `promotable` predicate) + the
  promote build's gate cards (blocked / distill_failed / promote_review) + JA i18n. AC1/7.

## Open questions

- **OQ1** — A power-user `--auto` (skip the D5 review, write directly) for a trusted operator? Deferred — the
  contagion risk makes gated the safe default; revisit only if the review step proves a bottleneck in use.
- **OQ2** — Should the sidebar-workflow-row entry (D1b) re-check "proven" (require a prior green build/test on
  that workflow) or trust the B1 model-wiring gate as the proxy? Lean **trust B1** — an unwired model is the
  concrete "never ran" signal; requiring build history is friction and state we don't track per-workflow.
- **OQ3** — Surface the `import-probe` verdict at the review gate by running B1 a second time WITH creds
  (unstripped) so the human sees a real-Dify OK before Approve? Advisory; lean yes as a follow-up (a "run
  probe" button on the review gate), not in the hot path (keeps the button Dify-free by default).

## Revision log

- r1 (2026-07-09) — initial draft. Emerged from the 051 review: a field user asked for auto-distillation of an
  uploaded YAML. Clarified the lifecycle split — a raw upload is unproven (051 D4 keeps it out of `templates/`);
  the principled counterpart is promoting a *proven build*, which 050 already tooled mechanically. Committed to
  a gated LLM distill turn (automate the pipeline, human-gate only the contagious final write) per the design
  decisions: review-gate + 1-click Approve; a single header ghost-pill in the detail pane as the entry (the
  `ワークフロー` composer dropdown and a sidebar hover action were earlier ideas, corrected — a `<select>` can't
  host a per-item action, and the always-visible header beats a hover). Reuse
  is maximal (050 `promote_gate.py` + `template-promote` procedure, 009 turn/gate machinery, 018 write-allowlist
  confinement, 035 foot-action slot) so no new gate FSM and no change to `promote_gate.py`.

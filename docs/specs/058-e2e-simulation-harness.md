# Spec 058 — E2E simulation harness + `/e2e` skill: Claude tests the Builder like a real user

**Status**: **Implemented** (2026-07-15 — r3). Landed same-tree: `e2e_check.py` (predicate
evaluator, 3-bucket) + `e2e-run.sh` (fire/wait/confirm/reply/cancel/time/bench/check/suite) +
`e2e-suite.yml` (6 entries) +
`tests/fixtures/e2e/` + `tests/test_e2e_check.py` (16 tests green) + skill `.claude/skills/e2e/` +
docs (AGENTS §7, README, this index). Verified OFFLINE: `check` on the spec-057 AC2 golden run
→ 6 AUTO-PASS / 0 AUTO-FAIL / 3 MANUAL; the negative entry AUTO-FAILs with exit 1. **AC1 verified
LIVE (2026-07-15, run 1784117328337)**: `fire --entry trigger-schedule` → `wait` walked
①→②→③→④=done → `check` 6 AUTO-PASS / 0 AUTO-FAIL / 3 MANUAL; the 4 linters re-run independently
0/0/0/0, import-probe OK. The first live fire surfaced **two real runner bugs** (offline tests
could not catch them): (1) `api()` set `HTTP_CODE` inside a `$(...)` subshell, lost to the caller →
fixed to set globals `RESP`/`HTTP_CODE` and call `api` without command substitution; (2) mutations
need `-H "Origin: http://127.0.0.1:<port>"` (spec 015 D6 CSRF defense, index.ts:122) → added. It
also confirmed the r3 design: with `deploy: none` the trigger-enable note is NOT in `report.notes`
(report.ts:198 gates it to selfhost/cloud), which is exactly why the suite carries it as a `manual:`
item. **Full-suite sweep run LIVE (2026-07-15)** — all 6 entries fired end-to-end:
`trigger-schedule` PASS 6/0/3 · `negative-no-trigger` PASS 3/0/1 (start node, no trigger) ·
`fast-single-llm` PASS 4/0/1 · `lang-sync-vi` PASS 2/0/1 · **`excel-per-row-notify` AUTO-FAIL 1/1/2**
— a real finding, NOT a harness bug: the ③implement turn on a 6-node file→extract→iterate→template→
code build hit the **600s default `TURN_TIMEOUT_MS`** (orchestrator.ts:49, raisable via
`BUILDER_TURN_TIMEOUT_MS`, spec 048); the harness surfaced it correctly via the spec-045 triage note
+ `retry` gate action (this is AC3 demonstrated live) · **`edit-existing` AUTO-FAIL 1/1/2** — a sweep
artifact, not a defect: the entry is `mode: each_step` + needs a base workflow, so it parked at ①
awaiting review and the unattended auto-sweep cancelled it to free the turn lock (the entry's own
`manual:` notes document this). Net: 4 clean PASS, 1 real product finding (heavy-build timeout), 1
setup-required entry. **Adversarial review (2026-07-15, 16-agent workflow, verify-per-finding)**:
10 findings confirmed + 2 refuted, all folded — bench masked `fire` failures as exit 0 (rc read
echo's status), a `wait` timeout aborted `bench` before timing, missing-value flags crashed under
`set -u`, `compute_timing` mislabelled a ⚡fast build's merged analyze+spec turn, a non-object
artifact and a scalar (bracket-less) predicate crashed / false-passed `e2e_check.py`, plus 4 doc
nits. Fixes + 4 new guard tests landed; 16/16 e2e tests + full `pytest` green. **Still pending**:
AC2 (`each_step` walk + Request-changes) as an attended run; AC4 (fresh-session `/e2e` dispatch) is
inherently manual.
r2 folded the operational review (0 blockers, 5 amendments; the 4-agent review workflow hit the
usage limit, so the checks ran first-hand). **r3 folds the user directive: "auto-test as much as
possible; whatever CANNOT be auto-tested must be reported back after each run"** — the three-bucket
verdict contract (S1 `check`, S2 `manual:`, S3, AC7): AUTO-PASS / AUTO-FAIL / MANUAL, MANUAL never
silent.
**Effort**: S–M (S1 runner = S, S2 suite = S, S3 skill = S, S4 docs = XS)
**Depends on**: `/report` skill (the grading engine — reused, not reinvented), spec 009 gate API,
spec 045 (turn-failure notes the runner must surface), spec 021 (sibling, NOT superseded — see
Non-goals)

## Context

Verifying an improvement today means a human types a prompt into the Builder UI, walks the gates,
then reads the artifacts. This session did that flow twice by hand (spec 056 AC1, spec 057 AC2):
fire a build over HTTP, follow it, read `analyze.json` / `SPEC.md` / `main.yml` / `report.json`,
grade against a checklist. It works — but the procedure lives in one session's head. A NEW session
asked to "test this prompt" would re-derive the API, the artifact paths, and the grading rubric
from scratch, and grade inconsistently.

**What already exists (verified):**

- `apps/builder/scripts/demo-gates.sh` — curl helpers against the real backend:
  `start_build(requirement, confirm_mode)` posts `{requirement, confirm_mode, deploy:"none"}` to
  `POST /api/tasks`; gate driving via `/confirm`; `show()` extracts
  `{taskId,phase,status,gate.flag,gate.actions[].id}`. Built for spec-009 QA — it drives gates but
  has no poll-until-done, no artifact collection, no evaluation.
- `.claude/skills/report/SKILL.md` — the mature grading engine: grades a run **against its
  REQUIREMENT** (ground truth secondary), reads per-phase transcripts not just artifacts, enforces
  the two-tier honesty contract (static vs runtime), and already accepts `/report <taskId>`.
- The Builder API is the SAME path a human uses (composer → `POST /api/tasks`) — a harness build is
  not a parallel test mode; its outputs are exactly what a user would have gotten.

**What's missing is glue + persistence:** a one-command runner, a machine-checkable expectation
format, and a skill so ANY future session executes the same procedure with the same rubric.

## Goals

- **G1 — one command fires a simulated user session**: `e2e-run.sh "<prompt>"` (auto) or a
  step-wise mode where Claude reviews each gate before confirming (deep simulation, including
  Request-changes).
- **G2 — machine-checkable per-phase expectations**: a suite file where each prompt carries
  structural checks (`analyze.features contains trigger`, `main.yml has no start node`,
  `report notes contain import-probe OK`) evaluated mechanically; content quality delegated to
  `/report`.
- **G3 — persistence across sessions**: an `/e2e` skill teaching the full procedure + rubric +
  caveats, so "test prompt X" works identically in any future session.
- **G4 — operational reality**: the harness handles the real failure modes (backend down, claude
  not logged in, turn-busy 409, phase timeout) with actionable messages, and is honest about cost
  (every build spends real `claude` subscription turns).

## Non-goals

- **Not CI automation** — each simulated build burns 2–4 real `claude` turns (minutes +
  subscription usage); this is an on-demand tool, never a per-commit hook. Spec 021 (creds-gated
  pytest with hard assertions) remains the CI-able sibling; 058 feeds it learnings, doesn't replace
  it.
- Not parallel execution (the Builder's turn lock serializes turns by design — the suite runs
  sequentially and says so up front).
- Not UI-pixel testing (Chrome driving stays ad-hoc; this harness is API+artifact level).
- Not a new grading engine — content judgment is `/report`'s job; the harness only adds
  structural PASS/FAIL checks.

## Design

### S1 — runner `apps/builder/scripts/e2e-run.sh` (S)

Small idempotent subcommands (NOT a long-lived daemon — each invocation is one Bash step, matching
how a Claude session operates), reusing demo-gates.sh helper style (`curl -fsS` + `jq`,
`BUILDER_BASE` env, jq-built bodies):

- `e2e-run.sh fire "<requirement>" [--mode auto|each_step] [--fast] [--project <slug>]`
  → POSTs `/api/tasks` (wire fields review-verified: `requirement`, `confirm_mode`, and `--fast`
  maps to `fast_mode` — routes/tasks.ts:167 accepts `fast_mode`/`fast`), prints `{taskId}`; on 409
  prints the holder taskId and exits with a distinct code (turn lock busy); on connection refused
  prints "backend not running — cd apps/builder && npm start".
- `e2e-run.sh wait <taskId> [--timeout-min 20]` (default 20 — an auto build is up to 3 turns ×
  the 10-min `BUILDER_TURN_TIMEOUT_MS` ceiling, so worst-case exceeds any sane wait; the timeout
  expires CLEANLY with the current phase/status printed and a DISTINCT exit code — callers can
  tell "still running, re-invoke wait" from "settled"; `wait` is safely re-invokable)
  → polls `GET /api/tasks/:id` until `status ∈ {awaiting_confirm, error, done, cancelled}`;
  prints a one-line phase progress trail; exits 0 with a summary JSON:
  `{taskId, phase, status, gate: {flag, actions}, artifacts: {analyze, spec, workflow, report},
  notes}` where artifact values are RESOLVED paths (`apps/builder/.runs/<id>/analyze.json`;
  `SPEC.md` — **review-verified resolution order**: `projects/<p>/<slug>/SPEC.md` FIRST (a
  scaffolded/completed run keeps only that copy — the AC2 golden run has no `.runs` SPEC), falling
  back to `.runs/<id>/SPEC.md` for pre-slug parked builds; `projects/<p>/<slug>/workflows/<file>`;
  `.runs/<id>/report.json`). On `status=error`, echo the spec-045 triage note verbatim
  (**verified**: turn-runner.ts:162 produces it and it lands in `task.error` — one jq field).
- `e2e-run.sh confirm <taskId> [actionId]` / `reply <taskId> "<feedback>"` / `cancel <taskId>` —
  wrappers over `/confirm`, `/reply`, `/cancel`. **Review finding: `/confirm` REQUIRES `{actionId}`**
  (routes/tasks.ts:245) — when the arg is omitted the wrapper auto-picks ONLY the plain `continue`
  advance action from `gate.actions[]` (a deliberate safety narrowing — never `accept`/`import`/
  `retry_live`/`discard`, which are judgment calls); if the gate has no `continue` it prints the
  available action ids and exits 2, so any other advance is passed explicitly. `/reply` posts
  `{text}`; `/cancel` frees the turn lock (used by the sweep when a build parks).
- `e2e-run.sh time <taskId>` / `bench "<prompt>"` — **timing (r3 add-on, user-requested)**:
  per-phase + total wall-clock for a run, so a speed optimization has a before/after number. Derived
  OFFLINE with NO polling and NO backend timing field (the backend persists none): the taskId IS the
  fire time in epoch-ms (13-digit id), and each phase artifact's mtime is that phase's completion
  instant (analyze.json → SPEC.md → main.yml → report.json). `time` is post-hoc on any finished run;
  `bench` chains fire→wait→timing+check. Caveat surfaced in the skill: single runs carry LLM latency
  variance — compare medians of ≥3 runs. Baseline observed on the sweep: `implement` dominates
  (~55–70% of total; 84–386s across runs), which is where a speedup should aim.
- `e2e-run.sh check <taskId> --expect <suite-entry-id>` — evaluates the S2 checks for that entry
  and prints the **three-bucket verdict table** (r3 contract): **AUTO-PASS / AUTO-FAIL / MANUAL**.
  Delegates to `e2e_check.py` (the suite is YAML and pytest must unit-test the predicates — that
  wants Python; the API-driving stays bash). Bucket rules: a mechanically evaluated predicate is
  AUTO-PASS/AUTO-FAIL; a MISSING artifact is AUTO-FAIL (the build demonstrably didn't produce it);
  an UNKNOWN predicate key degrades to MANUAL with a reason instead of crashing (the suite may
  grow vocabulary ahead of the runner — flexibility, not error); the entry's `manual:` items are
  echoed as MANUAL verbatim. Exit 0 iff zero AUTO-FAIL; MANUAL never affects the exit code but is
  ALWAYS printed — silence about untested surface is a bug. Artifact paths come from
  `task.json.artifacts` (review-verified: the task state already resolves
  analyze/spec/implement/report to real paths, including the project-dir SPEC.md), so `check`
  works OFFLINE from `.runs/<id>/task.json` with no backend running; the resolution order above
  is the fallback for pre-artifact states.
- Failure surfacing: when `status=error`, echo the gate's spec-045 triage note verbatim (usage
  limit / not logged in / network / CLI missing) — the runner never re-diagnoses.

### S2 — suite file `apps/builder/scripts/e2e-suite.yml` (S)

One entry per regression prompt; expectations are mechanical predicates over the artifacts:

```yaml
- id: trigger-schedule
  prompt: 毎朝9時に https://jsonplaceholder.typicode.com/todos?userId=1 のJSONを取得して…
  mode: auto
  expect:
    analyze:  { features_include: [trigger], pattern: scheduled-fetch-notify }
    workflow: { grep_absent: ["type: start"], grep_present: ["type: trigger-schedule", "timezone: Asia/Tokyo"] }
    report:   { notes_include: ["all linters passed"] }
  manual:   # r3 — echoed verbatim as MANUAL after every run; the harness never silently drops these
    - "Enable the trigger in Dify Studio Quick Settings and confirm the 9:00 JST fire (S5 deferred — no API)"
    - "UI: the JA trigger-entry note renders on the test card (NOTE_JA frame)"
- id: negative-no-trigger
  prompt: 入力されたテキストを3行に要約するワークフローを作ってください
  expect:
    analyze:  { features_exclude: [trigger] }
    workflow: { grep_present: ["type: start"] }
```

Initial suite (~6 entries): trigger-schedule, excel-upload (056 AC1 shape), negative-no-trigger,
fast-mode single-LLM, edit-existing (uses `--project` + base), JP/VI language-sync check. The
check vocabulary starts intentionally tiny: `features_include/exclude`, `pattern`,
`grep_present/absent` (workflow), `notes_include` (report), plus per-entry `manual:` (free-text
items the harness KNOWS it cannot verify — echoed as MANUAL) and `deploy:`/`fast:`/`mode:` fire
parameters (`e2e-run.sh fire --entry <id>` reads prompt + parameters straight from the suite, so
a session never re-types the canonical prompt) — extensible later, YAGNI now. Deploy-dependent
expectations must respect the code: TRIGGER_ENTRY_NOTE only reaches `report.notes` on
`selfhost`/`cloud` deploys (report.ts:198) — a `deploy: none` entry must NOT expect it (that
would be a false AUTO-FAIL); the default suite keeps `deploy: none` (no app created in the
user's Dify) and carries the note check as a MANUAL item instead.
Review-verified against the AC2 golden artifacts: `analyze.json` carries `features` (array) +
`pattern` (string) exactly as assumed; **`report.json.notes` is a single STRING** →
`notes_include` is a substring test, not array membership; `grep "type: start"` has no false
positive on a trigger workflow (edge `sourceType:` capital-T doesn't match; `iteration-start`
doesn't contain the literal).

### S3 — skill `.claude/skills/e2e/SKILL.md` (S)

Frontmatter + procedure in the house skill style (the `/report` skill is the template):

- **Triggers**: `/e2e "<prompt>"`, `/e2e --suite`, or the user asking "test prompt … như người
  dùng thật".
- **Procedure**: fire → wait → (each_step: read the gate artifact, grade it AGAINST the phase
  rubric, then confirm or reply — the reviewer role) → check structural expectations → invoke
  `/report <taskId>` for content grading → emit the fixed verdict table (per-phase PASS/FAIL +
  one-line evidence each), **always ending with a MANUAL-residue section**: every item the run
  could NOT verify automatically (suite `manual:` items, degraded unknown predicates, runtime
  caveats like trigger-enable) — reported to the user after EVERY run, never silently dropped
  (r3 directive: "auto-test as much as possible, report the rest").
- **Rubric summary per phase** (the checklist used for 056 AC1 / 057 AC2, written down): ① digest
  language matches requirement, trigger-surface named, pattern/features sane; ② SPEC declares the
  056/057 rules it triggers; ③ artifact passes linters, entry/nodes match design; ④ report honest
  (notes vs verdict), import-probe result.
- **Caveats box**: Builder must be running + `claude` logged in; turn lock (serial); COST — each
  build 2–4 real turns, warn before running a suite (>3 entries needs explicit user go-ahead);
  builds land in gitignored `projects/_drafts/` (no cleanup needed); re-grade later with
  `/report <taskId>` without re-running.

### S4 — docs (XS)

- AGENTS.md §7 (test commands): one line pointing at `e2e-run.sh` + the `/e2e` skill.
- README roadmap: one bullet (spec 058). No count pins are touched (a skill and a script are not
  patterns/hooks) — verify with the drift tests anyway.

## Open questions

- **OQ1** — Runner language: bash+jq (matches demo-gates.sh, zero new deps) vs Node (.mjs, typed
  against the API). *Proposed: bash+jq — the consumers are Claude sessions and humans, both fluent
  in reading shell output; demo-gates proves the idiom works.*
- **OQ2** — Should `fire` support attachments/base-workflow for edit-existing suite entries?
  *Proposed: `--project`/`--base` pass-through only; file attachments deferred.*
- **OQ3** — Fold the 12-prompt campaign manifest into the suite now or keep separate? *Proposed:
  keep separate; add a `--manifest #N` convenience later when the campaign re-run happens.*
- **OQ4** — demo-gates.sh: leave as-is (QA scenarios) or refactor shared helpers into a sourced
  lib? *Proposed: leave as-is for v1; duplication of 5 tiny helpers is cheaper than a refactor
  risking the QA script.*

## Acceptance criteria

1. `e2e-run.sh fire "<trigger prompt>" --mode auto` + `wait` + `check --expect trigger-schedule`
   reproduces the spec-057 AC2 verdict end-to-end with PASS on every structural check, with the
   Builder running and no manual step besides invoking the commands.
2. `each_step` flow: fire with `--mode each_step`, `wait` parks at the ① gate, Claude reads the
   digest artifact, `confirm` advances — repeat to done; `reply` demonstrably re-runs a phase
   (one scripted Request-changes in the suite).
3. Failure modes produce actionable one-liners: backend down; 409 turn-busy (prints holder);
   `status=error` echoes the spec-045 triage note verbatim; `wait --timeout-min` expires cleanly.
4. The `/e2e` skill file exists, appears in the session skills listing, and a FRESH session given
   only `/e2e "<prompt>"` executes the procedure and emits the fixed verdict table (manual check —
   this IS the persistence goal).
5. Suite file parses; `check` evaluates every vocabulary predicate correctly. **Review finding:
   `.runs/` and `projects/_drafts/` are both gitignored**, so the AC2 golden run only exists on
   this machine — commit small SANITIZED fixture copies (analyze.json, report.json, a trimmed
   main.yml) under `tests/fixtures/e2e/` so the predicate logic stays testable on any clone
   (pytest unit test over `check`'s predicates), while live `check` runs use the real local run.
6. No existing test/hook regresses: `pytest tests/` green (no count pins touched), builder
   `npm test` untouched (runner is a script, not server code), `check_agents_refs.sh` passes with
   the new AGENTS.md pointer (same-commit rule).
7. **Three-bucket contract (r3)**: every `check` run ends with the AUTO-PASS / AUTO-FAIL / MANUAL
   table; an entry with an unknown predicate key + a `manual:` list produces MANUAL rows and exit
   code 0 when nothing auto-failed (unit-tested); the `/e2e` skill's final user-facing message
   includes the MANUAL-residue section verbatim.

## References

- Manual precedents this codifies: spec 056 AC1 review (2026-07-13) and spec 057 AC2 review
  (2026-07-15) — the per-phase rubric in S3 is exactly the checklist used there.
- `apps/builder/scripts/demo-gates.sh` — API idiom + helpers (spec 009 Lát 3).
- `.claude/skills/report/SKILL.md` — grading engine + two-tier honesty contract (reused as-is).
- [021](021-builder-e2e-live-run-verification.md) — the CI-able sibling (creds-gated pytest);
  [045](045-turn-failure-triage.md) — triage notes the runner surfaces verbatim.

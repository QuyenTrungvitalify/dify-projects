# Spec 060 — Cost-regression gating in the e2e harness: turn 059 cost into a mechanical speed guard

**Status**: **Implemented** (2026-07-16 — r2). A 19-agent adversarial review of the DRAFT folded 6
findings (`total_*` over a partial cost map must AUTO-FAIL not silently pass; `cache_min_pct` denom=0
→ MANUAL; drift one-sided so improvements always pass; render_cost prints numbers only, not a cause;
opt-in single-sourced on the `cost:` block; expected-phase set incl. fast-mode key mapping) — all in
the code. Landed: `evaluate_cost`/`_eval_drift`/`build_baseline` + `--baselines`/`--save-baseline` in
`e2e_check.py`; `cmd_check` passes `--task-json`/`--fast`/`--baselines` and no longer `exec`s;
`bench --entry` runs `check`; a `cost:` block on the `trigger-schedule` suite entry; 15 new pytest
(cost thresholds, total-over-partial→FAIL, denom-0→MANUAL, missing→MANUAL, malformed, fast-phase,
one-sided drift, baseline roundtrip) — green; live-verified on run 1784128896068 (5 auto-pass,
regression → AUTO-FAIL, save-baseline→drift 0%→simulated +100%→FAIL). A second 7-agent adversarial
review of the IMPLEMENTATION folded 3 more "never crash" fixes (a non-numeric `cache_min_pct` /
`output_tokens_max` map value, and a corrupted non-dict baseline entry, now all degrade to
AUTO-FAIL/no-drift instead of a traceback) + 2 guard tests → 33/33 e2e green. Test-side only —
**no app/UI change**. Claude authored this spec; implementation followed on the user's go.
**Effort**: S (S1 predicate ≈ S, S2 baseline/drift ≈ S, S3 bench-runs-check ≈ XS, S4 skill/docs ≈ XS)
**Depends on**: spec 058 (the e2e harness: `e2e_check.py` three-bucket evaluator, `e2e-run.sh`
check/time/bench, the suite), spec 059 (`task.json.cost` per-phase capture — the data this gates on).

## Context — division of labor

Spec 059 makes per-phase cost legible. The **app** owns the human-facing side of that: a build's
timing + cause + HINT is rendered in-app (the DEV cost widget). This spec is the **test-side
counterpart**: turn the same `task.json.cost` data into a **mechanical regression guard** so a change
that slows builds down (or breaks caching) FAILS a test — without duplicating the app's display.

> **App = "why is this build slow" (interactive display, per build).
> e2e harness = "did a change make builds slower" (mechanical assert, per suite entry).**
> Same 059 data, two jobs; they must not diverge (the harness asserts numbers, it does not re-narrate
> the cause — that is the app's job).

Today the split is: `check` = correctness only (three-bucket over analyze/workflow/report), `time`/
`bench` = performance DISPLAY only (timing + the 059 cost table). **Cost is never gated** — a build
that suddenly takes 40 tool-loop turns instead of 20 passes every test. This spec closes that: cost
becomes an opt-in fourth predicate section in the suite, evaluated into the same three-bucket verdict.

**Verified against code (2026-07-16):**
- `KNOWN_PREDICATES` in `e2e_check.py` = `{analyze, workflow, report}` — no `cost`. `check` does not
  read `task.json.cost`.
- `task.json.cost` (059) is a per-phase map `{analyze, spec, implement, test?}`, each with
  `numTurns, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, durationMs,
  apiDurationMs, totalCostUsd, at` (confirmed on a real run: analyze `numTurns:17, cacheRead:305896`).
- `render_cost` (059) prints ONLY the per-phase NUMERIC table (turns / in_tok / out_tok / cacheRead /
  cache%) in the terminal — it does **not** name a cause (the cause narration + HINT is the app
  widget, per G4). This spec does not touch `render_cost` — it adds a separate ASSERT path.
- `cmd_bench` runs fire → wait → `time` only (NOT `check`; its comment was corrected in this branch).

## Goals

- **G1 — a `cost:` predicate section** in a suite entry, evaluated by `e2e_check.py` into AUTO-PASS /
  AUTO-FAIL rows in the existing three-bucket table. Opt-in per entry: no `cost:` block ⇒ no gating
  (this is the "not always check performance" requirement — cost stays off unless an entry declares
  a threshold). A pre-059 run (no `task.json.cost`) ⇒ the cost rows degrade to **MANUAL**, never a
  false AUTO-PASS (the contract's "never silently green").
- **G2 — baseline + drift**: `e2e-run.sh check … --save-baseline` records the entry's current cost
  profile to a committed `e2e-baselines.json`; a later `check` with a baseline present flags **drift**
  (e.g. `implement numTurns 20 → 34, +70%`) as AUTO-FAIL beyond a threshold. This is the automated
  before/after the mtime `time` table can only show by eye.
- **G3 — `bench --entry <id>` runs `check`** (fold correctness + the cost gate into the one-command
  path), fixing the stale "one command" promise. A raw-prompt `bench "<text>"` still does
  timing+cost only (nothing to check against without a suite entry).
- **G4 — stay in lane**: no app change, no new cost UI, no cause re-naming. The harness asserts
  thresholds; the app narrates causes.

## Non-goals

- **NOT the app's cost display / cause widget** — 059 + the app own it. This spec never renders a
  human "why" narrative; it emits mechanical PASS/FAIL rows only.
- **NOT auto-tuning thresholds or baselines** — thresholds are hand-set per entry; a baseline is
  updated deliberately (`--save-baseline`), like a snapshot test. No statistical model.
- **NOT gating raw ad-hoc prompts** — a one-off `bench "<prompt>"` has no declared threshold to
  grade against; it shows the profile, full stop. Gating requires a saved suite entry (by design).
- **NOT a new capture** — reads `task.json.cost` as-is; if 059 didn't record it, the row is MANUAL.

## Design

### S1 — the `cost:` predicate section (S)

In `e2e_check.py`, add `cost` to the vocabulary and a reader that pulls `task.json.cost` (NOT an
artifact file — so `check` gains a `--task-json` input, which `cmd_check` already has the path for).
Predicate keys (all optional; kept tiny, YAGNI):

```yaml
- id: trigger-schedule
  # ...existing analyze/workflow/report predicates...
  cost:
    implement_turns_max: 25       # AUTO-FAIL if cost.implement.numTurns > 25 (lint→fix churn guard)
    total_turns_max: 60           # sum of numTurns over the EXPECTED phase set (below)
    cache_min_pct: 80             # AUTO-FAIL if any expected phase's cache% < 80% (cold-start guard)
    output_tokens_max: { implement: 12000 }   # per-phase output ceiling (generation-bound guard)
```

**Expected phase set** — the phases a completed build MUST have recorded, so a missing one is a
FAILURE signal not a silently-dropped term. It is `{analyze, spec, implement}` for a normal build and
`{spec, implement}` for a ⚡fast build (spec 028: the merged draft turn records under the `spec`
key, `analyze` is absent by design). Phase ④ `test` is **always excluded** (059 S1: it runs no
`claude` turn, so `cost.test` is structurally absent — including it would make every gate MANUAL/0).
The runner reads `task.fastMode` (as `cmd_time` already does) to pick the set.

Evaluation rules (mechanical, no LLM — same discipline as the other sections; each rule states its
verdict for the missing-data case so nothing is left to the implementer):

- **Per-phase predicate** (`implement_turns_max`, `output_tokens_max.<phase>`): the phase-dict absent
  OR the field not a finite number ⇒ **MANUAL** ("no cost for phase X" / "no numTurns for phase X").
  Present + finite ⇒ AUTO-PASS/FAIL vs the threshold. Detail carries the number
  (`cost.implement_turns_max  20 ≤ 25 ✓`).
- **`total_*` aggregate**: sum over the EXPECTED phase set (above). If ANY expected phase's metric is
  not a finite number (phase-dict absent — e.g. implement's turn died with no `result` per spec 045 —
  OR the field absent on a present dict), the total is **AUTO-FAIL** with reason "build incomplete:
  phase X has no numTurns" — **never AUTO-PASS, never a MANUAL that exits 0**. A total you cannot
  fully compute over a build that should have finished is a failing build, not an unknown.
- **`cache_min_pct`**: for each expected phase, `denom = inputTokens + cacheReadTokens`. If either
  token field is absent (059 records a turn that returned no `usage` as duration/turns only — denom
  would be 0) ⇒ that phase's row is **MANUAL** ("no token data for phase X"), never a divide-by-zero
  crash and never a false cold-start FAIL. `cache% = cacheRead / denom`; `cacheCreationTokens` is NOT
  counted (a cache-*warming* phase legitimately has high creation + ~0 read, and gating it as
  cold-start would false-FAIL the first spawn in a fresh TTL window — so the predicate documents that
  it measures cache *reuse*, and an entry that expects a cold first phase simply omits `cache_min_pct`
  or scopes it, e.g. `cache_min_pct: { implement: 80 }`).
- **Wholly missing `task.json.cost`** (pre-059 run) ⇒ every declared cost predicate is **MANUAL**
  ("no cost captured — pre-059 run") — never AUTO-PASS.
- **Unknown cost key** ⇒ MANUAL (same as the other sections' unknown-key rule).
- **Non-list/scalar shape** where a map/number is expected ⇒ AUTO-FAIL ("predicate X expects …"),
  mirroring the S1 arg-shape guard already in `evaluate_entry` (058 review).
- `cause_*` predicates are **out of scope**: the cause label ("tool-loop") is the app's narration;
  the harness gates on the raw numbers that IMPLY it (`cache_min_pct` ⇒ cold-start,
  `implement_turns_max` ⇒ tool-loop) — so the two never disagree on wording.

**Integration note**: `cost` is NOT a file artifact, but `evaluate_entry` today branches per section
on `path.is_file()`. The `cost` section takes a separate branch that reads the already-parsed
`task.json.cost` map (passed in alongside the artifact paths) — it does not go through the
file-load/`is_file` path. Spell this out at implement time so the non-file section is a clean
special-case, not bolted onto the artifact loop.

### S2 — baseline + drift (S)

- `e2e-run.sh check <taskId> --expect <id> --save-baseline` writes/updates
  `apps/builder/scripts/e2e-baselines.json`: `{ "<entry-id>": { "implement": {"numTurns":20,
  "outputTokens":6421}, "total": {"numTurns":53}, "at": <ms> } }` (a small committed snapshot).
- A `check` (or `bench --entry`) that finds a baseline for the entry emits **drift rows**. Drift is
  **ONE-SIDED — only a regression fails**:
  - new > baseline by **more than +D%** ⇒ AUTO-FAIL: `cost.drift[implement.numTurns]  20 → 34  (+70%)  ✗ > +40%`
  - within +D% ⇒ AUTO-PASS
  - **any improvement (negative drift), regardless of magnitude** ⇒ AUTO-PASS with `↓ faster`:
    `cost.drift[implement.numTurns]  20 → 11  (−45%)  ↓ faster`
  Default `D = 40%` on `numTurns` (the most stable signal; token counts vary with the prompt);
  overridable per entry (`cost: { drift_pct: 25 }`). The `±` band is deliberately NOT used — a large
  legitimate speedup must never trip the gate. Baseline metric not a finite number, or the phase
  present in baseline but absent in the new run (or vice versa) ⇒ that drift row is **MANUAL**
  ("baseline/current mismatch for phase X"), never a spurious ±∞% fail.
- The baseline is a **committed snapshot**: a legitimate speed change updates it with
  `--save-baseline` (reviewed in the diff), exactly like a golden-file test. No baseline for an
  entry ⇒ no drift rows (first run just records with `--save-baseline`).
- **Opt-in is single-sourced on the `cost:` block**: drift rows are emitted ONLY for an entry that
  declares a `cost:` block. An entry with NO `cost:` block produces zero cost rows even if a stale
  baseline exists for it (the baseline is ignored) — so "no `cost:` ⇒ no cost gating" holds for both
  thresholds and drift (closes the G1/AC1 opt-in gap).
- **LLM-variance caveat** (documented in the skill): one run's `numTurns` wobbles; the ±40% default
  is deliberately generous to catch gross regressions, not noise. For a tight before/after, the
  operator takes the median of ≥3 runs (the skill says so) before trusting a small delta.

### S3 — `bench --entry` runs `check` (XS)

`cmd_bench`: when invoked with `--entry <id>`, after `wait` run `cmd_check <taskId> --expect <id>`
THEN `cmd_time`, so the one-command path gives correctness + cost gate + the timing/cost table
together. A raw-prompt `bench "<text>"` keeps today's behavior (fire→wait→time; no `check`, since
there is no entry to check against). Update the `cmd_bench` comment to match.

### S4 — skill + docs (XS)

- `.claude/skills/e2e/SKILL.md`: one paragraph — cost gating is **opt-in** via a `cost:` block in
  the suite; `check`/`bench --entry` surface cost rows only when the entry declares thresholds; the
  interactive "why slow" narrative lives in the app, not here; the one-sided +40% drift default
  (improvements always pass) + median-of-≥3 variance caveat.
- `docs/specs/README.md`: a row for 060.
- No pattern/hook count pins touched (verify with the drift tests anyway).

## Open questions

- **OQ1 — baseline home**: committed `e2e-baselines.json` (proposed — stable CI, diff-reviewed like a
  snapshot) vs gitignored per-machine. *Proposed: committed; a cost regression should show up in
  review, and updating the snapshot is an explicit, visible act.*
- **OQ2 — drift metric**: gate on `numTurns` only (proposed — the tool-loop-churn signal, least
  prompt-sensitive) vs also `outputTokens`/`durationMs`. *Proposed: `numTurns` is the default
  gated metric; others are opt-in per-entry ceilings (S1), not drift-gated, because they vary more.*
- **OQ3 — default drift threshold**: +40% one-sided (proposed, noise-tolerant) vs tighter. *Proposed:
  +40%, overridable per entry (`cost: { drift_pct: 25 }`); documented as gross-regression detection;
  improvements never fail regardless of size.*
- **OQ4 — should `check` need `--task-json`?** `cmd_check` already resolves artifact paths from
  `.runs/<id>/task.json`; the cost reader needs that same `task.json` (for `.cost`). *Proposed:
  `cmd_check` passes `--task-json` to `e2e_check.py` (mirrors what `cmd_time` already does post-059),
  so `check` reads cost with zero new caller burden.*

## Acceptance criteria

1. A suite entry with a `cost:` block evaluates each predicate into an AUTO-PASS / AUTO-FAIL row in
   the three-bucket table; an entry with NO `cost:` block produces zero cost rows **even if a stale
   baseline exists for it** (opt-in single-sourced on the `cost:` block). Unit-tested.
2. Missing-data verdicts, each unit-tested: (a) wholly missing `.cost` (pre-059) ⇒ all cost rows
   **MANUAL**; (b) a `total_*` over a cost map where an EXPECTED phase (analyze/spec/implement, or
   spec/implement in fast mode) is absent or numTurns-less ⇒ **AUTO-FAIL** "build incomplete", NOT
   AUTO-PASS and NOT an exit-0 MANUAL; (c) `cache_min_pct` on a phase that recorded turns but no
   tokens (denom = 0) ⇒ **MANUAL** "no token data", never a crash or false cold-start FAIL.
3. A malformed cost predicate (unknown key; a scalar where a map/number is expected) degrades to
   MANUAL / AUTO-FAIL as the section rules dictate — never a crash, never a false green. Unit-tested.
4. `check … --save-baseline` writes `e2e-baselines.json`; a subsequent `check` emits **one-sided**
   drift rows: a regression beyond +D% ⇒ AUTO-FAIL; within +D% ⇒ AUTO-PASS; ANY improvement (any
   negative drift, incl. −45%) ⇒ AUTO-PASS `↓ faster`; a baseline/current phase mismatch ⇒ MANUAL.
   Unit-tested against fixture baselines.
5. `bench --entry <id>` runs `check --expect <id>` (three-bucket incl. cost) AND the timing/cost
   table; `bench "<raw prompt>"` runs timing/cost only. The `cmd_bench` comment matches.
6. No regression: `pytest tests/` green (no count pins), builder `npm test` untouched (test-side
   script + suite only, no server code), `check_agents_refs.sh` passes with any new doc pointer.
7. The `/e2e` skill documents cost gating as opt-in + the app-owns-narration boundary + the
   variance/median caveat; `docs/specs/README.md` has a 060 row.

## References

- [058](058-e2e-simulation-harness.md) — the harness this extends (three-bucket evaluator, suite,
  `check`/`time`/`bench`).
- [059](059-phase-cost-instrumentation.md) — `task.json.cost` per-phase capture (the gated data) and
  the app-side display this deliberately does not duplicate.
- `apps/builder/scripts/e2e_check.py` — `KNOWN_PREDICATES` (where `cost` joins), `render_cost` (the
  059 NUMERIC-only display path, left untouched — it does not name a cause);
  `apps/builder/scripts/e2e-run.sh` — `cmd_check`/`cmd_bench`.

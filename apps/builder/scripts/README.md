# e2e harness — how to use it

Drive the Builder the way a real user does — fire a prompt, walk the gates, grade the result — but
scripted, so you (or any Claude session) can regression-test a change and watch build **speed**
without clicking through the UI.

- `e2e-run.sh` — the runner (curl + jq against the local API).
- `e2e_check.py` — the mechanical grader (three-bucket + cost).
- `e2e-suite.yml` — saved regression prompts + their expectations.

## Prerequisites

- **Backend running**: `cd apps/builder && npm start` (or `npm run dev`). Needed for `fire`/`wait`/
  `confirm`/`reply`/`bench`; `check`/`time` work OFFLINE from `apps/builder/.runs/<id>/task.json`.
- **`claude` logged in** — every build spends **2–4 real subscription turns** (minutes each).
- **`jq`** on PATH.
- **For cost data (059/060)**: the running server must include the cost-capture code. If you just
  pulled/edited it, **rebuild + restart** first — the DevPanel "rebuild" button (`POST /api/dev/rebuild`)
  or `npm run build && npm start`. A pre-capture run shows cost rows as MANUAL ("no cost captured").

## Command cheat-sheet

| Command | What it does | Costs turns? |
|---|---|---|
| `e2e-run.sh fire "<prompt>" [--mode auto\|each_step] [--fast] [--deploy none\|selfhost\|cloud]` | start a build, print `{taskId}` | ✅ |
| `e2e-run.sh fire --entry <id>` | fire a saved suite prompt | ✅ |
| `e2e-run.sh wait <taskId> [--timeout-min 20]` | poll until settled, print a summary | — |
| `e2e-run.sh confirm <taskId> [actionId]` | advance a gate (auto-picks only `continue`) | — |
| `e2e-run.sh reply <taskId> "<feedback>"` | send a phase back (Request-changes) | ✅ (re-runs a phase) |
| `e2e-run.sh cancel <taskId>` | cancel, free the turn lock | — |
| `e2e-run.sh check <taskId> --expect <id> [--save-baseline] [--suite <path>]` | three-bucket verdict (+cost gate) — OFFLINE | — |
| `e2e-run.sh time <taskId>` | per-phase + total wall-clock (+cost table) — OFFLINE | — |
| `e2e-run.sh bench "<prompt>" \| bench --entry <id>` | fire→wait→[check for `--entry`]→timing/cost | ✅ |
| `e2e-run.sh suite` | list suite entry ids | — |
| `e2e-run.sh userview <taskId>` | rebuild what the USER saw (EN approximation — spec 063) | — |
| `e2e-run.sh comprehension <taskId>` | jargon/comprehension gate over the user-facing notes (spec 063) | — |

Exit codes: `0` ok · `1` a check AUTO-FAIL · `2` usage · `3` backend unreachable · `4` turn busy
(409) · `5` wait timeout (re-invocable) · `6` API error.

## Common workflows

### 1. Test a prompt like a real user (from scratch)

```bash
e2e-run.sh bench "毎朝9時に … を取得して要約しPOSTして"
```
One command: fires, walks ①→④, prints the timing + cost profile. (A raw prompt has no saved
expectations, so it shows performance, not a correctness verdict — see #2 for that.)

### 2. Regression-check a saved prompt (correctness)

```bash
e2e-run.sh fire --entry trigger-schedule       # → taskId
e2e-run.sh wait  <taskId>
e2e-run.sh check <taskId> --expect trigger-schedule
```
`check` prints the **three-bucket** table: **AUTO-PASS** (held) / **AUTO-FAIL** (broke) / **MANUAL**
(can't auto-verify — runtime, UI, trigger-enable; always reported, never dropped). Exit 0 iff zero
AUTO-FAIL. Or in one shot: `e2e-run.sh bench --entry trigger-schedule` (runs `check` too).

### 3. Watch build speed / find the slow phase

```bash
e2e-run.sh time <taskId>
```
Two tables: **timing** (how long each phase took, from mtimes) and **cost** (turns / tokens /
cache% — the "why"). `implement` usually dominates (~55–70%). To interpret WHY it's slow (tool-loop
vs generation vs cold-start), read the number in the **app's** cost widget — the harness only reports
numbers, it doesn't narrate the cause.

### 4. Before/after a speed fix (automated, no eyeballing)

```bash
# before the fix — record the baseline
e2e-run.sh check <taskId> --expect trigger-schedule --save-baseline

# … make your change, rebuild+restart, re-run the build …

# after — check picks up the baseline and flags drift
e2e-run.sh check <taskId2> --expect trigger-schedule
#   cost.drift[implement.numTurns]  20 → 13  (−35%)  ↓ faster     ← improvement always passes
#   cost.drift[implement.numTurns]  20 → 34  (+70%)  ✗ > +40%     ← regression AUTO-FAILs
```
Drift is **one-sided**: only a regression past +40% (per-entry `drift_pct`) fails; any speedup passes.
Baselines live in a committed `e2e-baselines.json` (diff-reviewed like a golden file).
⚠️ One run's turn count wobbles — compare **medians of ≥3 runs** before trusting a small delta.

### 5. Gate build cost in the suite (opt-in)

Add a `cost:` block to a suite entry — it's the ONLY thing that turns cost gating on for that entry:

```yaml
- id: trigger-schedule
  expect: { … }
  cost:                       # omit this block ⇒ no cost gating for this entry
    implement_turns_max: 40   # AUTO-FAIL if ③ churns way past its ~20-turn norm
    total_turns_max: 90
    cache_min_pct: 50         # AUTO-FAIL if prompt-caching stops hitting
    # output_tokens_max: { implement: 12000 }
    # drift_pct: 25           # override the +40% default
```

## The suite file (`e2e-suite.yml`)

One entry per regression prompt. Vocabulary:
- `analyze: { features_include/exclude: [..], pattern: <name> }`
- `workflow: { grep_present/absent: [..] }` (substring over `main.yml`)
- `report: { notes_include: [..] }` (substring — `report.json.notes` is one string)
- `cost: { implement_turns_max, total_turns_max, cache_min_pct, output_tokens_max, drift_pct }` (opt-in)
- `manual: [ "<thing to verify by hand>", … ]` (echoed as MANUAL, always reported)
- fire params: `prompt`, `mode` (auto|each_step), `fast`, `deploy`, `project`

Unit-tested by `tests/test_e2e_check.py` against sanitized fixtures in `tests/fixtures/e2e/` (real
runs under `.runs/` and `projects/_drafts/` are gitignored).

## Gotchas

- **`deploy: none`** (suite default) creates NO app in your Dify — nothing to clean up. The
  trigger-enable note only lands on `selfhost`/`cloud`, so trigger entries carry it as a `manual:` item.
- **Serial**: the Builder turn lock runs builds one at a time; a suite sweep is sequential.
- **Not CI**: on-demand only (real turns). Spec 021 is the creds-gated CI sibling.
- **Cost is opt-in**: no `cost:` block ⇒ zero cost rows; a pre-059 run ⇒ MANUAL, never a false pass.

## For an AI session

Type `/e2e "<prompt>"` (or `/e2e --entry <id>`, `/e2e --suite`) — the `e2e` skill teaches the full
fire→wait→gate→check→`/report` procedure + the fixed verdict table with the mandatory MANUAL residue.

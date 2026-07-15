---
name: e2e
description: Simulate a real user session against the Builder — fire a prompt over the API, walk the gates, and grade the result mechanically, so any session can "test this prompt như người dùng thật" with the same procedure and rubric. Use when the user types "/e2e \"<prompt>\"", "/e2e --entry <id>", "/e2e --suite", or asks you to test a Builder improvement the way they would by typing a prompt. Reuses /report for content grading; the harness adds structural PASS/FAIL and — the core contract — auto-tests as much as possible and REPORTS everything it could not verify (never silently drops it).
---

# /e2e — Builder end-to-end simulation harness (spec 058)

Runs the exact flow a human does — composer prompt → `POST /api/tasks` → gates → artifacts — but
scripted, so an improvement can be regression-tested in any session without re-deriving the API,
the artifact paths, or the grading rubric. A harness build is NOT a parallel test mode: its outputs
are exactly what a user would have gotten.

## The one contract that matters: auto-test as much as possible, report the rest

Every run ends with a **three-bucket verdict**, and the third bucket is never silent:

- **AUTO-PASS** — a structural predicate evaluated mechanically and held.
- **AUTO-FAIL** — a predicate evaluated mechanically and failed (a MISSING artifact is AUTO-FAIL).
- **MANUAL** — everything that can't be auto-verified: runtime behavior, UI rendering, trigger
  enablement, and any suite predicate the runner's vocabulary doesn't know yet (it degrades to
  MANUAL with a reason instead of crashing). **Always report the MANUAL bucket to the user** — it
  is the honest list of "what I could not test for you."

## Prerequisites (state them, don't assume)

- Backend running: `cd apps/builder && npm start` (or `npm run dev`). `fire`/`wait`/`confirm`/
  `reply` need it; `check` works OFFLINE from `apps/builder/.runs/<id>/task.json`.
- `claude` logged in — every build spends **2–4 REAL subscription turns** (minutes each). Warn
  before a suite; running >3 entries needs an explicit user go-ahead (COST).
- `jq` on PATH. Runner: `apps/builder/scripts/e2e-run.sh`; evaluator: `e2e_check.py`; suite:
  `e2e-suite.yml`.

## Two orthogonal "modes" (don't conflate them)

A build has TWO independent switches — set each from the request:

- **`--mode auto | each_step`** = the GATE-stopping axis (confirm_mode). `auto` walks ①②③④ without
  stopping; `each_step` parks at every gate for review. Default `auto`.
- **`--fast`** = the ⚡ **Fast build** axis (spec 028), a genuinely different, faster build path:
  the run STARTS at ② (a merged analyze+draft turn), so it spends fewer LLM turns — meant for
  simple **single-LLM** workflows. It self-guards: if the shape turns out non-trivial (features not
  all `llm`), the backend flags *"Fast build found a non-trivial shape — review before continuing"*
  (§5). Fast is force-OFF for seed/edit/slug builds. Default OFF (normal 4-phase).

They compose: `auto` + `--fast`, `each_step` + normal, etc. The `fast-single-llm` suite entry is
`auto` + `fast: true`.

**Intent mapping — if the user's request implies fast creation, PASS `--fast`.** Vietnamese/JP/EN
cues: "tạo nhanh", "nhanh gọn", "fast build/create", "⚡", "chỉ 1 LLM", "đơn giản một node LLM",
「速く」「シンプルに」. (Don't force `--fast` on a clearly multi-node ask — http/code/iteration/trigger —
say so and build normal; the §5 guard would stop a fast build there anyway.)

## Procedure

1. **Fire.** Single prompt: `e2e-run.sh fire "<prompt>" [--mode auto|each_step] [--fast]
   [--deploy none|selfhost|cloud] [--project <slug>]`. Suite entry (prompt + parameters come from
   the suite): `e2e-run.sh fire --entry <id>`. **Add `--fast` when the request implies fast creation
   (see Intent mapping above).** Prints `{taskId}`. On 409 the turn lock is busy (exit 4, prints the
   holder); on connection refused it tells you to start the backend (exit 3).
2. **Wait.** `e2e-run.sh wait <taskId> [--timeout-min 20]` polls until settled
   (`awaiting_confirm|error|done|cancelled`), printing a phase trail, then a summary JSON. Timeout
   exits **cleanly with code 5** (still running — just re-invoke `wait`), NOT an error. On
   `status=error` it echoes the spec-045 triage note verbatim — never re-diagnose it.
3. **each_step only — be the reviewer.** At each gate, READ the phase artifact (path is in the
   summary's `artifacts`), grade it against the rubric below, then `e2e-run.sh confirm <taskId>`
   to advance (auto-picks ONLY the `continue` action — anything else is a judgment call you must
   pass explicitly) or `e2e-run.sh reply <taskId> "<feedback>"` to send it back a phase.
4. **Check (structural).** `e2e-run.sh check <taskId> --expect <suite-id>` prints the three-bucket
   table. Exit 0 iff zero AUTO-FAIL. This is pure jq/grep/Python — no LLM, no cost, re-runnable.
5. **Report (content).** Invoke `/report <taskId>` for the two-tier honesty grading (static vs
   runtime) — the harness does structure; `/report` judges quality. Don't reinvent it.
   - **Timing (speed work).** `e2e-run.sh time <taskId>` prints per-phase + total wall-clock,
     derived OFFLINE from the taskId (fire time, ms) + artifact mtimes — repeatable, no polling.
     `e2e-run.sh bench "<prompt>"` does fire→wait→timing+check in one shot. Use it to get a
     before/after number when optimizing build speed; `implement` is usually the dominant phase.
     Caveat: single runs carry LLM latency variance — compare medians of ≥3 runs, not one pair.
6. **Emit the verdict.** One table: per-phase ①②③④ PASS/FAIL with one-line evidence, then the
   AUTO-PASS / AUTO-FAIL / **MANUAL-residue** section. The MANUAL section is mandatory even when
   everything auto-passed.

## Per-phase rubric (the checklist codified from spec 056 AC1 / 057 AC2)

- **① Analyze** — digest language matches the requirement (JA prompt → JA digest, VI → VI); the
  trigger surface is named when the prompt is self-running (毎日・毎朝・定期・スケジュール・自動で・
  〜をトリガーに・webhook); `pattern`/`features` are sane; from-scratch ⇒ `seed:null`.
- **② Spec** — the node table covers every requirement point; the pattern is justified and
  *reduced* when lean; trigger rules declared (Asia/Tokyo explicit, ≤1 schedule) when applicable.
- **③ Implement** — YAML passes the 4 linters; node IDs are 13-digit quoted strings; every
  `{{#id.field#}}` names a declared upstream output; entry/nodes match the design.
- **④ Test** — report honest (notes vs verdict, two tiers never blurred); import-probe result
  surfaced; for a trigger entry, the manual-enable note is present.

## Suite (`apps/builder/scripts/e2e-suite.yml`)

One entry per regression prompt. Vocabulary: `analyze:{features_include/exclude,pattern}`,
`workflow:{grep_present/absent}`, `report:{notes_include}` (substring — `report.json.notes` is one
string), plus `manual:` (free-text items echoed as MANUAL) and fire parameters
(`prompt,mode,fast,deploy,project`). Ships with: `trigger-schedule`, `negative-no-trigger`,
`excel-per-row-notify`, `fast-single-llm`, `edit-existing`, `lang-sync-vi`. Deploy defaults to
`none` (no app created in the user's Dify); the trigger-enable-note check lives in `manual:` there
because `TRIGGER_ENTRY_NOTE` only reaches `report.notes` on selfhost/cloud (report.ts:198).

Add an entry when a new capability ships: give it the prompt, the mechanical `expect` predicates
you CAN check, and a `manual:` list of everything you can't. Unit-tested by
`tests/test_e2e_check.py` against sanitized fixtures in `tests/fixtures/e2e/` (since `.runs/` and
`projects/_drafts/` are gitignored).

## Caveats box

- **Cost**: 2–4 real turns per build. Confirm before a suite run (>3 entries).
- **Serial**: the Builder turn lock serializes builds — the suite runs one at a time.
- **No cleanup needed**: builds land in gitignored `projects/_drafts/`. Re-grade later with
  `/report <taskId>` or re-`check` without re-running (offline).
- **Not CI**: this is on-demand. Spec 021 (creds-gated pytest) is the CI-able sibling.
- **Trigger runtime**: a `/workflows/run` (and the ④ live test) is a MANUAL fire; the schedule
  only auto-runs after the user ENABLEs the trigger in Dify Studio Quick Settings (S5 deferred).

## Stop

After the verdict table + MANUAL residue, STOP. `/e2e` fires, follows, and grades; it does not
edit the build or the app.

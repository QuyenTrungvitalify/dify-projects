# Spec 059 — Phase cost instrumentation: capture per-phase token/duration to target the Implement bottleneck

**Status**: **Implemented** (2026-07-15). Landed: `PhaseCost` type + `Task.cost`
([state/task.ts](../../apps/builder/server/state/task.js)); the pure guarded reader
`costFromResult` ([lib/cost.ts](../../apps/builder/server/lib/cost.js)) + 5 unit tests
([test/cost.test.ts](../../apps/builder/test/cost.test.ts)); capture wired in `runPhase` after the
turn settles ([orchestrator.ts](../../apps/builder/server/lib/orchestrator.js)) — rides the existing
success/gate saves, `null` on a dead turn records nothing; `cost` reaches the wire for free via
`toWireTask`'s spread (AC5). Surface: `e2e_check.py render_cost` + `--task-json`, printed under the
mtime table by `e2e-run.sh time` (S2), + 3 pytest cases. **S3 baseline is NOT filled yet** — it needs
ONE live suite sweep (real `claude` turns + a running backend), which this authoring session cannot
run; the Baseline section stays TBD until then, and AC7 is the only open criterion. **OQ4 still
stands**: confirm `usage.cache_read_input_tokens` naming against a real captured `result` line before
trusting the baseline (the reader degrades to null on a miss, so nothing crashes — but the numbers
would silently read `—`).
**Effort**: S (S1 capture ≈ XS, S2 surface ≈ S, S3 baseline write-up ≈ XS, S4 docs ≈ XS)
**Depends on**: spec 009 (turn-runner + `TurnResult.result`), spec 058 (`e2e-run.sh time`/`bench` —
the mtime wall-clock this upgrades), spec 045 (turn-failure notes — a dead turn has no `result`, so
capture must tolerate `null`).

## Context

The user wants the build workflow **faster without hurting quality**. The honest first move is to
know where the time goes — and half of that is already done:

- **Spec 058 already measures wall-clock per phase.** `e2e-run.sh time <taskId>` derives per-phase
  duration OFFLINE from artifact mtimes (`analyze.json → SPEC.md → main.yml → report.json`), and the
  058 sweep recorded the baseline verbatim: **`implement` (Phase ③) dominates — ~55–70% of total,
  84–386s across runs.** So the bottleneck phase is known.
- **What we CANNOT see yet is WHY ③ is slow.** mtime tells us *how long*, not *what consumed it*.
  The three candidate causes have completely different fixes:
  1. **Output-token-bound** — generating the full workflow YAML is inherently large output (output
     tokens are the slow axis).
  2. **Tool-loop-bound** — the implement turn writes YAML, runs the linters, then fixes and re-runs;
     each lint→fix cycle is another round of tool calls + output.
  3. **Cold-start-bound** — every phase spawns a FRESH `claude` process
     ([claude-session.ts:142](../../apps/builder/server/lib/claude-session.ts#L142)); if prompt
     caching isn't hitting across those spawns, each turn re-pays full input-token price for the
     skill + repo files it reads.

**The data to tell these apart is already flowing through the code and being thrown away.** The
`claude` stream-json terminal `result` event carries `duration_ms`, `duration_api_ms`, `num_turns`,
and a `usage` object with `input_tokens` / `output_tokens` / **`cache_read_input_tokens`** /
`cache_creation_input_tokens`. `turn-runner.ts` already captures that whole event as
`TurnResult.result`
([turn-runner.ts:30](../../apps/builder/server/lib/turn-runner.ts#L30)) — `runPhase` receives it
([orchestrator.ts:412](../../apps/builder/server/lib/orchestrator.ts#L412)) and simply never
persists it. `ClaudeStreamEvent` is `{ type, subtype?, [key]: unknown }`
([claude-session.ts:49](../../apps/builder/server/lib/claude-session.ts#L49)), so the fields are
readable today with a typed read + presence guard.

This spec captures that per phase. It is **pure observability — zero behavior change, zero quality
risk** — and it directly answers the diagnostic question above, so the *next* spec optimizes the
proven cause instead of guessing. The `cache_read_input_tokens` field alone is decisive: if it is
~0 across phases, cold-start is paying full price and the fix is "keep the prompt prefix identical +
within the cache TTL"; if it's high, caching already works and the lever is elsewhere.

## Goals

- **G1 — capture per-phase cost** from the already-present `result` event: `durationMs`,
  `apiDurationMs`, `numTurns`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
  `cacheCreationTokens` (and `totalCostUsd` when present). Persist to `task.json` keyed by phase.
  Tolerate a missing `result` (a dead/timed-out turn records nothing rather than crashing).
- **G2 — surface it** so a human/session reads it without re-deriving: extend `e2e-run.sh time` to
  print the captured token/turn table alongside its existing mtime wall-clock, and expose the field
  on `GET /api/tasks/:id`.
- **G3 — establish a WHY-level baseline** on the ③ bottleneck: run the 058 suite once, write the
  token/turn/cache breakdown into this spec's "Baseline" section, and name which of the three causes
  the numbers point to — the input the follow-up optimization spec keys on.

## Non-goals

- **NOT the optimization itself.** This spec makes the bottleneck legible; the fix is a follow-up
  spec chosen FROM this data (see "Candidate levers" — none are pre-committed here). Shipping a
  speed change blind is exactly what this avoids.
- **NOT any change to phase behavior, prompts, or gates.** No phase prompt is touched, no turn is
  added or removed, no artifact format changes — so there is no path by which build quality moves.
  (This is why the format-change idea was rejected earlier: it touched the artifact the LLM consumes;
  this touches only what we RECORD about a turn.)
- **NOT a new model call.** The data comes from the turn that already ran; instrumentation spends
  zero extra `claude` turns.
- **NOT cross-phase session resume.** `--resume` exists but is unused for phase chaining by design
  (each phase is deliberately a fresh, minimally-scoped context); resuming would bloat context and
  risk quality. If the baseline shows cold-start dominates, the *follow-up* weighs caching options —
  not this spec.

## Design

### S1 — capture in `runPhase` → persist to `task.json` (XS)

1. Add a `PhaseCost` type + a `cost` map to `Task`
   ([state/task.ts](../../apps/builder/server/state/task.js), beside `sessionIds`/`artifacts`):

   ```ts
   export interface PhaseCost {
     durationMs?: number;        // result.duration_ms — total turn wall-clock (CLI-reported)
     apiDurationMs?: number;     // result.duration_api_ms — model API time only
     numTurns?: number;          // result.num_turns — internal tool-loop iterations (③ lint→fix signal)
     inputTokens?: number;       // usage.input_tokens
     outputTokens?: number;      // usage.output_tokens — the slow/expensive axis
     cacheReadTokens?: number;   // usage.cache_read_input_tokens — cold-start-cache decisive field
     cacheCreationTokens?: number;
     totalCostUsd?: number;      // result.total_cost_usd — may be absent on a subscription login
     at?: number;                // taskId-style capture stamp (Date.now at persist)
   }
   // On Task, next to sessionIds/artifacts:
   cost?: { analyze?: PhaseCost; spec?: PhaseCost; implement?: PhaseCost; test?: PhaseCost };
   ```

2. A tiny pure reader `costFromResult(result: ClaudeStreamEvent | null): PhaseCost | null` (new,
   in turn-runner.ts or a `cost.ts` sibling — unit-testable in isolation): returns `null` when
   `result` is null or has no usable fields; otherwise reads the fields above with `typeof … ===
   'number'` guards (the `usage` sub-object likewise guarded). No throw on a shape it doesn't
   recognize — a schema drift degrades to `null`/partial, never a crash (same leniency discipline as
   `analysis.ts`).

3. In `runPhaseAndGate` (right after `runPhase` returns the `TurnResult`,
   [orchestrator.ts:260](../../apps/builder/server/lib/orchestrator.ts#L260)): if
   `costFromResult(verify.turn?.result)` is non-null, set `task.cost[phaseId] = cost` and let the
   existing `saveTask` write it (no NEW save call if one already runs on that boundary — piggyback).
   A `/reply` re-run of a phase OVERWRITES that phase's cost (last run wins) — document it; the sum
   of a build's costs is then "the work that produced the final artifacts", which is what a
   before/after speed comparison wants.
   - **Test phase caveat**: Phase ④ is backend-run (live-test, no `claude` turn) per
     [orchestrator.ts:107](../../apps/builder/server/lib/orchestrator.ts#L107), so `cost.test` stays
     undefined here — the live-test's own token count already lands via `run.totalTokens`
     ([live-test.ts:378](../../apps/builder/server/lib/live-test.ts#L378)); do NOT double-count it.

### S2 — surface the numbers (S)

- **`e2e-run.sh time <taskId>`** (spec 058): today it prints mtime wall-clock per phase. Add a
  second table read straight from `task.json.cost` — per phase: `numTurns`, `inputTokens`,
  `outputTokens`, `cacheReadTokens`, and a `cache-hit%` = `cacheRead / (cacheRead + input)`. Keep
  the mtime table (it's the only wall-clock source and needs no backend); the cost table is the
  "why". Both stay OFFLINE-readable from `.runs/<id>/task.json`.
- **`GET /api/tasks/:id`**: include `cost` in the task snapshot (it's already on the persisted
  Task; just don't strip it) so a UI or `/report` run can read it without touching disk.
- No new UI surface is required for v1 (the number's first consumer is the optimization decision,
  not an end user) — a FE badge is a YAGNI follow-up.

### S3 — establish the baseline + name the cause (XS)

Run the 058 suite once (`e2e-run.sh` fire→wait over the ~6 entries, or reuse a fresh sweep), then
write into the **Baseline** section below, per phase: median `numTurns`, `outputTokens`,
`inputTokens`, `cacheReadTokens`, `cache-hit%`, and `apiDurationMs / durationMs`. Then state which
cause ③ points to, using these decision rules:

- **`numTurns` on ③ is high (many internal iterations)** → tool-loop-bound (lint→fix churn). Lever:
  raise first-pass correctness so fewer fix cycles (better SPEC seeding / template match) — a
  quality-*positive* change (fewer defects AND faster).
- **`outputTokens` on ③ dominates and `numTurns` is low** → generation-bound. Lever is limited
  (the YAML has to be emitted); focus shifts to not RE-emitting it (fewer whole-file rewrites).
- **`cacheReadTokens` ≈ 0 across phases** → cold-start pays full input price every spawn. Lever:
  stabilize the prompt prefix + keep spawns within the cache TTL (a caching-side change that never
  touches artifact content — quality-safe).

Only ONE of these becomes the follow-up spec, chosen by the numbers — not pre-committed here.

### S4 — docs (XS)

- `docs/specs/README.md` index: one line for 059.
- AGENTS.md §7 / the 058 `/e2e` skill caveats box: one line that `e2e-run.sh time` now also prints
  a token/turn/cache breakdown (same-commit `check_agents_refs.sh` rule).
- No pattern/hook count pins are touched (verify with the drift tests anyway).

## Baseline (filled by S3 on first run)

> _TBD — populated when S3 runs. Table: phase × {numTurns, inputTok, outputTok, cacheReadTok,
> cache-hit%, apiMs/totalMs}. Then: "③ is <cause>-bound → follow-up spec targets <lever>."_

## Open questions

- **OQ1** — Field home: a `cost` map on `Task` (proposed — mirrors `sessionIds`/`artifacts`, one
  atomic `saveTask`) vs a separate `.runs/<id>/cost.json` artifact (parallels `criteria.json`).
  *Proposed: on `Task` — it's small, per-phase, and read together with the rest of the task state;
  a separate file buys nothing here.*
- **OQ2** — On a `/reply` phase re-run, overwrite that phase's cost (last-run-wins, proposed) vs
  accumulate an array of attempts. *Proposed: overwrite — the question this data answers is "what
  did the winning build cost"; attempt history is a heavier feature nobody asked for (YAGNI).*
- **OQ3** — Is `total_cost_usd` meaningful on the subscription-login `claude` CLI, or always
  absent/zero? *Capture it when present, never depend on it; tokens + duration are the load-bearing
  metrics regardless.*
- **OQ4** — Does the stream-json `result` event's field naming match `usage.cache_read_input_tokens`
  on the pinned `claude` CLI version? *S1's `costFromResult` must be verified against a REAL captured
  event (dump one `result` line from a live turn) before wiring — the presence-guarded reader makes a
  naming miss degrade to `null`, but the baseline is worthless if the fields silently read undefined.
  This is the one thing to confirm against a real turn, not from this doc.*

## Acceptance criteria

1. After any build, `.runs/<taskId>/task.json` has a `cost` map with a non-null entry for every
   phase that ran a `claude` turn (analyze/spec, or the merged draft turn; implement), each carrying
   at least `durationMs`, `numTurns`, `inputTokens`, `outputTokens` when the CLI emitted them.
2. A turn that died without a `result` event (spec-045 usage-limit / not-logged-in / timeout) leaves
   that phase's `cost` entry absent — no crash, no partial-garbage entry; the build still gates and
   surfaces the 045 triage note exactly as before.
3. `costFromResult` is unit-tested: a real captured `result` event → fully-populated `PhaseCost`; a
   `null` input → `null`; an event missing `usage` → a `PhaseCost` with duration/turns set and token
   fields absent; a shape-drifted event → no throw.
4. `e2e-run.sh time <taskId>` prints both the existing mtime wall-clock table AND the new
   token/turn/cache-hit% table, read OFFLINE from `task.json` with no backend running.
5. `GET /api/tasks/:id` returns `cost` in the snapshot.
6. **No behavior/quality regression**: builder `npm test` green, `pytest tests/` green (no count
   pins touched), no phase prompt/artifact/gate changed — a diff review confirms the ONLY runtime
   change is recording + surfacing metrics.
7. The **Baseline** section is filled from a real sweep and ends with a one-line named cause for the
   ③ bottleneck + the single lever the follow-up spec should target.

## References

- [058](058-e2e-simulation-harness.md) — `e2e-run.sh time`/`bench` (the mtime wall-clock this
  upgrades) and the recorded baseline "`implement` dominates ~55–70%".
- [045](045-turn-failure-triage.md) — a dead turn has no `result`; capture must tolerate it.
- `turn-runner.ts` — `TurnResult.result` (the already-captured event this reads).
- `claude-session.ts:49` — `ClaudeStreamEvent` shape; `orchestrator.ts:351` — `runPhase`;
  `state/task.ts` — `Task` (where `cost` lands, beside `sessionIds`/`artifacts`).

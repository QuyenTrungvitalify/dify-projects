# Spec 013 — Builder linter-contract unification + orchestrator test seams

**Status**: Implemented (2026-06-20)
**Effort**: L
**Depends on**: [011](011-builder-test-coverage-and-remediation.md) (the test harness this spec extends)

> **Resolution (2026-06-20).** Implemented as specified, with the open questions resolved to their
> recommended answers: **Q1**(a) backend-only — 011's R3/R7/R10 left untouched; **Q2** slice depth
> unified to `6` (report failure-detail 4→6); **Q3** runners injected = `runTurn`/`runPython`/
> `runReport` **plus `postTurnCheck`** — the ③ Implement verdict flows through `postTurnCheck`, which
> hard-imports `runPython`, so without seaming it the advance ladder can't be driven without a real
> `.venv` (this is the one deviation from D2's stated set; see D2 below); **Q4** driven through the
> exported entry points only; **Q5** per-test tmp git repos confirmed (the CI `builder` job has `git`).
> Delivered: `linters.ts` + the 6 test files (linters, advance-loop, confinement, recovery,
> dify-parsers, golden-build) + the gate additions. `npm run typecheck` + `npm test` green (87 tests).

> **Behavior-preserving by design.** Every change here is a refactor or a *new test* — it does
> not change what a build does. That is the whole point: this spec single-sources the linter
> verdict and makes the orchestrator's state machine testable, so the **behavior-changing** specs
> that follow (014 correctness, 015 security, 017 perf/prompts) can edit the riskiest code on top
> of a regression net and a single shared module, instead of three hand-copies and zero tests.

## Context

The builder's "did this workflow pass?" verdict — the gate that decides whether a build advances,
ships, or imports to Dify — is **re-implemented by hand in more than one place**, and the copies
have already drifted. Separately, the functions that own that verdict (`runPhase`, `verifyPhase`,
`confirmAdvance`, `runTestAndFinish`, `runImportAndFinish`) have **zero automated coverage** because
they are structurally untestable: they hard-import the subprocess runners. Three concrete, verified
problems:

**(C1) The 3-linter contract is duplicated, and the copies diverge.** The list of the three linters
(`validate_workflow.py`, `lint_refs.py`, `lint_plugin_hashes.py`) is written out by hand in two
files:

- [post-turn.ts:117-121](../../apps/builder/server/lib/post-turn.ts) — Phase ③ gate input (`lintCodes`),
  failure detail sliced with `.slice(-6)` ([:127](../../apps/builder/server/lib/post-turn.ts)).
- [report.ts:57-61](../../apps/builder/server/lib/report.ts) — Phase ④ report (`lint`), failure detail
  sliced with `.slice(-4)` ([:68](../../apps/builder/server/lib/report.ts)) — **already a divergence**:
  the same lint failure surfaces a different amount of detail depending on which phase produced it.

And the boolean "all three clean" (`lintClean`) is computed independently **twice more**:

- [orchestrator.ts:513-517](../../apps/builder/server/lib/orchestrator.ts) — `verifyPhase`, over post-turn's `lintCodes`,
  drives the Implement `success` vs `still_failing` gate.
- [report.ts:72](../../apps/builder/server/lib/report.ts) — over report's own re-run codes, drives the
  selfhost Import-gate precondition (`lintClean` → `awaiting_import` park at
  [orchestrator.ts:584](../../apps/builder/server/lib/orchestrator.ts)).

Today these agree by luck. The moment a linter is added, renamed, repathed, or reordered in one file
only, **the ③ gate and the ④ report disagree silently** — a build can gate clean in Implement and
record a different verdict in the report that the user sees *and* that gates the live-Dify import.
There is no test that would catch this.

**(C2) The orchestrator's verdict/advance code is untestable, so it is untested.** `OrchestratorCtx`
([orchestrator.ts:34-46](../../apps/builder/server/lib/orchestrator.ts)) carries only an optional `broadcast`
side-channel; the runners are hard-imported: `ClaudeSession`/`runTurn`
([:20](../../apps/builder/server/lib/orchestrator.ts),[:23](../../apps/builder/server/lib/orchestrator.ts)),
`runPython` ([:22](../../apps/builder/server/lib/orchestrator.ts)), `runReport`
([:29](../../apps/builder/server/lib/orchestrator.ts)). To exercise "does `auto` hard-stop at
`still_failing`?" or "does the confinement check revert an out-of-confinement write?" a test must
spawn a **real `claude` turn + a real git tree**. So the app's most dangerous behaviors (AC #15
auto hands-free, AC #25 auto hard-stop / never-auto-import-lint≠0, AC #23 confinement revert) are
verified only by manual QA. Spec 011 already flagged the two halves of this gap and left them
explicitly as follow-ups:

- The `confinementCheck` baseline-delta **revert** path is the "M-effort other half of T5", deferred
  ([porcelain.test.ts:6-8](../../apps/builder/test/porcelain.test.ts) — only the pure `parsePorcelainPath`
  is tested).
- AC #15 / AC #25 are spec 011 **R10**, scoped there as a *manual* live run — there is no *automated*
  integration test of the advance ladder, and there cannot be one without injectable runners.

**(C3) Recovery + Dify-parser logic is pure, crash-critical, and untested.** `recovery.ts` (the
`push_intent` write-before-push idempotency guard against duplicate Dify apps) and the parsers in
`dify-io.ts` (`appIdFromJsonOut`, `appUrlFrom`, `reconcileAppIdByName`, list parsing) are referenced
by **no** test, yet a bug in them silently duplicates a Dify app or attaches the wrong app id.

This spec fixes the *structural* causes (C1 duplication, C2 untestability) and lands the tests they
unlock (C2/C3 coverage). It is the keystone: 014 (lint-gate correctness), 015 (confinement), and 017
(linter parallelize) all edit exactly the code touched here, so doing it **first** turns a three-way
merge collision on `post-turn.ts`/`report.ts`/`orchestrator.ts` into clean sequential consumes.

## Goals

1. **One source of truth for the linter contract.** A single `linters.ts` module owns the linter
   list (paths + keys) and the `lintClean(codes)` helper; `post-turn.ts`, `report.ts`, and the
   orchestrator verify all consume it. The ③ gate and the ④ report provably run the identical set
   and identical clean-test. Failure-detail slice depth is unified to one documented constant.
2. **Injectable runner seams.** `OrchestratorCtx` gains optional, default-to-real seams for the
   subprocess runners so `verifyPhase` / `runPhase` / `confirmAdvance` / `runTestAndFinish` /
   `runImportAndFinish` can be driven with stubs — **no behavior change** when the seams are absent.
3. **A regression net for the riskiest paths**, now that they are testable: an automated advance-loop
   integration test (AC #15 / #25), the confinement-revert test (the deferred T5 half), and pure
   units for recovery/idempotency and the Dify parsers.
4. **A behavior-preservation guarantee.** A golden test pins that a full build produces a
   byte-identical gate/status/phase sequence before and after the refactor.

## Non-goals

- **No verdict-semantics change.** Whether a lint-failing `deploy=none` build is `done` vs `error`
  is spec **014**'s call — 013 only unifies *how* the verdict is computed, not *what it decides*.
- **No re-ownership of spec 011's committed fixes.** R3 (store merge-guard, [store.ts:135](../../apps/builder/web/src/store.ts)),
  R7 (phase bounds-guard), and R10 (the *manual* AC #15/#25 live run) are **AC-gated deliverables of
  spec 011** (Approved; the R3/R7 code fixes are not yet landed). 013 does **not** re-own them — see
  Open Questions Q1. (013's *automated* advance-loop test complements, but does not replace, R10's
  live run.)
- **No deep decomposition of `runPhase`.** Splitting the ~130-line `runPhase`
  ([orchestrator.ts:351-478](../../apps/builder/server/lib/orchestrator.ts)) into smaller units is optional
  cleanup, deferred unless it falls out naturally from adding the seams (it must not change behavior).
- **No client-visible change.** The `confirmAdvance` 409-precondition move (a real 409 vs a swallowed
  throw) is client-visible and belongs to 014/UX, not this behavior-preserving spec.
- No new linters, no new gate variants, no UI work.

## Design

### D1 — `linters.ts`: the single linter contract (fixes C1)

New file `apps/builder/server/lib/linters.ts`:

```ts
export interface LinterDef { name: string; key: 'validate' | 'lint_refs' | 'lint_plugin_hashes'; script: string; }
export const LINTERS: LinterDef[] = [
  { name: 'validate_workflow.py',    key: 'validate',           script: 'skills/mango-svip/scripts/validate_workflow.py' },
  { name: 'lint_refs.py',            key: 'lint_refs',          script: 'tools/dify_base/lint_refs.py' },
  { name: 'lint_plugin_hashes.py',   key: 'lint_plugin_hashes', script: 'tools/dify_base/lint_plugin_hashes.py' },
];
export type LintCodes = Record<LinterDef['key'], number>;
export const lintClean = (c: LintCodes | null | undefined): boolean =>
  c != null && c.validate === 0 && c.lint_refs === 0 && c.lint_plugin_hashes === 0;
export const LINT_DETAIL_LINES = 6; // unified slice depth (was -6 in post-turn, -4 in report)
```

- `post-turn.ts` ([117-131](../../apps/builder/server/lib/post-turn.ts)) builds its `args` from
  `LINTERS` (`[def.script, rel]`) and slices detail with `LINT_DETAIL_LINES`.
- `report.ts` ([57-72](../../apps/builder/server/lib/report.ts)) does the same and replaces its hand-coded
  triple-`===` with `lintClean(lint)`.
- `verifyPhase` ([orchestrator.ts:513-517](../../apps/builder/server/lib/orchestrator.ts)) replaces its
  triple-`===` with `lintClean(d.lintCodes)`.
- **Open decision Q2:** unify the slice depth to one value (proposed `6`) vs keep per-consumer. The
  proposal changes `report.json`'s failure-detail length from 4→6 lines — a visible-in-artifact
  detail, hence an Open Question, not a silent pick.

### D2 — Injectable runner seams on `OrchestratorCtx` (fixes C2)

Extend the ctx with optional runners that default to the current hard-imports, so production code is
untouched and only tests inject fakes:

```ts
export interface OrchestratorRunners {
  runTurn: typeof import('./turn-runner.js').runTurn;
  runPython: typeof import('./shell.js').runPython;
  runReport: typeof import('./report.js').runReport;
  postTurnCheck: typeof import('./post-turn.js').postTurnCheck; // Q3: added — see note below
}
export interface OrchestratorCtx {
  projectsDir: string; settingsPath: string; log: SessionLogger;
  broadcast?: (taskId: string, event: string, data: unknown) => void;
  runners?: Partial<OrchestratorRunners>; // tests inject; absent ⇒ the real impls
}
```

> **As-built (Q3):** `postTurnCheck` was added to the seam. The ③ Implement success/still-failing
> verdict is resolved by `verifyPhase` → `postTurnCheck`, and `postTurnCheck` hard-imports `runPython`
> directly (not via the ctx). So the orchestrator-level `runPython` seam (the `init_project.py`
> callsites) does **not** reach the ③ verdict; without a `postTurnCheck` seam the advance-loop test
> cannot move Implement to `success`/`still_failing` without a real `.venv`. It defaults to the real
> impl exactly like the others (absent ⇒ no behavior change).

Resolve once at the top of each entry point (`const runTurn = ctx.runners?.runTurn ?? realRunTurn`)
and thread through the ~3 spawn/report callsites
([orchestrator.ts:399](../../apps/builder/server/lib/orchestrator.ts) `runTurn`,
[:571](../../apps/builder/server/lib/orchestrator.ts)/[:660](../../apps/builder/server/lib/orchestrator.ts)/[:674](../../apps/builder/server/lib/orchestrator.ts) `runReport`,
[:133](../../apps/builder/server/lib/orchestrator.ts)/[:743](../../apps/builder/server/lib/orchestrator.ts) `runPython`).
`ClaudeSession` stays internal to `spawnOnce`; the seam is at `runTurn` (the function `spawnOnce`
awaits), which is the cleanest stub point — a faked `runTurn` returns a `TurnResult` without spawning
`claude`. **Open decision Q3:** seam scope — runners only, or also a `clock` for the timeout path.

### D3 — Tests unlocked by D2 (C2/C3 coverage)

All under `apps/builder/test/` (server: `node --test` + `node:assert/strict`, import source via `.js`)
unless noted; harness per AGENTS.md §7/§10 (`npm test`, `npm run typecheck` — see spec 011 R1):

- **`linters.test.ts`** (drift-guard): asserts `post-turn`, `report`, and `verifyPhase` all consume
  `LINTERS`/`lintClean` (e.g. a single key change is observable in all three), and `lintClean` truth
  table. **XS.**
- **`advance-loop.test.ts`** (integration, the L piece): drive `startTask` → `confirmAdvance` through
  analyze→spec→implement→test for each `confirmMode`, with `runTurn`/`runReport`/`runPython` stubbed,
  asserting: `auto` runs ①→④ hands-free (AC #15); `still_failing` **hard-stops** `auto` and never
  auto-imports lint≠0 (AC #25); `replyWithin` at `test` re-runs the report, not a turn; each
  `isCancelled` bail leaves `status=cancelled` with no gate clobber. Also pins the edit-existing
  `duplicateWarning` provenance.
- **`confinement.test.ts`** (the deferred T5 half): over a temp git repo, prove `confinementCheck`
  **reverts** an out-of-whitelist write (git checkout/clean) while never touching baseline-dirty work
  nor the whitelisted `.runs/<taskId>/`. **M.**
- **`recovery.test.ts`** + **`dify-parsers.test.ts`** (C3): `writePushIntent`→`readPushIntent`
  round-trip and `reconcilePushIntents` reconcile-not-re-push on a marker-without-appId; pure units
  for `appIdFromJsonOut` (app_id/id precedence, self-hosted-null), `appUrlFrom` (standard /
  trailing-slash / non-`/console/api` base), `reconcileAppIdByName`/`slugifyName`. **S.**
- **`gate.test.ts`** additions: the `error` outcome single-button retry, and that `computeGate`
  ignores `deploy` for the error/terminal/`awaiting_import` cases. **XS.**

### D4 — Behavior-preservation golden test (Goal 4)

`golden-build.test.ts`: a full `each_step` build (stubbed `runTurn`/`runReport`) records the ordered
`(phase, status, gate.actions[].id)` emissions; the assertion is that this sequence is **identical**
before and after the refactor (capture the baseline from `main` first, commit it as the fixture).
This is the safety net every downstream spec (014/015/017) leans on.

### Touch points

| File | Change |
|---|---|
| `apps/builder/server/lib/linters.ts` | **new** — LINTERS + lintClean + LINT_DETAIL_LINES (D1) |
| [post-turn.ts](../../apps/builder/server/lib/post-turn.ts) | consume LINTERS + LINT_DETAIL_LINES at :117-131 (refactor) |
| [report.ts](../../apps/builder/server/lib/report.ts) | consume LINTERS + lintClean at :57-72 (refactor) |
| [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) | `lintClean` at :513-517; `runners` seam on ctx + resolve/thread at the runTurn/runReport/runPython callsites (refactor) |
| `apps/builder/test/*.test.ts` | new: linters, advance-loop, confinement, recovery, dify-parsers, golden-build; additions: gate (D3/D4) |

## Open questions

- **Q1 — 011 boundary.** R3/R7 (code fixes) and R10 (manual live run) are spec 011's AC-gated
  deliverables but R3/R7 are **not yet landed in code**. Does 013 (a) strictly depend on 011 landing
  them and leave them out, or (b) absorb them with an explicit "supersedes 011 §… rows" note to avoid
  a stalled-dependency? *Recommended: (a) — keep 013 backend-only and behavior-preserving; 013's
  automated advance test complements R10 but does not discharge it.*
- **Q2 — slice depth.** Unify the linter failure-detail slice to `6` (changes `report.json` 4→6 lines)
  vs keep per-consumer and share only the list+keys? *Recommended: unify to 6 (the gate's depth), and
  note the report-detail change in the ledger.*
- **Q3 — seam scope.** Inject `runTurn`/`runPython`/`runReport` only, or also a `clock` so the
  10-min `TURN_TIMEOUT_MS` path ([orchestrator.ts:64](../../apps/builder/server/lib/orchestrator.ts)) is
  testable without real time? *Recommended: runners now; clock deferred unless the timeout test needs it.*
- **Q4 — advance-loop test seam.** Drive the ladder only through the exported entry points
  (`startTask`/`confirmAdvance`/`replyWithin`) with stubbed runners, or also `export` the private
  steps for tighter unit tests? *Recommended: through the entry points (no public-surface widening).*
- **Q5 — CI for the git fixture.** `confinement.test.ts` needs `git` + a throwaway tmp repo. Confirm
  the CI `builder` job runner has `git` and that per-test tmpdir repos are acceptable.

## Acceptance criteria

1. `apps/builder/server/lib/linters.ts` exists and is the **only** definition of the linter list and
   `lintClean`; `post-turn.ts`, `report.ts`, and `verifyPhase` import it — no hand-copied linter
   list or triple-`===` remains (grep proves zero residual copies).
2. `linters.test.ts` fails if any one call site stops consuming the shared module (drift-guard green).
3. `OrchestratorCtx` exposes optional `runners`; with `runners` absent, an existing full build behaves
   identically (D4 golden test byte-identical before/after).
4. `advance-loop.test.ts` proves, with stubbed runners: AC #15 (`auto` ①→④ hands-free), AC #25
   (`still_failing` hard-stops `auto`; no auto-import on lint≠0), `/reply` at ④ re-runs the report
   not a turn, and a cancel bail leaves `status=cancelled` without clobber.
5. `confinement.test.ts` proves a breach is reverted and baseline-dirty + whitelisted `.runs/<taskId>/`
   are untouched (the deferred T5 half closed).
6. `recovery.test.ts` + `dify-parsers.test.ts` cover the `push_intent` round-trip/reconcile and the
   `appIdFromJsonOut`/`appUrlFrom`/`reconcileAppIdByName` parsers.
7. `npm run typecheck` (server, `tsconfig.test.json`) and `npm test` (server + web) are green; the CI
   `builder` job passes. No production behavior changed (Non-goals hold).

## References

- Audit (this session): the 74-finding review + per-cluster complexity sizing that scoped clusters
  **ARC + TST** into this spec; the dependency analysis naming this the keystone for 014/015/016/017.
- [011](011-builder-test-coverage-and-remediation.md) — the test harness (R1) this extends; R3/R7/R10
  ownership boundary (§4, §7); the deferred T5 confinement-revert half.
- Code: [post-turn.ts](../../apps/builder/server/lib/post-turn.ts) · [report.ts](../../apps/builder/server/lib/report.ts) ·
  [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) · [recovery.ts](../../apps/builder/server/lib/recovery.ts) ·
  [dify-io.ts](../../apps/builder/server/lib/dify-io.ts) · [gate.ts](../../apps/builder/server/lib/gate.ts).
- AGENTS.md §7 (builder app) + §10 (test commands).

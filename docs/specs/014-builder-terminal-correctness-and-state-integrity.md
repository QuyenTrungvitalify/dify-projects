# Spec 014 — Builder ④-terminal correctness + state & deploy-gate integrity

**Status**: Implemented (2026-06-20) — D1–D7 landed
**Effort**: M
**Depends on**: [013](013-builder-linter-contract-and-test-seams.md) (consumes its `linters.ts` + `resolveRunners` seams + advance-loop test harness)

> **Progress (2026-06-20).** Open questions resolved to the recommended answers: **Q1** = the **④
> accept-gate** (a lint≠0 ④ parks at `still_failing` with Accept/Discard, not a hard `error`); **Q2** =
> keyed off the gate **flag**, so the deploy-park covers `auto` **and** `spec_only`. Landed + tested on
> 013's seams (server `npm test` 91 green, typecheck clean):
> - **D1** — `maybeAutoAdvance` hard-stops on the `awaiting_import` flag → `auto`/`spec_only` PARK at the
>   selfhost Import gate (no silent auto-deploy). [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) + [gate.ts](../../apps/builder/server/lib/gate.ts).
> - **D2** — a lint≠0 ④ without a human ③-accept parks at a new `still_failing` ④ gate (Accept anyway /
>   Discard); `auto` hard-stops; `accept` finishes `done` tagged. Mirrored into the CLI [test.md](../../.claude/skills/dify-build/test.md).
> - **D3** — `writePushIntent` is now temp+rename atomic ([recovery.ts](../../apps/builder/server/lib/recovery.ts)).
> - **D4** — the resume fallback excludes timeouts (`&& !turn.note`) → a `/reply` timeout parks at error,
>   not a second full turn.
> - Tests: advance-loop D1/D2/D2-accept/D4 (the prior 013 "selfhost lint≠0 → done" case is **retitled**
>   to the new park behavior), recovery D3 atomic.
>
> **Amends spec 009 AC #16/#25** (no silent drift): `auto`/`spec_only` no longer auto-confirm the
> selfhost Import — deploy is always a human decision; and a lint≠0 ④ is never silently `done`.
>
> **Update (2026-06-20) — D5–D7 landed (server `npm test` 107 green, web vitest 44 green, both typecheck +
> web build clean).** Resolves the remaining open questions:
> - **D5 (Q4)** — **R8 reproduced**, then fixed. `applyTask` set `task.value` unconditionally, so feeding it
>   an older snapshot after a newer one trivially reverts the UI (and the init/reconnect path's
>   fire-and-forget `api.getTask().then(applyTask)` — plus `applyTask`'s own artifactContents GET — can
>   resolve out of order). Fix = a monotonic `task.rev` bumped in the orchestrator `emit`; `applyTask`
>   drops a snapshot whose `rev` is **strictly older** than the last applied for that task (EQUAL still
>   applies — the artifactContents-enrichment GET shares the triggering update's rev). `rev` source = a
>   self-contained `task.rev` counter (Q4 option A), absent ⇒ 0 (trivial migration). [store.ts](../../apps/builder/web/src/store.ts) `isFreshSnapshot`/`applyTask` + [state/task.ts](../../apps/builder/server/state/task.ts) + `orchestrator.ts emit`; test [web/src/store.test.ts](../../apps/builder/web/src/store.test.ts).
> - **D6 (Q3)** — `sync.py list` (cmd_list) exposes **only id/mode/name — no created-at or other
>   disambiguator**, so D6 is the **best-effort + warn** variant (not a signature match): `reconcileAppIdByName`
>   now returns `{appId, ambiguous}` via the pure `pickReconciledApp`; **≥2 same-named matches ⇒ `ambiguous`,
>   never a silent newest-pick** → the import/boot-recovery paths surface "ambiguous — verify in Dify".
>   [dify-io.ts](../../apps/builder/server/lib/dify-io.ts) + `orchestrator.ts runImportAndFinish` + [recovery.ts](../../apps/builder/server/lib/recovery.ts); test [dify-parsers.test.ts](../../apps/builder/test/dify-parsers.test.ts).
> - **D7** — cloud/none edit-existing now carries the duplicate warning (`editExistingDuplicateWarning` in
>   [report.ts](../../apps/builder/server/lib/report.ts)); a killed `claude` child detaches its readline +
>   stderr/exit/error listeners ([claude-session.ts](../../apps/builder/server/lib/claude-session.ts), **011
>   R14**); `cancelledTasks` is evicted on TERMINAL settle only — never on release ([lock.ts](../../apps/builder/server/lib/lock.ts) `evictCancelled` + the dispatch `finally`/parked-cancel in [routes/tasks.ts](../../apps/builder/server/routes/tasks.ts)); the Dify-seed picks the **exact** file `pullApp` reported (`pulledFileFromStdout`) instead of an mtime scan (**011 R15**); and `bodyLimit` is the named `BODY_LIMIT_BYTES` co-located with the image caps it must dominate, with an invariant test ([attachments.test.ts](../../apps/builder/test/attachments.test.ts), **012 D1**). The spec's optional 6th D7 row (push-time lint re-check) is already covered by **D1**: the import gate is only reachable from a clean `awaiting_import` park, so a lint-failing build can never reach `runImportAndFinish`.
>
> **Supersedes spec 011 backlog R8 (D5), R14 + R15 (D7).**
>
> **Review remediation (2026-06-20).** An adversarial review found the D5 guard incomplete: `emit`
> bumps `rev`, but the four routes that broadcast a `task:update` DIRECTLY (cancel / restore / failSafe
> / PATCH confirm_mode) bypassed `emit`, relaying at an UNCHANGED `rev`. Because the store applies on
> `rev >= last` (EQUAL needed for the artifactContents-enrichment GET), an in-flight same-rev GET issued
> at a parked gate could resolve after a `/cancel` and **resurrect the just-cancelled gate**. Fix: a
> `bumpRev(task)` helper ([state/task.ts](../../apps/builder/server/state/task.ts)) called before each
> direct broadcast ([routes/tasks.ts](../../apps/builder/server/routes/tasks.ts) cancel/restore/failSafe/
> PATCH) so the relayed snapshot strictly increases `rev` and a stale GET is dropped. Tests added:
> store cancel-resurrection comparator cases; an ambiguous boot-recovery case (`reconcilePushIntents`
> made injectable, closing the D6 boot-branch gap). Server `npm test` 108 green, web vitest 46 green.

> **One theme:** a build must never *silently* end in a risky state — never **done-but-broken**,
> never **auto-deployed**, never **duplicated**, never **raced into a stale view**. 013 made the ④
> terminal code single-sourced and testable; 014 fixes *what it decides* at that terminal and on
> recovery/reconnect. These are behavior changes (unlike 013), so each rides an automated test on
> 013's seams + a spec-009 AC update (no silent drift).

## Context

Phase ④ (Test & Report) and the recovery/reconnect paths have a set of "silent risky outcome"
holes, all verified in code:

**(C1) `auto` silently deploys to a live Dify workspace.** `maybeAutoAdvance`
([orchestrator.ts:357-365](../../apps/builder/server/lib/orchestrator.ts)) hard-stops only on the
`still_failing` flag ([:360](../../apps/builder/server/lib/orchestrator.ts)). A **clean selfhost ④**
parks at the `awaiting_import` gate ([runTestAndFinish:616-621](../../apps/builder/server/lib/orchestrator.ts)),
then falls through to `maybeAutoAdvance` — which, because `boundaryAutoAdvances('auto','test')` is
`true` and the flag is not `still_failing`, **auto-confirms the `import` action** → `runImportAndFinish`
→ `pushApp` pushes to Dify with **no human consent**. So picking `auto` + `selfhost` silently publishes
the workflow to a real workspace. (`none` never deploys; `cloud` never auto-pushes — the footgun is
`auto`/`spec_only` + `selfhost`.)

**(C2) A lint-failing build can become `done` with no block.** `runTestAndFinish`
([:606-625](../../apps/builder/server/lib/orchestrator.ts)) branches `!res.ok → error`, then
`selfhost && res.lintClean → park`, **else → `done`** ([:623](../../apps/builder/server/lib/orchestrator.ts)).
The linter exit codes are recorded into `report.json` as **data, not a blocker** — for `deploy=none|cloud`
there is no import to gate, so a structurally-broken-but-parseable workflow (failing `lint_refs` /
non-13-digit ids) lands as an ordinary `done` build, indistinguishable from a clean one unless the
human already explicitly accepted it at the ③ gate (`acceptedLintFailure`). The CLI procedure
([test.md](../../.claude/skills/dify-build/test.md)) has the same hole — it never says "do not write a
done report if a linter ≠ 0".

**(C3) A crash mid-marker-write can duplicate a Dify app.** The `push_intent` marker is the only guard
against a duplicate app on a crash-mid-push, but `writePushIntent` is a bare
`await writeFile(...)` ([recovery.ts:43](../../apps/builder/server/lib/recovery.ts)) — non-atomic. A
torn write + `readPushIntent`'s parse-fail-returns-`null` ([recovery.ts:47-58](../../apps/builder/server/lib/recovery.ts))
makes the next attempt take the *fresh-import* branch and push **again** — the exact duplicate the
marker exists to prevent ([runImportAndFinish:657-666](../../apps/builder/server/lib/orchestrator.ts)).

**(C4) A `/reply` timeout is misclassified as a resume failure → a second full 10-min turn.** The
resume fallback fires on `opts?.resumeId && turn.isError && !turn.result`
([orchestrator.ts:473](../../apps/builder/server/lib/orchestrator.ts)). On a wall-clock **timeout** the
turn resolves `{result:null, isError:true, note:'…timed out…'}` — so a `/reply` (resume) timeout
matches the predicate and re-runs a **fresh** turn from scratch ([:475](../../apps/builder/server/lib/orchestrator.ts)),
spending up to another `TURN_TIMEOUT_MS`. `turn.note` (set on timeout/spawn-failure) is never consulted.

**(C5) A reconnect GET can clobber a newer live `task:update`.** `applyTask`
([store.ts:135](../../apps/builder/web/src/store.ts)) does `task.value = t` **unconditionally** (also at
[:183](../../apps/builder/web/src/store.ts)); on (re)connect the init-path GET resolves async and can
overwrite a freshly-arrived live update with an older snapshot — the stale-gate hazard AC #22 exists to
prevent. (This is spec 011 **R8**, explicitly left as backlog "needs a repro before fix".)

**(C6) Wrong-app reconcile.** `reconcileAppIdByName` ([dify-io.ts:193-217](../../apps/builder/server/lib/dify-io.ts),
used at [orchestrator.ts:663,669](../../apps/builder/server/lib/orchestrator.ts)) picks the
most-recently-created app whose slugified name matches — with no check it is *this* build's app. Two
same-named apps (a prior crashed-then-retried import, or two builds with the same derived name) can
attach the wrong `app_id`/`app_url`.

This spec closes C1–C6 (plus the low hygiene items below), consuming 013's `linters.ts` for the C2 gate
and 013's `resolveRunners` seams for the regression tests.

## Goals

1. **Deploy is always a human decision.** `auto`/`spec_only` never auto-confirm the deploy/import gate;
   a build runs ①→④ and then **parks** for an explicit Import/Skip choice (C1).
2. **Never silently done-but-broken.** A lint-failing ④ on any deploy path does not become a plain
   `done`; it is blocked or explicitly accepted, and tagged — mirrored into the CLI `test.md` (C2).
3. **Idempotent import.** A crash at any point around the push never produces a duplicate Dify app (C3);
   a reconcile never attaches the wrong app (C6).
4. **Robust resume + reconnect.** A `/reply` timeout parks at `error`, not a second full turn (C4); a
   late reconnect GET never overwrites a newer state (C5).
5. Each fix carries an automated test on 013's seams; AC #15/#16/#25 wording in spec 009 is updated to
   match the new deploy-gate behavior.

## Non-goals

- **No UI redesign of the gates.** The `awaiting_import` card copy/affordances are spec **016**'s job;
  014 only changes *when* the gate is reached, not how it looks. (016 still needs its `awaiting_import`
  render branch — 014 makes that branch matter for `auto` too.)
- **No new deploy targets / no in-place Dify update.** The "import always creates a new app" reality is
  unchanged; 014 only makes the duplicate **warning** reach the cloud edit-existing path too, and makes
  the *consent* explicit.
- **No persisted chat-history / `phase:output` replay.** That larger backend logging feature stays out
  (tracked separately); C5 here is only the version-guard against clobber.
- **No linter-contract change.** The linter list + `lintClean` are 013's `linters.ts`; 014 only *gates*
  on `lintClean`, it does not redefine it.

## Design

### D1 — Deploy/import is always an explicit confirm (C1) — *the item added this round*

In `maybeAutoAdvance`, add a single hard-stop mirroring the `still_failing` one, keyed off the gate
**flag** (so it covers both `auto` and `spec_only`):

```ts
if (task.gate?.flag === 'still_failing') return;     // existing — auto hard-stops on a failing build
if (task.gate?.flag === 'awaiting_import') return;   // NEW — deploy is always a human decision
```

Effect: `auto`/`spec_only` + `selfhost` now run ①→④, write `report.json`, and **park** at the Import
gate; the human clicks **Import to Dify** or **Skip import** (both already `kind:'confirm'`, routed
through `confirmAdvance(test)` which does not recurse). `none`/`cloud` are unchanged. Update the now-stale
comments at [runTestAndFinish:614-615](../../apps/builder/server/lib/orchestrator.ts) ("maybeAutoAdvance
auto-confirms it in auto/spec_only") and [gate.ts:96-112](../../apps/builder/server/lib/gate.ts), and the
**AC #16/#25** wording in spec 009 (auto no longer auto-imports a clean selfhost build).
Effort **XS**; blast radius is one chokepoint, behavior change limited to `selfhost`+auto/spec_only.

### D2 — No silent done-but-broken (C2)

In `runTestAndFinish`, before the terminal `done`, gate on `lintClean` using 013's helper:

- `!res.ok` → `error` (unchanged).
- `selfhost && lintClean` → park `awaiting_import` (unchanged; now also human-gated via D1).
- **NEW:** `!lintClean && !acceptedLintFailure` → do **not** mark `done`. Present a ④ still-failing gate
  (Accept anyway / Keep trying / Discard, reusing the ③ `still_failing` variant) — `auto` **hard-stops**
  (the existing `still_failing` flag already stops it). On explicit **Accept**, finish `done` with the
  `accepted_lint_failure` marker (already in `report.json`, [report.ts:76](../../apps/builder/server/lib/report.ts)).
- `lintClean` (none/cloud) or `acceptedLintFailure` → `done` (tagged if accepted).

Mirror into the CLI contract: [test.md](../../.claude/skills/dify-build/test.md) step 1 — "if any linter
≠ 0 and the failure was not explicitly accepted, emit the failure and STOP without a done-shaped report".
**Open question Q1** picks `error` vs the still-failing accept-gate; the accept-gate is recommended
(consistent with the ③ pattern and the human-consent theme). Effort **S** (the branch + computeGate
variant reuse); blast radius is the ④ terminal — covered by 013's advance-loop test.

### D3 — Atomic `push_intent` (C3)

`writePushIntent` writes to `markerPath + '.tmp'` then `rename`s (atomic on POSIX), reusing the
temp+rename pattern. The **pre-push** marker ([orchestrator.ts:666](../../apps/builder/server/lib/orchestrator.ts))
must be durable before `pushApp` runs; a torn marker must never read as "no prior intent". Effort **S**;
covered by a `recovery.ts` round-trip + torn-marker test (013/C3 unit).

### D4 — Resume-timeout classification (C4)

Guard the resume fallback on the actual resume-failure signature, not the timeout one:

```ts
if (opts?.resumeId && turn.isError && !turn.result && !turn.note) { /* re-run fresh */ }
```

A timeout (or spawn failure) sets `turn.note`, so it now parks at `error` like a fresh-turn timeout
instead of silently spending a second `TURN_TIMEOUT_MS`. Effort **XS**; covered by an advance-loop test
case feeding a `{isError, note}` resume result.

### D5 — Reconnect version guard (C5)

Carry a monotonic `rev` (the SSE event id, or a `task.rev` counter bumped in `emit`) and have `applyTask`
**ignore** any snapshot whose `rev` is older than the last applied; resolve the init-path GET only if no
newer `task:update` landed since it was issued. Closes spec 011 **R8** (needs the repro R8 asked for).
Effort **M** (touches the persisted `Task` shape + `applyTask`/`onInit`); covered by a `mappers`/store test.

### D6 — Reconcile verification (C6)

`pushApp` captures/persists a disambiguator (push timestamp window, or a stable id from `--json-out`) so
`reconcileAppIdByName` can tell same-named apps apart; when more than one name match exists, surface
"ambiguous — verify in Dify" instead of silently picking the newest. Bounded by what `sync.py list`
exposes (**Open question Q3**). Effort **M** (may need a `sync.py` field); covered by a `dify-parsers` test.

### D7 — Low hygiene roundup (supersede spec 011 backlog where noted)

| Item | Fix | Effort |
|---|---|---|
| Cloud edit-existing has no duplicate warning | Compute `duplicateWarning` in `runReport` (has `task.workflow`+`deploy`) so it fires for cloud/none-edit too, not only selfhost push ([orchestrator.ts:688-690](../../apps/builder/server/lib/orchestrator.ts)) | S |
| Killed `claude` child leaks listeners (**011 R14**) | Close `rl` + remove stream listeners on kill ([claude-session.ts](../../apps/builder/server/lib/claude-session.ts)) | S |
| `cancelledTasks` Set grows unbounded | Evict on terminal status ([lock.ts](../../apps/builder/server/lib/lock.ts)) | XS |
| Dify-seed max-mtime tie (**011 R15**) | Track the exact file `pullApp` wrote instead of an mtime scan | S |
| Multi-image turn → opaque 413 (**spec 012 D1**) | Confirm/raise Fastify `bodyLimit` > 3×10MB×1.33; oversize → the friendly 400, not a raw 413 | XS |
| `runImportAndFinish` pushes without a push-time lint re-check | Re-assert `lintClean` (now also human-confirmed via D1) before the push | XS |

### Touch points

| File | Change |
|---|---|
| [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) | D1 `maybeAutoAdvance` guard; D2 `runTestAndFinish` terminal; D4 resume predicate; D6 reconcile call; D7 duplicateWarning/lint-recheck |
| [recovery.ts](../../apps/builder/server/lib/recovery.ts) | D3 atomic write |
| [report.ts](../../apps/builder/server/lib/report.ts) | D2 done-tagging; D7 cloud duplicateWarning |
| [gate.ts](../../apps/builder/server/lib/gate.ts) | D2 ④ still-failing variant reuse (no new shape if the ③ variant fits) |
| [store.ts](../../apps/builder/web/src/store.ts) + [state/task.ts](../../apps/builder/server/state/task.ts) | D5 `rev` field + guard |
| [dify-io.ts](../../apps/builder/server/lib/dify-io.ts) | D6 disambiguator |
| [test.md](../../.claude/skills/dify-build/test.md) | D2 CLI mirror |
| [009-browser-workflow-builder.md](009-browser-workflow-builder.md) | AC #15/#16/#25 wording update (D1) |
| `apps/builder/test/*` | advance-loop cases (D1/D2/D4), recovery torn-marker (D3), store rev-guard (D5), dify-parsers (D6) |

## Open questions

- **Q1 — lint-fail ④ terminal:** `error` (Retry) vs a ④ still-failing **accept-gate** (Accept anyway /
  Keep trying / Discard)? *Recommended: accept-gate — consistent with ③ and the human-consent theme;
  `auto` hard-stops either way.* This decides whether `auto` may ever land a lint-failing build (it may
  not, by AC #25).
- **Q2 — deploy-gate scope:** D1 keys off the gate **flag**, so `spec_only` also parks at deploy. Keep
  that (recommended, safer) or restrict the new hard-stop to `mode==='auto'` only?
- **Q3 — reconcile disambiguator (D6):** what does `sync.py list` expose (created-at? a stable id)? The
  fix may need a `sync.py --json-out` field, else it degrades to "best-effort + warn".
- **Q4 — `rev` source (D5):** a persisted `task.rev` counter (migrates existing `.runs/` task.json) vs
  derive ordering from the SSE event id only? And confirm with the R8 repro before shipping.
- **Q5 — cloud consent (optional):** should `cloud` ④ also park at a "copy-YAML / Studio steps" gate for
  consistency with D1, or stay terminal `done` with the report note? *Default: stay `done`.*

## Acceptance criteria

1. `auto` + `selfhost` runs ①→④ and **parks** at `awaiting_import`; the import fires only on an explicit
   confirm. An advance-loop test proves `auto` no longer reaches `done` via an auto-import (AC #16/#25
   reworded in spec 009).
2. A lint-failing ④ on `deploy=none|cloud` does **not** become a plain `done`: it parks (or errors) and,
   if finished, carries `accepted_lint_failure`. `auto` hard-stops. `test.md` mirrors the rule.
3. A simulated crash between the pre-push marker write and `pushApp` leaves a durable marker; the re-run
   **reconciles, never re-pushes** (no duplicate app) — proven by a `recovery.ts` torn-marker test.
4. A `/reply` that times out parks at `status:error` and does **not** trigger a second full turn (test
   feeds a `{isError, note}` resume result).
5. A reconnect GET resolving after a newer `task:update` does **not** revert the UI (store rev-guard test;
   closes 011 R8).
6. `reconcileAppIdByName` never silently attaches a wrong app when ≥2 names match — it surfaces
   "ambiguous — verify in Dify" (dify-parsers test).
7. D7 items done; cloud/none edit-existing carries the duplicate warning. `npm run typecheck` + `npm test`
   (server + web) + CI `builder` green.

## References

- [013](013-builder-linter-contract-and-test-seams.md) — `linters.ts`/`lintClean` (D2 gate), `resolveRunners`
  seams + advance-loop harness (all tests here).
- [011](011-builder-test-coverage-and-remediation.md) — supersedes backlog **R8** (D5), **R14** (D7),
  **R15** (D7). [012](012-builder-image-attachments.md) — **D1 bodyLimit** (D7).
- This session's audit (INT cluster sizing) + the `auto`-deploy trace that scoped D1.
- Code: [orchestrator.ts](../../apps/builder/server/lib/orchestrator.ts) (`maybeAutoAdvance`,
  `runTestAndFinish`, `runImportAndFinish`) · [recovery.ts](../../apps/builder/server/lib/recovery.ts) ·
  [dify-io.ts](../../apps/builder/server/lib/dify-io.ts) · [gate.ts](../../apps/builder/server/lib/gate.ts).

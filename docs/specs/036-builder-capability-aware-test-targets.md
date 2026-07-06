# Spec 036 — Capability-aware test targets: defer `deploy`/`test` from the composer to the test gate

**Status**: Draft — authored for implementation. Medium size, spans FE composer + BE gate/orchestrator.
Scope is **self-host + local only**; **Cloud is explicitly deferred** (see §8 Future work) — the design leaves a
reserved seam so cloud drops in additively later, with no refactor. D1–D5 recommended.

**Rev A** (2026-07-06): three corrections after a code-level review — **(a)** the `awaiting_import` retarget (D4) is
**Option A** — only a **human** (`each step`/non-autonomous) build parks at the Import gate; `auto`/`spec_only`
finish `done` on the static test and stay hands-free (keeps AC #4 literally true); **(b)** whichever path *does*
import must stamp `deploy='selfhost'` or a real import mislabels as `deploy=none` (`DEPLOYED · none`, AC #9);
**(c)** the done-state live action (D5) shows only for the autonomous set `{auto, spec_only}` (they never saw the
implement-gate live button; `each step` did), and needs a new `liveTargets.selfhost` **wire field** so the FE-side
gate-foot can evaluate reachability (the FE can't probe env). Shorthand used below:
`isAutonomous ≡ confirmMode==='auto' || confirmMode==='spec_only'` (the `boundaryAutoAdvances`-autonomous set;
`null`/corrupt fails safe to **non**-autonomous = human).

**Builds on**:
- [032](032-builder-live-workflow-test.md) — the live-test sub-orchestrator (`runLiveTest`: model-inject →
  import-as-new-app → run → verify), the `testMode: 'static' | 'live'` field, and `liveAvailable`
  (`orchestrator.ts` `gateAfterPhase`). This spec **inverts** 032's start-bound `testMode`: the static-vs-live
  choice moves from an upfront composer chip to a capability-aware action at the gate.
- [035](035-builder-edit-again-from-done.md) — the done/cancelled gate-foot (`gate-foot.ts` `canRestore` /
  `canEditAgain`, `GateCard`'s foot ternary). This spec adds a **third** done-state action ("Run test with
  workflow") alongside Restore / Edit-again, per the user's "khi done ở list select có thêm run test workflow".
- [014](014-builder-terminal-correctness-and-state-integrity.md) D1 / report.ts — the `deploy: 'none' | 'selfhost' | 'cloud'` field, the
  `awaiting_import` gate (Import to Dify), and the cloud CSRF constraint (`cloudStudioNote`: auto-import is
  blocked → copyable-YAML manual path).

> **Reference the SYMBOL, not the line.** Specs 032–035 have drifted FE line numbers by 15–130 lines. Every
> `file:symbol` below is a pointer to the named function/const; re-grep before editing.

---

## 1. Problem

The composer settings row carries **5 start-bound chips** — `Workflow · Confirm · Deploy · Fast build · Test`
(`Chat.tsx` composer, the `SettingSelect` block). Two of them, **Deploy** and **Test**, are chosen *before the
build starts* yet have **zero effect until the build reaches the test/import stage**:

- Grepping every read of `task.deploy` and `task.testMode` across `apps/builder/server`: neither is consumed
  during Analyze / Spec / Implement. `main.yml` is written deploy-agnostic (032 B5). They first matter at the
  implement→test boundary (`liveAvailable`), the test gate (`awaiting_import`, `test_result`), import, and the
  report note.
- Live-test availability is **already capability-detected**: `liveAvailable = phase==='implement' &&
  deploy==='selfhost' && creds.url && creds.token` (`gateAfterPhase`). The `deploy=selfhost` term is a
  redundant upfront *declaration* of something the creds probe already knows.
- In **`each step`** mode the implement gate already renders **both** buttons — "Continue to Test" (static) +
  "Test with workflow" (live) — so the test-time selector the user wants *already exists*. The upfront `Test`
  chip only disambiguates for **`auto`** mode (`maybeAutoAdvance`'s `testMode==='live' → primary=test_live`).

So the user is asked to declare two things up front that (a) don't influence the build until the end and
(b) are better answered by *what is actually reachable right now*. This spec makes the choice
**capability-driven at the test gate** instead of **declared at the composer**.

A secondary limitation: creds are a **single set** — `DIFY_CONSOLE_URL` + `DIFY_CONSOLE_TOKEN`
(`dify-io.ts` `difyCreds`). There is no way to hold *both* a self-host target and a cloud target; `deploy`
merely re-labels the same creds (and cloud auto-import is CSRF-blocked anyway). The user wants
**self-host and cloud creds separated** so both can be offered when both are configured. **This spec does not
solve cred separation — it is deferred with cloud to §8**; the `DifyTargets` capability set (D1) is the seam that
will carry it additively.

## 2. Goals

1. Remove the **Deploy** and **Test** chips from the composer. Row goes **5 → 3** (`Workflow · Confirm · Fast
   build`), easing the nowrap/truncation pressure on the settings row.
2. At the **test gate**, present **capability-aware** actions derived from *which creds are present now*:
   - no creds → static test only ("Continue to Test");
   - self-host creds → add **"Test with workflow"** (live import + run).
   - *(cloud → deferred, §8.)*
3. **`auto`/`spec_only`** never live-tests autonomously — it always runs **static**. Live is a human action,
   reachable **from the `done` state** via a new gate-foot select ("Run test with workflow").
4. Model live targets as a **capability set** (`difyTargets()`) with a reserved `cloud` slot, so adding cloud
   later is additive — no gate/orchestrator refactor.

## 3. Non-goals

- **N1** — Not touching Analyze / Spec / Implement content generation. main.yml stays deploy-agnostic.
- **N2** — Not changing `Confirm`, `Workflow`, or `Fast build`. They are genuinely start-bound (they steer the
  build from phase 1) and stay on the composer.
- **N3** — Not removing the `task.deploy` / `task.testMode` **persisted fields**. They stay in the schema for
  back-compat and for `report.ts`; only *where they are set* changes (gate-time, not create-time).
- **N4** — **Cloud is out of scope for this spec** — no cloud creds, no cloud gate action, no cloud env vars.
  It ships later as a purely additive follow-up (§8). Self-host is the one live target here.
- **N5** — No secrets in SSE / `.runs` JSON. This spec adds **no new env vars** (D2), so `redactSecrets` is
  **unchanged** (same secret set); the new `liveTargets.selfhost` wire field is a **boolean** (reachable or not),
  never the creds. (The cloud token joins `redactSecrets` only when §8 lands.)

---

## 4. Design decisions

### D1 — Capability detector replaces the `liveAvailable` boolean *(recommended)*

Add `difyTargets()` in `dify-io.ts` returning which live targets are reachable **now**, from separated creds:

```ts
export interface TargetCreds { url: string; token: string; workspaceId?: string; }
export interface DifyTargets { selfhost?: TargetCreds; cloud?: TargetCreds; }
export function difyTargets(): DifyTargets { /* read env, see D2 */ }
```

`gateAfterPhase` computes `const targets = difyTargets()` and threads it into `computeGate` **in place of** the
`liveAvailable: boolean` param. `computeGate` stays pure (targets are passed in, never probed inside it).

### D2 — No env changes now; cloud vars are a reserved future seam *(recommended)*

Because cloud is deferred (§8), there is only **one** live target, so **no credential separation or env rename is
needed**. `difyTargets().selfhost` reads the **existing** `DIFY_CONSOLE_URL` / `DIFY_CONSOLE_TOKEN` (+ optional
`DIFY_WORKSPACE_ID`) verbatim — zero migration for existing operators. `difyCreds()` is retained as an alias of
`difyTargets().selfhost` so its current call sites (`buildEnv`, `runLiveTest`, `import.ts`, `recovery.ts`) keep
compiling unchanged.

The `cloud` slot on `DifyTargets` (D1) stays present but **always `undefined`** in this spec. When cloud lands
(§8) it reads its own `DIFY_CLOUD_URL` / `DIFY_CLOUD_TOKEN` and populates that slot — an additive change that
touches only `difyTargets()` and the cloud gate action, not the gate/orchestrator wiring.

### D3 — Composer drops Deploy + Test; gate becomes the selector *(recommended)*

- **FE**: delete the two `SettingSelect`s for `deploy` and `testMode` from the composer (`Chat.tsx`). The
  `settings` object keeps `workflow / confirm / fast`; drop `deploy / test` from the composer wire (`store.ts`
  `splitWorkflowSetting` / `start()` no longer sends them). Remove the now-dead i18n keys
  `deploy / deployFixed / selfhost / cloud / testMode / testStatic / testLive / testHint` (EN + JA) **only if**
  no other view references them — grep first (`report`/gate labels may reuse `selfhost`/`cloud`).
  - **One string is a *rewrite*, not a deletion (Rev A)**: the report note `noteDeployOff` (`i18n.ts`) reads
    *"Deploy is off — no app URL. **Set Deploy ≠ none** to import & get a link."* It still fires for a genuine
    `deploy=none` report, but now points the user at a chip that no longer exists. Reword it to reference creds,
    e.g. *"No Dify target configured — no app URL. Set `DIFY_CONSOLE_URL` / `DIFY_CONSOLE_TOKEN` to import & get a
    link."* (EN + JA). Its `report` rows `rDeploy` / `rNotDeployed` / `deployedTag` stay as-is.
- **BE**: `createTask` defaults `deploy: 'none'`, `testMode: 'static'` (it no longer reads them from `input`).
  The values are (re)written at gate-time when a live target is chosen (D5).

### D4 — Test-gate actions are capability-aware *(recommended)*

Replace the single `liveAvailable ? [CONFIRM('test_live', 'Test with workflow')]` at the **implement** gate
(`gate.ts`) with a target-driven list. `continue` (static) stays **first** (the safe default):

```
CONFIRM('continue', 'Continue to Test')                                  // always
targets.selfhost ? CONFIRM('test_live', 'Test with workflow') : —        // live import+run vs self-host
// targets.cloud → 'Test with cloud'  (reserved seam, §8 — NOT emitted in this spec)
REPLY('changes', 'Request changes'); DISCARD()
```

`test_live` dispatches to `runLiveTest` with the self-host `TargetCreds` (D1/D2). On dispatch, stamp
`task.deploy = 'selfhost'` and `task.testMode = 'live'` so `report.ts` and the `/reply`-re-runs-live path
(`replyWithin`'s `testMode==='live'`) keep working unchanged. The `awaiting_import` selfhost gate trigger
(`orchestrator.ts` `deploy==='selfhost' && lintClean`) becomes **`targets.selfhost && lintClean && !isAutonomous`**
— **Option A (Rev A)**. Import is offered **to a human** when self-host is reachable (not when it was declared),
but the autonomous modes `{auto, spec_only}` do **NOT** park at Import: they finish `done` on the static test and
reach Dify only via the D5 done-state action. This keeps `auto` hands-free with creds present and makes AC #4
literally true. `each step` — and any `null`/corrupt mode (fail-safe to human) — still parks at the Import gate.
**Trade-off**: an `auto` build has **no inline deploy-import**; deploying an autonomous build to Dify is a human
action from `done` (the D5 live path — a dedicated done-state *Import* is future work, out of scope here).

**Whichever path *does* import must stamp `deploy` (correctness — Rev A).** `continue` (static, "Continue to Test")
does **not** stamp `deploy`. Under Option A the static→import park now happens only at an **`each step`** implement
gate on a creds machine — but there `task.deploy` is still `'none'`. If the user clicks **Import to Dify**, the push
succeeds (`import.ts` reads creds directly, not `task.deploy`) yet `report.ts` — which branches entirely on
`task.deploy` (`deploy==='none' | 'selfhost' | 'cloud'`) — writes `deploy: 'none'` + `deploy=none (no Dify
contact).` alongside a real `app_url`, and `ArtifactPanel` renders the contradiction **`DEPLOYED · none`** +
**"not deployed (local)"** (`ArtifactPanel.tsx` `deployedTag` / `rNotDeployed`). Fix: when the retargeted park is
taken, set `task.deploy = 'selfhost'` **before** `runReport` (`orchestrator.ts`, the
`targets.selfhost && res.lintClean && !isAutonomous` branch that produces `awaiting_import`), symmetric to the
`test_live` stamp above. `testMode` stays `'static'` (it *was* a static test — only `deploy` moves). This is a
**net-new** defect introduced by the retarget; guarded by AC #9.

> **Stamp location (implementer note):** `runReport` runs **twice** — once as the initial static report (before the
> park), then again inside the Import/Skip dispatch (`runImportAndFinish` / `finishWithoutImport`). Stamp
> `task.deploy='selfhost'` **in the park branch** (before `computeGate(...'awaiting_import')`); the Import/Skip
> re-report then labels `selfhost`. The brief parked-window `report.json` still reads `deploy:none` (written by the
> first report) — harmless, it is overwritten on Import/Skip. (Equivalently, stamp at the start of both dispatch
> handlers; observable final reports are identical.)

### D5 — `auto` is always static; live is a done-state action *(recommended)*

- **Simplify `maybeAutoAdvance`**: remove the `phase==='implement' && testMode==='live' → primary=test_live`
  branch (`orchestrator.ts`). Autonomy's primary at the implement gate is **always** `continue` (static). Net:
  `auto`/`spec_only` never touch Dify without a human — the current 032 `auto+live` path is deleted, not
  reworked.
- **New done-state action**: extend the done/cancelled gate-foot (035 `gate-foot.ts` + `GateCard`) with a third
  action, gated on self-host being reachable, an on-disk workflow existing, **and the build having run in an
  autonomous mode** — `status==='done' && workflowSlug && !!targets.selfhost && (confirmMode==='auto' ||
  confirmMode==='spec_only')`. Label: **"Run test with workflow"**.
  - **Why `{auto, spec_only}` and NOT `each step` (Rev A)**: both `auto` and `spec_only` auto-advance **past** the
    implement gate (`boundaryAutoAdvances` pauses `spec_only` only at Spec, `auto` never), so **neither ever sees**
    the implement-gate "Test with workflow" button (D4) — they reach `done` on a static test and this done-state
    action is their *only* live path. `each step`, by contrast, was already offered live at the implement gate, so
    re-offering it at `done` is redundant → excluded. The predicate is the `boundaryAutoAdvances`-autonomous set;
    a `null`/corrupt `confirmMode` fails safe to *excluded* (treated as `each step`). This matches §2 Goal 3
    ("`auto`/`spec_only` … Live is a human action reachable from `done`").
  - It invokes `runLiveTest` on the finished workflow (same sub-orchestrator, re-entered from `done`). **On
    dispatch, stamp `task.deploy='selfhost'` + `task.testMode='live'`** (exactly as D4 does for `test_live`) so the
    re-run `report.ts` labels the verdict as a real self-host live test, not `deploy=none` — same defect class as
    the D4 static-path fix. When cloud lands (§8) this becomes a small select if more than one target exists —
    additive, not a rewrite.
  - **FE wiring (Rev A)**: `terminalFootActions` runs **FE-side** (`web/src/lib/gate-foot.ts`), so the
    self-host-reachable bit must be on the wire — the FE cannot call `difyTargets()`. Add
    `liveTargets: { selfhost: boolean }` to the task wire (`state/task.ts` serialization + SSE `emit`), set to
    `{ selfhost: !!difyTargets().selfhost }`; future cloud adds `cloud` additively (mirrors `DifyTargets`).
    `confirmMode` is **already** on `WireTask` (`types.ts`), so the `isAutonomous` gate needs no new field.
  - **Backend route (Rev A — BLOCKER)**: `done` is **not** `awaiting_confirm`, so this action **cannot** go through
    `/confirm` — `confirmAdvance` hard-guards `status==='awaiting_confirm'` (throws 409) and a `done` task has no
    `gate.actions` to match. Add a **dedicated route** `POST /api/tasks/:id/live-test` (mirroring 035's `/restore`):
    **re-check server-side** `status==='done' && workflowSlug && !!difyTargets().selfhost && isAutonomous` (never
    trust the FE), `acquireTurn` (turn-lock, 409 if a turn is live), stamp `deploy='selfhost'/testMode='live'`, flip
    `done → running`, then `dispatch(runLiveTest(task, ctx))`. FE calls it via `api.liveTest(id)` (like
    `api.restore`) from the gate-foot button.
  - **Re-entry note**: `runLiveTest` today is reached from the implement→test gate. Re-entering from `done`
    means the test-result gate (`test_result`) must be reachable from a previously-terminal task — confirm the
    status transition `done → running → awaiting_confirm(test_result) → done` is legal and that `GateCard`
    re-renders the verdict foot. This is the main integration risk of D5; verify with a live run (S5).

---

## 5. Implementation slices

> **Order (Rev A): S2 → S3 → S1 → S4 → S5.** S1 alone is **NOT** safe: `createTask` defaulting `deploy:'none'`
> makes the *old* `liveAvailable` (`deploy==='selfhost' && creds`) and the old `awaiting_import` trigger
> (`deploy==='selfhost'`) **always false** — dropping the live button AND the selfhost Import gate. So rewire the
> gate to `targets.selfhost` (S2+S3) **first**; only then remove the chips (S1). During S3 the (still-present) Deploy
> chip becomes an inert no-op — harmless until S1 deletes it.

- **S1 — Composer simplification (do AFTER S3).** Delete the Deploy + Test `SettingSelect`s (`Chat.tsx`); drop
  `deploy/test` from the composer `settings` wire (`store.ts`); default them in `createTask` (`task.ts`). Update FE
  store/composer tests + `store.test.ts`. Update `i18n` (remove dead keys; **rewrite** `noteDeployOff`, D3).
- **S2 — `difyTargets()` capability detector (BE).** Add `difyTargets()` returning `{ selfhost? }` from the
  **existing** `DIFY_CONSOLE_*` vars (cloud slot present but always `undefined`, §8); re-express `difyCreds()` as
  an alias. No new env vars, no `redactSecrets` change (same secret set). Unit-test detected vs absent.
- **S3 — Capability-aware implement gate (BE).** Thread `DifyTargets` through `gateAfterPhase → computeGate`
  (replace `liveAvailable`); emit `test_live` for self-host; stamp `deploy/testMode` on `test_live` dispatch;
  retarget the `awaiting_import` trigger to **`targets.selfhost && !isAutonomous`** (**Option A** — `auto`/`spec_only`
  finish `done` static, only `each step`/human parks at Import). **Also stamp `deploy='selfhost'` on that retargeted
  static → `awaiting_import` park** (D4 Rev-A correctness — before `runReport`) so a human static "Continue to Test"
  + creds → import labels as `selfhost`, not `none`. Keep the `'Test with workflow'` label + JA mapping
  (`ACTION_JA`). Unit-test: (i) `auto`/`spec_only` + creds → `done` (no Import park); (ii) `each step` + creds →
  Import park then `deploy: 'selfhost'` after a faked import.
- **S4 — auto=static (BE).** Remove the `testMode==='live'` primary-pick from `maybeAutoAdvance`. Update the 032
  auto+live tests (they now assert `auto → static`).
- **S5 — Done-state live action (FE + BE).** Third gate-foot action (035 `gate-foot.ts` + `GateCard`), gated on
  `liveTargets.selfhost && isAutonomous` (D5 — autonomous modes only; `each step` excluded, it saw the
  implement-gate button). **Add `liveTargets.selfhost` to the WireTask** (serialize backend-side from
  `difyTargets()`; the FE can't probe env) — `terminalFootActions` reads it + the already-wired `confirmMode`.
  Stamp `deploy='selfhost'/testMode='live'` on dispatch. **Add route `POST /api/tasks/:id/live-test`** (`done` isn't
  `awaiting_confirm`, so `/confirm` 409s — this is a dedicated route like 035's `/restore`): server-side re-check of
  the gate + `acquireTurn` + `done → running` + `dispatch(runLiveTest)`; FE `api.liveTest`. Verify the
  `done → running → test_result → done` transition (D5 risk). Extend `terminalFootActions` (035) to return the third
  flag and unit-test the mode gating (auto/spec_only → shown; each_step/null → hidden).

## 6. Acceptance criteria

1. Composer shows exactly **3** chips (`Workflow · Confirm · Fast build`); Deploy + Test are gone. *(S1)*
2. With **no** Dify creds, the implement gate shows only "Continue to Test" — no live action. *(S3)*
3. With **self-host** creds, the implement gate shows "Continue to Test" **and** "Test with workflow"; the
   latter runs a real import+run and lands on the `test_result` verdict gate. *(S3)*
4. `auto` / `spec_only` builds **never** live-test autonomously **and never park at the Import gate** — they finish
   `done` on a clean static test even when self-host creds are present (Option A), reaching Dify only via a later
   human action. *(S4, D4)*
5. An **`auto`** *or* **`spec_only`** build that finished **`done`** with self-host creds present shows a "Run test
   with workflow" action in the gate-foot that triggers a live test; on an **`each step`** done build (it already
   saw the implement-gate live button) — or with no creds — the action is **absent**. *(S5)*
6. Existing operator setups using `DIFY_CONSOLE_URL`/`DIFY_CONSOLE_TOKEN` keep working with **no config change** —
   `difyTargets().selfhost` reads them directly. *(S2)*
7. Old `task.json` files carrying `deploy`/`testMode` still load and report correctly (fields untouched at
   read). *(S1, N3)*
8. **No cloud surface** ships: no cloud chip, no cloud gate action, no cloud env var. *(N4)*
9. **Deploy-label correctness (Rev A):** after a **static** "Continue to Test" on a machine with self-host creds,
   clicking **Import to Dify** yields a report/panel labelled **`selfhost`** (report `deploy: 'selfhost'`, card
   `DEPLOYED · selfhost`, note `imported to Dify: <url>`) — **never** the `deploy=none` / `DEPLOYED · none` /
   "not deployed (local)" contradiction. Same holds for the D5 done-state live path. *(S3, S5)*

## 7. Back-compat & risks

- **Persisted schema unchanged** (N3): `deploy`/`testMode` stay; only their *write site* moves from `createTask`
  to gate dispatch. Old task.json loads verbatim.
- **Env unchanged** (D2): self-host reads the existing `DIFY_CONSOLE_*`; no new vars, no operator action.
- **Deploy-label consistency — net-new (Rev A / D4)**: the `awaiting_import` retarget lets the *static* path reach
  Import whenever creds exist, but `report.ts` / `ArtifactPanel` branch on `task.deploy`, so the static path MUST
  stamp `deploy='selfhost'` at the park (and D5 at re-entry) — otherwise a real import reports `deploy=none` /
  `DEPLOYED · none` / "not deployed (local)". Covered by AC #9; unit-test both stamps.
- **Biggest risk — D5 re-entry**: driving `runLiveTest` from a terminal `done` task exercises a status
  transition (`done → awaiting_confirm(test_result)`) that 032 only produced from the implement gate. Must be
  verified end-to-end on real Dify (per the test-harness memory: LIVE✓ card + real output), not just unit tests.
- **Dead i18n**: only remove `deploy`/`test` i18n keys after grepping — `selfhost`/`cloud` strings may be reused
  by report/gate labels.

## 8. Future work — Cloud *(deferred, additive)*

Cloud is intentionally **out of scope** here. The design leaves it a clean drop-in; when it's wanted, add:

1. **Creds** — `DIFY_CLOUD_URL` (default `https://cloud.dify.ai`) + `DIFY_CLOUD_TOKEN`; populate
   `difyTargets().cloud`. Extend `redactSecrets` to the cloud token. *(only `dify-io.ts`)*
2. **Gate action** — emit `test_cloud` in `gate.ts` when `targets.cloud` is set (the reserved seam in D4);
   the done-state foot (D5) becomes a self-host / cloud select when both exist.
3. **Cloud run mechanics — the one open question** — cloud console auto-import is **CSRF-blocked**
   (`report.ts` `cloudStudioNote`), a block on the session-cookie endpoint. A spike must decide:
   - **(a)** a cloud API key (bearer, not cookie) can drive import+run → `test_cloud` is a true live run; or
   - **(b)** it cannot → `test_cloud` is "Prepare cloud import" (copyable YAML + Studio steps, no live run).

Because targets are a set (D1) and the gate/orchestrator already branch per target, none of the above touches
the self-host path — it is purely additive.

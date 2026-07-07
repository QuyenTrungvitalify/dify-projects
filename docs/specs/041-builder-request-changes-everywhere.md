# Spec 041 — "Request changes" at every parked gate from Spec onward

**Status**: **Implemented** (2026-07-07, same day as authored) — D1+D2 landed with tests. **Backend-only**
(`gate.ts` + `orchestrator.ts` + their tests). No frontend change, no i18n change (the `Request changes`
label reuses the existing `変更を依頼` mapping), no new deps, no Dify-contact change. Landed riding commit
`1984215` (the concurrent spec-037 batch). Post-landing verification (2026-07-07, after 037/038 completed):
all 5 acceptance items re-checked against the tree — `gate.test.ts` + `advance-loop.test.ts` 28/28,
repo-wide `tsc` clean, full server suite 376/376.

Files touched: `server/lib/gate.ts` (D1) · `server/lib/orchestrator.ts` (D2) · `test/gate.test.ts` +
`test/advance-loop.test.ts` (tests).

> **Reference the SYMBOL, not the line.** Line links verified 2026-07-07; re-grep before editing.

**Motivation (user)**: *"the user has a need to fix the workflow at ANY time — after the Spec exists,
'Request changes' should always be in the gate options."* Reported from a `LIVE ⚠` (infra-degraded) ④
gate whose only actions were `Retry live` / `Accept static` / `Discard` — no way to edit the workflow
without the round-trip **Accept static → done → "Edit this workflow"** (spec 035).

**Builds on**:
- [033](033-builder-gate-qa-chat-mode.md)/[034](034-builder-test-gate-terminal-qa.md) — Ask vs
  Request-changes; a `REPLY('changes')` gate action is what arms the composer's change-mode
  (`onArmChange`, [App.tsx:389,415](../../apps/builder/web/src/components/App.tsx#L389)). Adding the
  action to more gates reuses that FE path verbatim — **no frontend change**.
- [032](032-builder-live-workflow-test.md)/[036](036-builder-capability-aware-test-targets.md) — the
  test-gate "Request changes" that already routes a ④ revision through Implement
  ([orchestrator.ts:198-214](../../apps/builder/server/lib/orchestrator.ts#L198-L214)); 041 generalizes
  that routing from "live only" to "any ④ gate".

---

## Context — which gates already offer it, and the three that don't

`REPLY('changes'|'edit')` = the within-phase revise that re-runs a phase to edit its artifact. Current
map (from [gate.ts](../../apps/builder/server/lib/gate.ts) `computeGate`):

| Phase / outcome | Has a Request-changes reply? |
|---|---|
| analyze success | ✅ `Request changes` |
| **spec** success | ✅ `Edit spec` |
| implement success (clean) | ✅ `Request changes` |
| implement `still_failing` | ✅ *effectively* — `Keep trying` (`REPLY('keep')`) re-runs Implement WITH the typed guidance |
| test `test_result` (LIVE ✓/✗) | ✅ `Request changes` |
| **test `awaiting_import`** (selfhost import gate) | ❌ Import / Skip / Discard only |
| **test `infra_degraded`** (LIVE ⚠) | ❌ Retry live / Accept static / Discard only |
| **test `still_failing`** (④ re-lint failed) | ❌ Accept / Discard only |

The three ❌ rows are the gap. `implement still_failing` is **not** in scope: `Keep trying` is already a
text-carrying reply that re-runs Implement with the user's guidance — the same fix path under a
phase-appropriate label (adding a 4th button there would duplicate it). Analyze is before Spec (already
has it anyway).

## Why the naive "just add the button" is a trap

`REPLY('changes')` at a ④ gate is only USEFUL if the reply actually **edits `main.yml`**. Today
`replyWithin` ([orchestrator.ts:198](../../apps/builder/server/lib/orchestrator.ts#L198)) routes a
test-phase reply through Implement **only when `task.testMode === 'live'`**; on the static path it just
re-runs the report (`runTestAndFinish`) — the change text is dropped and the edit silently no-ops (the
exact class of bug the 032→036 fix warned about). So:
- `infra_degraded` is **live** (`runLiveTest` produced it) → adding the button works with the current
  routing. ✅
- `awaiting_import` and `test still_failing` are **static** → the button would no-op unless the routing
  is generalized. So D2 is required, not optional.

---

## Decisions

### D1 — Add `REPLY('changes', 'Request changes')` to the three ④ gates (`gate.ts`)

Mirror the `test_result` placement (revise-reply right after the primary confirm(s), before Discard):

- `awaiting_import` → `[import, skip_import, **changes**, discard]`
- `infra_degraded`  → `[retry_live, accept_static, **changes**, cleanup_apps, discard]`
- `test still_failing` → `[accept, **changes**, discard]`

`test_result` / analyze / spec / implement stay byte-identical. Labels use the existing `Request changes`
string → `tAction` already maps it to `変更を依頼` (no i18n change). The FE renders a `kind:'reply'`
action as the change-mode arm exactly as it does for `test_result` (no frontend change).

### D2 — A ④-gate revision always routes through Implement (`orchestrator.ts replyWithin`)

Broaden the test-phase revision branch from `testMode === 'live'` to **"this is a gate revision"**,
distinguished from a Retry-out-of-error by `task.status`:

```ts
if (task.phase === 'test') {
  // Spec 041: a "Request changes" at ANY ④ gate (status was awaiting_confirm) is a WORKFLOW revision →
  // resume the Implement session, edit main.yml with the change request, re-park at the Implement gate.
  // Holds for the live gates (test_result/infra_degraded) AND the static gates (awaiting_import/
  // still_failing). A Retry OUT OF ERROR (status 'error') is NOT a revision — it re-runs ④ (unchanged).
  if (task.status === 'awaiting_confirm' && task.sessionIds.implement) {
    await runPhaseAndGate(task, 'implement', ctx, { resumeId: task.sessionIds.implement, replyText: text });
    return;
  }
  if (task.testMode === 'live') { // error-retry on the live path — unchanged
    await runPhaseAndGate(task, 'implement', ctx, { resumeId: task.sessionIds.implement, replyText: text });
    return;
  }
  await runTestAndFinish(task, ctx, false); // error-retry on the static path — unchanged
  return;
}
```

- **`status` is a reliable signal**: `/reply` requires `awaiting_confirm | error`
  ([tasks.ts:321-324](../../apps/builder/server/routes/tasks.ts#L321-L324)), and `replyWithin`'s first
  statement reads `task.status` before any mutation (the async body runs synchronously to the first
  `await`). A gate revision is always `awaiting_confirm`; a Retry is always `error`.
- **The live gates are unchanged in effect**: `test_result`/`infra_degraded` are `awaiting_confirm`, so a
  revision there hits the new first branch → Implement — identical outcome to today
  ([advance-loop.test.ts:342](../../apps/builder/test/advance-loop.test.ts#L342) still green; it sets
  `status='awaiting_confirm'`).
- **The error-retry paths are unchanged**: `status==='error'` falls through to the pre-041 branches.
- **Guard `&& task.sessionIds.implement`**: if (defensively) there is no Implement session to resume,
  fall through to the old behavior rather than crash.

### Out of scope
- `implement still_failing` — `Keep trying` already covers it (D-map note above).
- Terminal `done`/`cancelled` builds — spec 035's **"Edit this workflow"** is the terminal-state
  equivalent (a fresh edit-existing build); a parked-gate reply doesn't apply there.
- No new gate FSM states; no change to `confirm` actions, imports, or live-test mechanics.

---

## Acceptance

1. `computeGate('test', 'awaiting_import')`, `'infra_degraded'`, and `'still_failing'` each include a
   `kind:'reply'` action with id `changes`, label `Request changes`, in the documented order; the other
   gates are byte-identical (pinned by `gate.test.ts`).
2. A `/reply` at a **static** ④ gate (`awaiting_import` / `still_failing`, `status==='awaiting_confirm'`)
   re-runs the **Implement** turn (edits `main.yml`) and re-parks at the Implement gate — it does NOT
   re-run the report on the unchanged workflow (new `orchestrator`/`advance-loop` test).
3. A `/reply` at a **live** ④ gate still routes through Implement (unchanged — existing test green).
4. A Retry-out-of-error at ④ (`status==='error'`) is unchanged: static → report re-run, live → implement.
5. No frontend, i18n, linter, Dify-IO, or gate-FSM change. Disjoint from spec-038's files.

## Verify
- Backend: `gate.test.ts` (action sets) + `advance-loop.test.ts` (routing) green; typecheck clean.
- Manual: at a `LIVE ⚠` gate, `Request changes` now appears → typing a change re-runs Implement →
  re-park at Implement → `Test with workflow` again.

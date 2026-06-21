# Spec 016 — Gate & 4-phase UX hardening

**Status**: Implemented (2026-06-21) — web build + vitest green; no backend change
**Effort**: S
**Depends on**: [014](014-builder-terminal-correctness-and-state-integrity.md) (consumes the `awaiting_import` gate it now ALWAYS reaches; 014 §Non-goals explicitly assigned this card's copy/affordances to 016)

> **Frontend-only, no backend change.** Everything lands in `apps/builder/web/src` (Chat.tsx, ArtifactPanel.tsx,
> store.ts, phase.ts, i18n.ts). It rides the gate contract the backend already produces (`gate.actions[]` +
> `gate.flag`) — 016 only renders those gates with correct, distinct, safe affordances.

## Context

The gate cards drive the whole human-in-the-loop flow, but a few gates render wrong, crash, or miss an
affordance — verified on current code:

**(C1) The deploy gate renders blank — and after 014 it's now ALWAYS reached.** `gateView`
([Chat.tsx:143-155](../../apps/builder/web/src/components/Chat.tsx)) has cases for analyze/spec/implement and
a `still_failing` pre-check, but **no branch for `gate.flag === 'awaiting_import'`** → it falls to the
`default` returning badge `Ready` / title `Continue` / empty summary ([:153-154](../../apps/builder/web/src/components/Chat.tsx)).
This is the single most consequential gate — it pushes the workflow into a live Dify workspace — and spec
**014 D1** made `auto`/`spec_only` PARK here too, so **every selfhost build now stops at this blank card**.
The user is asked to click a green **Import to Dify** next to a green **Skip import** with no copy, no target
named, and no hint of the duplicate-app footgun.

**(C2) An unexpected phase crashes the whole chat.** `phaseIndex(unknown)` returns `0`
([phase.ts:17-18](../../apps/builder/web/src/lib/phase.ts)), and two call sites dereference `PHASE_LABELS[idx-1]`
unguarded — `Chat.tsx:79` (Disclosure) and `Chat.tsx:124` (gateView error title) — so a single unexpected
`phase` string from the backend throws `PHASE_LABELS[-1].key` and blanks the entire thread. This is spec 011's
**R7 hazard**; 011 extracted the table to `phase.ts` and `phase.test.ts:30-33` documents the crash as still
open — it was never guarded.

**(C3) Cloud deploy has no Copy button.** For `deploy=cloud` the entire deploy story is "paste the YAML into
Studio", yet `YamlTab` ([ArtifactPanel.tsx:168-211](../../apps/builder/web/src/components/ArtifactPanel.tsx))
renders a bare `<pre>{yaml}</pre>` with no copy affordance (grep: no `navigator.clipboard` in `web/src`). The
`I.copy` icon already exists and is unused.

**(C4) Unsafe/ambiguous affordances (polish).** Import vs Skip are identical green buttons (`btnClass`
[:178-183](../../apps/builder/web/src/components/Chat.tsx) returns `ok` for both); **Accept-anyway** (ship a
lint-failing build) and **Discard/Abandon** (terminal cancel) fire in one click with no confirm, while the
reversible Stop pill *does* confirm via `askConfirm` (App.tsx:144-156); the reply resolved-label is hardcoded
`Requested changes` ([store.ts:346](../../apps/builder/web/src/store.ts)) even after "Edit spec"/"Keep trying".

## Goals

1. Every gate the backend can produce renders with correct, populated copy — especially the deploy
   (`awaiting_import`) card, which names the target and explains Import vs Skip.
2. No backend `phase` value can crash the chat — an unexpected phase degrades one card, not the thread.
3. The cloud path has a one-click Copy-YAML.
4. Destructive gate actions (Accept-anyway, Discard) confirm first; the primary vs secondary deploy choice is
   visually distinct.

## Non-goals

- **No backend change.** Two findings need backend work and are **split out**:
  - **Persisted chat-history replay on reopen** — `openTask`/`start` rebuild the thread from the latest
    snapshot only ([store.ts:440,301](../../apps/builder/web/src/store.ts)); the backend stores no transition
    log. Needs a server-side per-phase output/gate log + a replay endpoint → its own spec (M/L). (014 §Non-goals
    already defers it.)
  - **"Keep trying" empty re-run** — `/reply` requires text by design ([store.ts:338](../../apps/builder/web/src/store.ts));
    a true "re-run unchanged" needs a backend no-text re-run route. The current empty-disable is defensible UX.
- **No new component-test harness.** `@testing-library` is not installed; 016's pure pieces (phase.ts clamp,
  store.ts label) extend the existing vitest specs. A full gate-card render harness is out of scope.
- The "3 overlapping text inputs at the Spec gate" finding **does not apply** to current code (GateCard has no
  slug/name inputs) — dropped.

## Design

### D1 — The `awaiting_import` (deploy) gate card (the priority)

Add a flag-keyed branch to `gateView` **before** the `switch(t.phase)`, mirroring the existing `still_failing`
branch ([Chat.tsx:138](../../apps/builder/web/src/components/Chat.tsx)):

```ts
if (t.gate?.flag === 'awaiting_import') {
  return { tone: 'deploy', badge: tr('gateImportBadge'),      // "Ready to deploy"
    title: tf('gateImportTitle', { file: t.workflowFile }),    // "Import main.yml to your self-hosted Dify"
    meta, showReportLink: true,
    summary: [tr('gateImportSummary1'),  // "Import pushes the linted workflow to your Dify workspace."
              tr('gateImportSummary2'),  // "Dify import always creates a NEW app — re-importing duplicates it."
              tr('gateImportSummary3')]; // "Skip finishes the build locally without deploying."
}
```

Add the EN+JA i18n keys; surface `t.workflowFile` (and the edit-existing duplicate warning when `t.workflow`
is set). `btnClass` (D4) makes **Import** primary and **Skip** secondary.

### D2 — Bounds-guard `phaseIndex` (C2 / R7)

Clamp in `phase.ts` so an unknown phase can never produce a `-1` index:

```ts
export const phaseLabelAt = (idx: number): PhaseKey =>
  PHASE_LABELS[Math.min(Math.max(idx, 1), PHASE_LABELS.length) - 1].key;
```

Route the two `PHASE_LABELS[idx-1]` reads (Chat.tsx:79 Disclosure, :124 gateView) through it, and flip
`phase.test.ts:30-33` from "documents the crash" to "asserts the clamp". An unexpected phase now degrades to a
neutral card, not a thread-wide crash.

### D3 — Copy-YAML on the YAML tab (C3)

Add a copy button to `YamlTab`'s codeblock head ([ArtifactPanel.tsx:177-190](../../apps/builder/web/src/components/ArtifactPanel.tsx))
using `navigator.clipboard.writeText` + the existing `I.copy` icon, with a transient "Copied" state. Render it
unconditionally (useful for all deploys, prominent for cloud).

### D4 — Safe & distinct affordances (C4)

- **`btnClass`:** for `awaiting_import`, the secondary confirm (`skip_import`) returns `ghost`; the primary
  (`import`) stays `ok`. So Import is the one green button, Skip is a quiet secondary.
- **Confirm the destructive ones:** route the `still_failing` **Accept-anyway** confirm and the cancel-kind
  **Discard/Abandon** through the existing `askConfirm` modal ([store.ts:75](../../apps/builder/web/src/store.ts),
  mounted App.tsx:305) with `danger:true` before `store.confirm`/`store.cancel` — mirroring how `onStop` already
  confirms.
- **Reply resolved-label:** thread the chosen action's label (Edit spec / Keep trying / Request changes)
  through `reply()` instead of the literal `Requested changes` ([store.ts:346](../../apps/builder/web/src/store.ts)),
  via the existing `tAction` map.
- **Confirm-mode chip:** soften the mid-turn lock tooltip (App.tsx:267) so the freeze is explained, not silent.

## Behavior — how it works after 016 is done

**① Reaching the deploy step (selfhost) — today a blank card, after 016 a clear decision.**
A build finishes ④ clean on `deploy=selfhost` (or `auto` runs straight to it). Instead of a blank
**Ready / Continue** card, the user sees:

```
┌ 🚀 Ready to deploy ─────────────────────────── Phase 4 · Test ┐
│ Import main.yml to your self-hosted Dify                      │
│ • Import pushes the linted workflow to your Dify workspace.   │
│ • Dify import always creates a NEW app — re-importing         │
│   duplicates it (this won't update an existing app in place). │
│ • Skip finishes the build locally without deploying.          │
│ [ 📄 report.json ]                                            │
│            [ Import to Dify ]   Skip import    Discard build  │
└──────────────────────────────────────────────────────────────┘
```

**Import to Dify** is the one primary (green) button; **Skip import** is a quiet secondary; **Discard** is set
apart. Clicking **Import** first asks: *"Push main.yml to your self-hosted Dify? This creates a new app."* —
one confirm, then the backend push runs. Nothing about the flow changes server-side; the user simply finally
*understands* the gate they're at. (In `auto` mode this is the one place the build now waits for a human — by
014 D1.)

**② An unexpected phase no longer kills the thread.** If the backend ever sends a `phase` the UI doesn't know
(a drift / a future phase), the gate card falls back to a neutral "Continue" card and the conversation stays
intact — instead of the whole chat blanking out (the R7 crash).

**③ Cloud deploy = one click to copy.** On a `deploy=cloud` build the YAML tab shows a **Copy** button in the
code header; clicking it copies the whole workflow to the clipboard (flashing "Copied") so the user pastes it
straight into Dify Studio → Import DSL — no more drag-selecting hundreds of lines.

**④ Destructive clicks ask first.** Clicking **Accept anyway** on a lint-failing build, or **Discard/Abandon**,
pops the same confirm dialog the Stop pill uses ("This ships a workflow that failed validation — continue?" /
"Discard this build?") — so a fat-finger can't silently ship a broken build or throw one away.

**⑤ The reply history reads true.** After clicking **Edit spec** and sending a change, the resolved gate shows
"Edit spec" (not the generic "Requested changes"), so the thread history reflects what actually happened.

> Everything else is unchanged: the same gates, the same backend, the same turn flow. 016 is purely about the
> cards rendering correctly, safely, and legibly.

## Open questions — resolved at implementation

- **Q1 — deploy-gate copy (EN+JA):** RESOLVED — used the drafted strings (`gateImportBadge/Title/Summary1-3`),
  and the edit-existing duplicate warning IS inlined: when `t.workflow` is set, a 4th summary line
  (`gateImportSummaryEdit`) names the existing workflow and warns that import still makes a separate new app.
- **Q2 — confirm scope:** RESOLVED (per rec) — **Import to Dify** gets its own `askConfirm` ("Push <c>main.yml</c>
  … creates a NEW app"), alongside Accept-anyway and Discard. The benign advances (Continue/Implement/Skip) do not.
- **Q3 — `deploy` tone:** RESOLVED — added a dedicated `.gate.tone-deploy` (solid-accent badge + accent-line
  border + accent-dim foot) so the import card is distinct from the neutral default and the green `done` tone;
  the badge icon is `I.external` (the push-out glyph).

## Acceptance criteria

1. A selfhost build at ④ renders a populated **Ready to deploy** card (named target + Import/Skip explanation +
   duplicate-app note), not the blank Ready/Continue fallback; `auto`/`spec_only` park there and show it.
2. An unknown `phase` value degrades to a neutral card — no thrown `PHASE_LABELS[-1]`; `phase.test.ts` asserts
   the clamp (was: documents the crash).
3. The YAML tab has a working Copy button (clipboard + copied-state).
4. **Import** is the only primary button at the deploy gate; **Skip** is secondary. **Accept-anyway** and
   **Discard** confirm via `askConfirm` before acting.
5. The reply resolved-label reflects the chosen action; new strings exist in BOTH EN and JA.
6. `npm run build` (web) + `npm test` (web vitest) green; no backend change; persisted-history + empty-re-run
   remain split out.

## References

- This session's audit (UX cluster) + the re-sizing on current code (workflow `wdu12n91i`): C1–C4 verified
  present; "3 inputs" already fixed; persisted-history + empty-re-run need backend → split out.
- [014](014-builder-terminal-correctness-and-state-integrity.md) §Non-goals (assigned this card to 016; D1 made
  it always-reached) · [011](011-builder-test-coverage-and-remediation.md) R7 (the unguarded crash, never fixed).
- Code: [Chat.tsx](../../apps/builder/web/src/components/Chat.tsx) (`gateView`/`GateCard`/`btnClass`) ·
  [phase.ts](../../apps/builder/web/src/lib/phase.ts) · [ArtifactPanel.tsx](../../apps/builder/web/src/components/ArtifactPanel.tsx) ·
  [store.ts](../../apps/builder/web/src/store.ts) (`askConfirm`/`reply`) · [i18n.ts](../../apps/builder/web/src/lib/i18n.ts).

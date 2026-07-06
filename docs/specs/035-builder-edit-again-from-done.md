# Spec 035 — A direct "Edit this workflow" entry point from the done/cancelled Ask view

**Status**: Draft — small, additive, FE-only. Near-total reuse of already-shipped machinery (spec 030's
edit-existing seed, spec 029/030's `newTask`). D1/D2 recommended locked; D3 explicitly OPEN (deferred future
work, not resolved here).

> **Update (post-implementation — S1 has since landed in the working tree; corrections folded back):**
> 1. **§2's foot guard is TWO independent guards, not one shared predicate.** The original single-predicate
>    form (`(cancelled||done) && project && workflowSlug && (onRestore||onEditAgain)`) ANDed `project &&
>    workflowSlug` onto Restore too, so a from-scratch build cancelled pre-scaffold LOST its Restore button — a
>    silent Non-goal #4 regression. The shipped code uses `canRestore` / `canEditAgain` (§2, corrected).
> 2. Some inline `App.tsx`/`store.ts`/`i18n.ts` line numbers were drafted against a pre-033 tree and drifted
>    15–130 lines (033's Ask machinery grew both files; `store.ts` is still moving). Treat each `file:line` as a
>    pointer to the named **symbol**, not an exact line. (Server refs — `scaffold.ts`/`orchestrator.ts`/
>    `gate.ts`/`task.ts`/`Sidebar.tsx`/`Icon.tsx` — held up; drift is concentrated in the three FE files.) **IMPLEMENTED (2026-07-05)** — S1 shipped: `GateCard`'s `onEditAgain` prop + the
widened terminal foot-ternary (Restore stays independent of `project`/`workflowSlug`; Edit-again gated on
both), the `App.tsx` wire-up to `newTask({baseWorkflow})`, and the `editThisWorkflow` i18n pair (EN+JA). Zero
backend files changed (AC#5). Web typecheck/build/tests green.

**Builds on**:
- [034](034-builder-test-gate-terminal-qa.md) — **now resolved AND landed** (sibling spec 034 is implemented in
  the tree: `askTestWithin`/`sessionIds.askTest`/`seededFrom` + `send()`'s `done|cancelled → store.ask` branch)
  such that a done/cancelled
  task's composer Send now defaults to **Ask** (034's fresh-seeded Q&A), and the terminal composer's
  workflow/deploy/confirm settings row — today's "next build" editor
  ([App.tsx:414-420](../../apps/builder/web/src/components/App.tsx#L414-L420)) — no longer offers a "start a
  new build" affordance at that call site (superseded, per the assumed resolution). This spec's whole reason to
  exist is that gap: once Send-at-done means "ask a question," there is no button left in that view that means
  "actually change this workflow."
- [030](030-builder-nested-project-workflow-folders.md) — the edit-existing mechanism this spec is a second entry point
  into: `newTask({baseWorkflow})` ([App.tsx:211](../../apps/builder/web/src/components/App.tsx#L211)),
  the sidebar workflow-"+" that already calls it
  ([Sidebar.tsx:55](../../apps/builder/web/src/components/Sidebar.tsx#L55)), `splitWorkflowSetting` +
  `store.start()` ([store.ts:438-481](../../apps/builder/web/src/store.ts#L438-L481)), and the backend
  `localEditSeed` step that turns a chosen `{project, workflow}` pair into a real seed
  ([orchestrator.ts:70-83](../../apps/builder/server/lib/orchestrator.ts#L70-L83) calls
  [scaffold.ts:143-171](../../apps/builder/server/lib/scaffold.ts#L143-L171)).
- [033](033-builder-gate-qa-chat-mode.md) D1 — "two explicit modes, never auto-classify" is the same design
  instinct this spec borrows for D1: a navigation action must never be reachable by typing a chat message.
- [009](009-browser-workflow-builder.md) — the gated 4-phase FSM this spec runs, unmodified, for whatever build
  this button starts (same non-goal as 033/034: no FSM change).

**Depends on**: no *technical* dependency — `newTask({baseWorkflow})` and the sidebar's own call to it already
exist and are byte-unchanged targets today, with or without 034 landing. The *product* rationale is sharper
once 034's D3 resolves as assumed above (composer Send no longer starts a new build from a done/cancelled
view), but this spec's S1 can ship independently of that timing; sequenced after 034 only so the two land in
the same view together. No new external deps, no new Dify contact, zero backend files touched.

---

## Context — the gap this closes

At a `done` or `cancelled` task, the trailing gate card renders via `gateView`
([Chat.tsx:137-139](../../apps/builder/web/src/components/Chat.tsx#L137-L139) for `done`,
[Chat.tsx:134-135](../../apps/builder/web/src/components/Chat.tsx#L134-L135) for `cancelled`) and its action
foot is a ternary in `GateCard` ([Chat.tsx:353-374](../../apps/builder/web/src/components/Chat.tsx#L353-L374)):
resolved-label → `cancelled && onRestore` (Restore only) → `docked ? null` (analyze/spec/implement actions dock
above the composer, 033 FIX-J) → `actions.length > 0` (inline `GateActions`) → else `null`. (033 FIX-G already
REMOVED the old inline reply textarea — the composer is the one reply surface now, so there is no
`live-reply-textarea` branch.) Confirmed directly: a `done` task's gate is set to `computeGate('test', {outcome:'success'}, ...)`
immediately after `task.status = 'done'`
([orchestrator.ts:577-578](../../apps/builder/server/lib/orchestrator.ts#L577-L578)), which for a terminal
success returns `{ actions: [] }` ([gate.ts:166](../../apps/builder/server/lib/gate.ts#L166)) — a defined
object with an EMPTY actions array, not `undefined`. Either way `actions.length` is `0`, so the foot renders
**nothing** at `done` today. At `cancelled`, the foot renders **only** Restore.

**With 034 landed** (its D3 makes Send-at-terminal mean Ask and drops the terminal composer's settings row —
now confirmed in the tree: `send()` routes `done`/`cancelled → store.ask`, [App.tsx:161-162](../../apps/builder/web/src/components/App.tsx#L161-L162)),
the *only* remaining path from "looking at a finished/cancelled build" to "let me actually change it" is: leave
this view, find the workflow in the sidebar tree, hover its row, click its own "+"
([Sidebar.tsx:55](../../apps/builder/web/src/components/Sidebar.tsx#L55) —
`onNewTask({ baseWorkflow: { project: projectId, workflow: wf.id } })`). That is a real navigation cost paid
every time, right after the user was just chatting about the exact workflow they want to edit. (034 and 035
landed together, so the earlier worry that this button might be *redundant* with a still-present terminal
settings-row + `Send=store.start()` no longer applies — 034 removed that row, so this button is now the sole
in-view edit affordance at a terminal build.)

This spec's entire job: put **one button**, reachable directly from that same done/cancelled gate card, that
calls the **identical** `newTask({baseWorkflow})` ([App.tsx:211](../../apps/builder/web/src/components/App.tsx#L211))
— same function, same `{project, workflow}` shape, just a second, more convenient call site. Nothing about the
build mechanism changes: the new build still runs the full Analyze→Spec→Implement→Test pipeline, because
`localEditSeed` ([scaffold.ts:143-171](../../apps/builder/server/lib/scaffold.ts#L143-L171)) only *seeds* the
edit (snapshots the existing `main.yml` so Analyze/diff have a pre-edit base) — it is triggered by
`startTask` the same way for any edit-existing build ([orchestrator.ts:70-83](../../apps/builder/server/lib/orchestrator.ts#L70-L83)),
regardless of which UI affordance produced the `{project, workflow}` pair. A shortcut that instead patched
`main.yml` directly and skipped the phases would bypass exactly the gates AGENTS.md documents as catching real
bugs: `lint_refs.py`'s graph-reachability check is the **"#1 cause of silent import success + runtime
failure"** for a dangling/forward variable reference
([AGENTS.md:68](../../AGENTS.md#L68)), and `lint_plugin_hashes.py` enforces that a plugin's
`marketplace_plugin_unique_identifier` hash is real, never fabricated
([AGENTS.md:70-73](../../AGENTS.md#L70-L73)) — both are exactly the kind of "one field changed" mistake a
"small tweak" edit is most likely to introduce silently. Running the same 4-phase pipeline (with its own
`validate_workflow.py`/pre-commit step, [AGENTS.md:52-54](../../AGENTS.md#L52-L54)) for every workflow change,
big or small, is deliberate — not an oversight this spec should "optimize away."

**One correctness nuance, easy to get wrong**: `task.workflow` (the *original edit-existing input* field,
`null` for a from-scratch build, [task.ts:102](../../apps/builder/server/state/task.ts#L102)) is **not** the
right value to pass — only `task.project`/`task.workflowSlug` (the *on-disk* identifiers,
[task.ts:100-101](../../apps/builder/server/state/task.ts#L100-L101)) are populated for **every** build that
reached `done` regardless of whether it started from-scratch or as an edit, and are confirmed identical to
what the sidebar tree already exposes as `wf.id` (`buildTree` buckets tasks by `(task.project,
task.workflowSlug)`, [artifacts.ts:267-269](../../apps/builder/server/lib/artifacts.ts#L267-L269), and
`localEditSeed` round-trips a sidebar-"+"-supplied `workflow` string straight into `task.workflowSlug`,
[scaffold.ts:145-146](../../apps/builder/server/lib/scaffold.ts#L145-L146)) — so `task.project`/
`task.workflowSlug` is the one pair that is both always-correct and byte-identical in shape to what the
sidebar's own call site already sends.

---

## Design decisions

- **D1 · Visually and interactionally distinct from Send — never reachable by typing (locked).** Mirrors 033
  D1's own instinct ("two explicit modes, never auto-classify") one level up: this is a **navigation**
  action — clicking it calls `store.resetToNew()` (inside `newTask`,
  [App.tsx:212](../../apps/builder/web/src/components/App.tsx#L212)), which clears `task.value`/`thread.value`
  and flips `view` from `'conversation'` to `'empty'` ([App.tsx:101](../../apps/builder/web/src/components/App.tsx#L101))
  — the CURRENT done/cancelled build's view is replaced by a fresh composer. That is categorically different
  from an Ask turn (034), which stays *in* the current view and appends to the thread. A dedicated button in
  the gate-foot (own label, own icon — reusing `I.message`,
  [Icon.tsx:30](../../apps/builder/web/src/components/Icon.tsx#L30), the exact glyph the sidebar's own
  workflow-"+" already uses, [Sidebar.tsx:55](../../apps/builder/web/src/components/Sidebar.tsx#L55) — same
  glyph, same action, reinforcing "this is the same thing") keeps it structurally un-confusable with typing
  into the composer and hitting Send. **Caveat (honest):** `I.message` is *also* the glyph on the gate's own
  `reply`-kind "Request changes"/"Edit spec" button ([Chat.tsx:248](../../apps/builder/web/src/components/Chat.tsx#L248))
  — the re-run verb D1 wants to be distinct from — so the glyph is not unique to "start-new". It doesn't collide
  *in the same foot* (a terminal gate has no reply action), but the "instantly recognizable" claim is a mild
  overstatement; revisit the icon if real use shows confusion.
- **D2 · At `cancelled`, coexists alongside Restore as two independent actions; at `done`, this button appears
  alone (locked).** `GateCard`'s current ternary already special-cases `cancelled && onRestore`
  ([Chat.tsx:345-350](../../apps/builder/web/src/components/Chat.tsx#L345-L350)) — Restore calls
  `store.restore()` ([store.ts:529-555](../../apps/builder/web/src/store.ts#L529-L555)), which reopens **this same
  build** where it left off (still the SAME `taskId`, same session/phase state). This spec's button starts a
  **brand-new** build (`newTask` → `store.resetToNew()` → a fresh empty view, eventually a new `taskId` via
  `store.start()`) seeded from the finished artifact. These are two clearly different verbs — "resume this" vs
  "start fresh from this" — and must render as two separate, independently-clickable controls in the same
  foot, not merged into one. At `done`, there is no Restore (034's own unchanged invariant — only a `cancelled`
  task can be reopened where it left off), so this button is the *only* control in the foot, replacing today's
  empty `null` render ([Chat.tsx:351-353](../../apps/builder/web/src/components/Chat.tsx#L351-L353), the
  `actions.length > 0` branch, false at `done` since `actions` is `[]`).
- **D3 · Should 034's Q&A thread fold into the new build's first turn? OPEN, not resolved here.** v1
  recommendation: **no**. The new build's Analyze phase re-summarizes the existing workflow completely fresh —
  identical to any edit-existing build today via `localEditSeed`
  ([scaffold.ts:143-171](../../apps/builder/server/lib/scaffold.ts#L143-L171)), which snapshots `main.yml` for
  Analyze to read; it never reads or requires prior chat. `store.start()`'s wire shape
  ([store.ts:447-481](../../apps/builder/web/src/store.ts#L447-L481)) takes only `requirement`/`files`, and
  `CreateTaskInput` ([task.ts:163-188](../../apps/builder/server/state/task.ts#L163-L188)) has no field for
  "prior conversation" of any kind — passing 034's Q&A into a brand-new task's first turn would be a genuinely
  **separate mechanism with no established precedent anywhere in this codebase** (no existing wire field, no
  existing prompt-seeding path for it), not a small addition. State this plainly as deferred future work — the
  user must currently restate, in the new build's requirement text, anything from the prior Q&A they want
  carried forward.

---

## Design

### §1 · Backend — zero changes

Nothing here touches the server. The button's target, `newTask({baseWorkflow: {project, workflow}})`, is
**already** a fully-general FE call into `store.settings.value` + `store.start()`
([App.tsx:211](../../apps/builder/web/src/components/App.tsx#L211),
[store.ts:438-481](../../apps/builder/web/src/store.ts#L438-L481)) — the exact same path the sidebar's
workflow-"+" drives today. `splitWorkflowSetting` ([store.ts:438-443](../../apps/builder/web/src/store.ts#L438-L443))
parses the compound `project/workflow` value back apart, `POST /api/tasks` carries `workflow`
([store.ts:461](../../apps/builder/web/src/store.ts#L461)) and `project`
([store.ts:471](../../apps/builder/web/src/store.ts#L471)) as already-existing wire fields, and
`startTask`'s `else if (task.workflow)` branch ([orchestrator.ts:70-83](../../apps/builder/server/lib/orchestrator.ts#L70-L83))
calls `localEditSeed` exactly as it does for a sidebar-"+"-originated build. Confirmed: none of
`task.ts`/`store.ts`/`orchestrator.ts`/`scaffold.ts` need a single line changed for this spec — it is a pure
second FE call site into fully-existing machinery.

### §2 · Frontend — the button

**`GateCard`** ([Chat.tsx `GateCard`](../../apps/builder/web/src/components/Chat.tsx#L287)) gains one new
optional prop `onEditAgain?: (project: string, workflowSlug: string) => void`. Restore and the new button are
**two independent actions with SEPARATE guards** — do **NOT** fold them under one shared condition. Compute two
flags ([Chat.tsx:316-318](../../apps/builder/web/src/components/Chat.tsx#L316-L318)):
- `canRestore = task.status === 'cancelled' && !!onRestore` — **byte-identical to today's Restore condition**;
  it must NOT depend on `project`/`workflowSlug`. A from-scratch build cancelled pre-scaffold (mid-Analyze, or
  at the Spec gate — both have `project`/`workflowSlug` still `null`,
  [task.ts:100-101](../../apps/builder/server/state/task.ts#L100-L101)) still shows Restore today, so gating it
  on the slug would silently DROP it there — a regression of Non-goal #4.
- `canEditAgain = (task.status === 'cancelled' || task.status === 'done') && !!task.project &&
  !!task.workflowSlug && !!onEditAgain` — the new button, gated on an on-disk workflow existing to point at.

The foot branch fires on `canRestore || canEditAgain` ([Chat.tsx:359](../../apps/builder/web/src/components/Chat.tsx#L359)),
and inside it each button renders under its OWN flag (`{canRestore && <Restore/>}` then `{canEditAgain && <Edit/>}`),
so a pre-scaffold cancel degrades to **Restore-only** (D2) and a done/cancelled build with a real workflow
shows both.

> ⚠️ **Do NOT** collapse this into the single guard
> `(cancelled || done) && task.project && task.workflowSlug && (onRestore || onEditAgain)` — that ANDs
> `project && workflowSlug` onto Restore too, dropping Restore for every pre-scaffold cancel (a Non-goal #4
> regression). The first implementation did exactly this; the two guards MUST stay independent.

**`App.tsx`** wires the new prop at the `GateCard` call site
([App.tsx:346-353](../../apps/builder/web/src/components/App.tsx#L346-L353), alongside the existing
`onRestore={() => void store.restore()}`) to `onEditAgain={(project, workflow) => newTask({baseWorkflow:
{project, workflow}})}` — literally the same `newTask` already bound to `onNewTask` on `<Sidebar>`
([App.tsx:269](../../apps/builder/web/src/components/App.tsx#L269)). No new store action, no new SSE event, no
new i18n mechanism beyond one new label/title pair (`editThisWorkflow` — "Edit this workflow"), following
the existing dual-dict pattern next to `restoreBuild` ([i18n.ts:116](../../apps/builder/web/src/lib/i18n.ts#L116)
EN, mirrored JA at [i18n.ts:370](../../apps/builder/web/src/lib/i18n.ts#L370)) and `newTaskInWorkflow`
([i18n.ts:217](../../apps/builder/web/src/lib/i18n.ts#L217) EN, JA at
[i18n.ts:471](../../apps/builder/web/src/lib/i18n.ts#L471)).

---

## Goals
1. One click from "looking at (or, post-034, chatting about) a finished/cancelled build" to the **pre-seeded
   edit composer** — no detour through the sidebar tree. (Precise: the click runs `newTask({baseWorkflow})`,
   which `resetToNew()`s to a fresh EMPTY composer with the workflow pre-selected; the edit build itself starts
   only once the user types a change and hits Send — identical to the sidebar "+". "One click to fix" is
   shorthand for "one click to the *starting point* of the fix," not a one-click rebuild.)
2. Reuse 100% of the existing edit-existing mechanism (`newTask({baseWorkflow})` → `localEditSeed` →
   Analyze→Spec→Implement→Test) — this spec adds a second call site, not a second mechanism.
3. Keep the full 4-phase quality gate (validate/lint_refs/lint_plugin_hashes) for every such edit, exactly as
   today — no "quick patch" shortcut (Context, above).

## Non-goals
- No shortcut that skips any of the 4 phases — full gate preserved, byte-identical to today's edit-existing
  behavior.
- No Q&A-context passthrough into the new build's first turn in v1 (D3, open).
- No backend changes of any kind.
- No change to Restore's behavior, `store.restore()`, or the cancelled-only Restore condition.

## Acceptance criteria
1. Clicking the new button at a `done` or `cancelled` task (with `project`/`workflowSlug` both set) calls
   `newTask({baseWorkflow: {project, workflow: workflowSlug}})` — the identical shape and downstream effect
   (`resetToNew()` → pre-selected compound workflow setting → empty view) as the sidebar's workflow-"+"
   ([Sidebar.tsx:55](../../apps/builder/web/src/components/Sidebar.tsx#L55)); the two call sites are
   byte-identical in behavior.
2. The button never renders when `task.project`/`task.workflowSlug` are not both set (e.g. a task cancelled
   pre-scaffold). This guards on the task's *snapshot fields*, not the disk — it prevents pointing at a
   never-scaffolded workflow, but a `done` build whose folder was later deleted/renamed still renders the button
   (clicking it seeds a stale slug — see Biggest risks). And it is the EDIT button's guard ONLY: Restore keeps
   its own unconditional `cancelled && onRestore` guard (§2), so a pre-scaffold cancel still shows Restore.
3. At `cancelled`, Restore and this button both render, both independently clickable, neither one's click
   affects the other's availability.
4. At `done`, only this button renders in the gate-foot (no Restore) — matches 034's unchanged invariant.
5. Zero backend files (`task.ts`, `store.ts`'s wire calls, `orchestrator.ts`, `scaffold.ts`) change as part of
   this spec's S1.

## Sequencing
- **S1 · FE only** — the `onEditAgain` prop on `GateCard`, the two INDEPENDENT foot guards (`canRestore`
  unchanged + `canEditAgain`, §2 — NOT one shared predicate), the `App.tsx` wire-up to `newTask`, the new i18n
  label pair (EN+JA).
  **Tests**: the render-condition logic is the only thing worth a test, but the web harness has no
  component-render infra today (vitest + jsdom, no `@testing-library`/`render()` precedent). So EXTRACT the two
  predicates into a pure helper (e.g. `terminalFootActions(task, {onRestore, onEditAgain})` → `{restore,
  editAgain}` booleans) and unit-test it: (a) `cancelled` + `workflowSlug=null` → `{restore:true,
  editAgain:false}` (the pre-scaffold guard — the test that would have caught the Non-goal #4 regression); (b)
  `cancelled` + both set → `{true, true}`; (c) `done` + both set → `{false, true}`; (d) `done` + `project=null`
  → `{false, false}`. Without the extraction, AC#2/#3 have no assertable home in the current harness.
- **Parallel-with-034 note (both implementable at once — no functional overlap).** 034 and 035 touch three of
  the same files but in **disjoint regions/components**, so they can be built side by side; expect only trivial
  merge adjacency, no logical conflict. 034 edits `send()`/the composer/`QaAnswer` + the `send()` reply
  carve-out ([App.tsx:141-173](../../apps/builder/web/src/components/App.tsx#L141-L173),
  [App.tsx:414-420](../../apps/builder/web/src/components/App.tsx#L414-L420)); 035 edits `GateCard`'s
  foot-ternary ([Chat.tsx:345-350](../../apps/builder/web/src/components/Chat.tsx#L345-L350)) + its `App.tsx`
  call site ([App.tsx:346-353](../../apps/builder/web/src/components/App.tsx#L346-L353), the `onRestore` line) +
  `newTask` wiring. Both append **one distinct** i18n key pair to
  [i18n.ts](../../apps/builder/web/src/lib/i18n.ts) (034: `phAskAboutBuild`; 035: `editThisWorkflow`). Neither
  edits the other's lines. **Combined result at a done/cancelled build:** Ask via the composer (034),
  Edit-this-workflow via the gate-foot button (035), and — `cancelled` only — Restore (pre-existing): three
  independent, coexisting actions, no gap and no double-meaning between them.
- **S2 · Docs** — one line cross-referencing this spec from 034 (its Context/Open-questions section, so a
  reader following "how do I edit a finished build" lands here), and a one-line mention in the builder README
  if it documents the sidebar workflow-"+" today.

## Biggest risks
1. **UX discoverability — will users notice the button?** This is the honest primary risk. It is NOT, however,
   "zero implementation risk" (risks 2–3 below are real, if small); beyond those, the mechanism is a thin prop
   thread into already-tested machinery (§1/§2), so remaining implementation risk is low. The real question is
   whether a small button in a gate-foot, next to (or in place of) Restore, gets noticed at the moment a user
   is looking at a done/cancelled build and wants to change it — versus continuing to reach for the sidebar tree
   out of habit. Mitigation: reuse the exact same icon (`I.message`) the sidebar's own workflow-"+" uses, so a
   user who has learned that glyph's meaning there recognizes it here too (but see D1's caveat — the glyph is
   also the reply-action glyph); revisit placement/copy if real use shows it goes unnoticed.
2. **Restore-coupling regression (found by review; fixed).** Folding the Edit button into Restore's branch
   guard drops Restore for a from-scratch build cancelled pre-scaffold — a silent Non-goal #4 regression. The
   *first* implementation shipped exactly this. §2 now mandates two INDEPENDENT guards (`canRestore` /
   `canEditAgain`); the S1 pure-helper test (case (a)) is what pins it so a future refactor can't reintroduce
   it. Listed here because it's precisely the "a change the spec claims not to make" class of risk.
3. **Stale edit target (deleted/renamed workflow).** AC#2's guard checks `task.project`/`task.workflowSlug` on
   the snapshot, not the disk. A `done` build whose `projects/<project>/<workflowSlug>/` was later deleted or
   renamed still renders the button; clicking it seeds a slug whose `main.yml` is gone, so `localEditSeed`
   ([scaffold.ts:143-171](../../apps/builder/server/lib/scaffold.ts#L143-L171)) can't snapshot a pre-edit base
   and the build errors. Low-frequency (same staleness the sidebar tree can carry), and it fails loudly rather
   than corrupting anything — but it is NOT the "no dead link" AC#2 originally implied. Mitigation: v1 accepts
   it (fails visibly); a pre-click existence check is deferred.

## Open questions
- **D3** (see Design decisions) — should 034's Q&A thread fold into the new build's first turn? Deferred;
  default is no passthrough, restate manually if needed.

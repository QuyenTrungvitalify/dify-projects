# Spec 053 — One-click "Retry phase" out of error (the button is a no-op today)

**Status**: **Implemented — unit-verified** (2026-07-09; r3 landed the code same day). The automated
ACs (1–6, 10) are green: server 456/456 (incl. the new `test/retry-out-of-error.test.ts`, 6 cases),
web 167/167 (incl. `store.reply.test.ts` + the `replyButtonKind` cases in `gate-foot.test.ts`), tsc
clean both sides, web prod build OK. **The three MANUAL gates (AC7 QA-1, AC8 QA-2, AC9) remain
OUTSTANDING** — they need a running Dify + a forced phase error to observe, and are the only thing
between this and a full sign-off. **Small** (S): relaxed the empty-text guard on the ERROR path across
two layers (server `/reply`, `store.reply`), and made the error-gate `Retry phase` button FIRE the
retry on click instead of merely arming the composer. No orchestrator change — `replyWithin('')`
already re-runs the phase cleanly (the empty-`replyText` branch falls back to `freshPrompt`,
[orchestrator.ts §buildPrompts](../../apps/builder/server/lib/orchestrator.ts)). No gate/FSM/status
change, no new Task field.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-09.

> **Two claims in this spec are STATIC-only and MUST be proven at runtime before merge** (see the
> manual-verify ACs 7–8): (QA-1) an empty-`replyText` resume re-runs the phase without duplicating the
> artifact, and (QA-2) an errored ④-static retry actually re-runs the report (no false pass on the
> stale `main.yml`). Everything else is unit-pinned.

**Motivation (field incident, 2026-07-09)**: a build's ② Spec phase failed with
`仕様でエラー / フェーズが600秒でタイムアウトしました — 再試行するか、要件を簡素化してください` (a transient
network/timeout during the turn). The gate offered exactly one button, `フェーズを再試行`
("Retry phase"). The user clicked it and **nothing happened** — the phase did not re-run, no error
surfaced, the build stayed parked. The user could not recover the build from the UI at all.

Root cause is a UX/semantics mismatch, NOT a lock leak (the turn lock IS released on a phase
error — the dispatch `finally` in [tasks.ts §dispatch](../../apps/builder/server/routes/tasks.ts)
frees it; [orchestrator.ts §gateAfterPhase](../../apps/builder/server/lib/orchestrator.ts) documents
"a /reply retry re-acquires the turn lock"). The button is defined as a `kind:'reply'` action
([gate.ts §ERROR_GATE](../../apps/builder/server/lib/gate.ts) — `{ actions: [REPLY('retry', 'Retry phase')] }`),
and a `reply`-kind button in the FE does **not submit** — it only *arms the composer*:

- [Chat.tsx §GateActions](../../apps/builder/web/src/components/Chat.tsx) — a `reply`-kind action's
  `onClick` is `onArmChange(a.label)`.
- [App.tsx §onArmChange](../../apps/builder/web/src/components/App.tsx) — `onArmChange` only runs
  `setChangeLabel(label); setMode('change'); setFocusToken(x=>x+1)`. It focuses the input box; it
  sends nothing.

So "Retry phase" silently means "click here, then type something, then press send". Worse, a
**text-less** retry (the natural intent after a transient blip: re-run the phase unchanged) is
impossible today — THREE layers reject empty text:

1. FE `send()` — [App.tsx §send](../../apps/builder/web/src/components/App.tsx): `if (!msg) return;`
2. `store.reply()` — [store.ts §reply](../../apps/builder/web/src/store.ts): `if (!t || !text.trim()) return false;`
3. Server `/reply` — [tasks.ts §POST /reply](../../apps/builder/server/routes/tasks.ts): `if (!text) return reply.code(400)...;`

The header comment at [App.tsx §send routing](../../apps/builder/web/src/components/App.tsx) already
*claims* the behavior we want — `error → store.reply() (Retry-out-of-error, byte-unchanged)` — but no
byte-unchanged retry can actually fire because all three guards demand non-empty text. The intent was
specced; the guards make it dead.

**Builds on**:
- [009](009-browser-workflow-builder.md)/§I — "never auto-advances out of error"; the parked Retry
  gate is the recovery path. This spec makes that gate *actually work* on one click; it does not add
  auto-retry (still human-gated).
- [045](045-turn-failure-triage.md) — classifies WHY a turn died into an actionable gate note. 045
  tells the user *what broke*; 053 lets them *act on it* (retry) without the dead-button detour. A
  transient `network`-class death (045's own class) is the archetypal one-click-retry case.
- [041](041-builder-request-changes-everywhere.md) — "Request changes" (a STEERED reply, non-empty
  text) stays exactly as-is: the composer path is untouched, so a user who WANTS to steer the retry
  (edit the requirement, then re-run) still types into the dock. 053 only adds the text-LESS path.

---

## Decisions

- **D1 · Scope the empty-text carve-out to `status:'error'` ONLY, in TWO layers (locked; r2).** The
  guards relax to allow empty text *exclusively* on the retry-out-of-error path; at a normal
  `awaiting_confirm` gate an empty reply stays rejected (there, empty text has no meaning — the actions
  are Continue / Request-changes / Ask). Concretely:
  - **Server `/reply`** ([tasks.ts §POST /reply](../../apps/builder/server/routes/tasks.ts)) — the
    empty-text `400` currently fires at the TOP, before `loadTask`, so it cannot see the status. **Move
    it below the `loadTask` + the `awaiting_confirm|error` status check** and make it conditional:
    `if (!text && task.status !== 'error') return reply.code(400).send({ error: 'text is required' });`.
    Ordering after r2 verification: `validateAttachments` → `loadTask` → status-check (409 if neither
    `awaiting_confirm` nor `error`) → **empty-text check (this)** → promote-gate check (unchanged) →
    `turnHolderId`/`acquireTurn`. Placing the empty-text check *before* the promote-gate check means an
    errored PROMOTE build with empty text falls through to the promote-gate check and 409s there
    ("this promote gate has no change action") — verified graceful, see D6.
  - **`store.reply`** ([store.ts §reply](../../apps/builder/web/src/store.ts)) — the guard
    `if (!t || !text.trim()) return false;` becomes `if (!t) return false; if (!text.trim() && t.status !== 'error') return false;`.
    When text is empty the optimistic thread push (`items.push({kind:'user', text})`) is SKIPPED (no
    empty user bubble); `api.reply(t.taskId, '', files)` is sent (files per D3). The optimistic-advance
    label is still `'Retry phase'`.
  - **FE `send` is NOT touched (r2).** The earlier draft listed `send()` as a third layer; it is not —
    the empty-retry never routes through `send()` (D2 fires it directly from the button). The `!msg`
    guard at [App.tsx §send](../../apps/builder/web/src/components/App.tsx) stays verbatim so the
    composer still cannot submit an empty *typed* message. Two layers change, not three.
- **D2 · The error-gate `Retry phase` button fires the retry on click, styled as the primary action
  (locked; r2).** In [Chat.tsx §GateActions](../../apps/builder/web/src/components/Chat.tsx), a
  `reply`-kind action whose `id === 'retry'` AND the task `status === 'error'` renders with an
  `onClick` that calls a new `onRetry(files)` prop → `store.reply('', 'Retry phase', wireFiles)` — a
  direct, text-less, one-click re-run that CARRIES any staged files (D3). All OTHER `reply`-kind
  actions (Request changes / Edit spec / Keep trying …) keep `onArmChange` verbatim.
  - **Styling (r2, was OQ1): the retry button is `ok` (primary/green), not ghost.** The error gate has
    exactly ONE action and it is non-destructive; the whole field bug was that users did not realize a
    click was theirs to make. A single prominent primary is the fix — a ghost sole-action reproduces the
    "looks inert" failure. Icon swaps 💬 → ↻ so it reads "re-run", not "type a reply".
  - **Keying (r2):** on `id === 'retry' && status === 'error'`, NOT a new action `kind`. ERROR_GATE is
    the only place `REPLY('retry', …)` is emitted ([gate.ts §ERROR_GATE](../../apps/builder/server/lib/gate.ts)),
    so no new gate/wire type is needed — the smallest change that cannot misfire on another gate's
    reply-buttons (still_failing "Keep trying", awaiting_import "Request changes", etc.).
  - **Wiring details verified in code (r2) — the four touch-points:**
    1. **New icon.** [Icon.tsx](../../apps/builder/web/src/components/Icon.tsx) has NO refresh/retry
       glyph (`undo` exists but is a semantic back-arrow, wrong here) — ADD `retry:` (a ↻ circular
       arrow) to the `I` map. Small additive change.
    2. **The reply-branch hardcodes `btn ghost`.** In `GateActions`, the `kind==='reply'` branch renders
       `<button className="btn ghost" … onClick={() => onArmChange(a.label)}><I.message/>…`. Split it on
       a PURE helper `replyButtonKind(a, task.status)` (AC6): `'retry'` → `className="btn ok"` +
       `<I.retry/>` + `onClick={() => onRetry(files)}`; `'arm'` → today's ghost/message/onArmChange. It
       is NOT covered by the `btnClass(a)` helper (that only runs for the confirm branch). `.btn.ok`
       already exists ([styles/surface-blocks.css](../../apps/builder/web/src/styles/surface-blocks.css)
       — green, `--ok`); no CSS change.
    3. **`onRetry` threads through TWO components.** `GateActions` is rendered both directly in the
       docked bar ([App.tsx](../../apps/builder/web/src/components/App.tsx) — the parked-gate path an
       error gate actually uses) AND nested inside `GateCard` (Chat.tsx — the inline `phase==='test'`
       path). Add `onRetry` to BOTH components' props and pass it at BOTH App call sites (the docked
       `GateActions` and the `GateCard`), or the error gate that renders via one path but not the other
       would keep the dead button. `GateActions` needs access to the composer `files` — pass them in as
       a prop (the docked call site already has `files` in scope; `GateCard`'s inline test path has no
       composer files → pass `[]`).
    4. **`onRetry(files)` body** = `void store.reply('', 'Retry phase', files.length ? toWire(files) : undefined).then(ok => { if (ok) setFiles([]); })` — clears staged files only on success, mirroring
       `send()`'s reset discipline (`toWire` from [lib/attachments.ts](../../apps/builder/web/src/lib/attachments.ts);
       `api.reply(id, text, files?)` already accepts the 3rd arg).
- **D3 · The one-click retry CARRIES any staged files — it does not drop them (locked; r2).** At an
  error gate the composer's attach affordance is LIVE (`askableGate` is false at `status:'error'`, so
  [App.tsx §Composer.onAddFiles](../../apps/builder/web/src/components/App.tsx) provides `addFiles`), so
  a user can stage a file and THEN click Retry. A one-click retry that sent `store.reply('')` with no
  files would silently discard that file — a data-loss footgun. Instead `onRetry` forwards the current
  `files`: `store.reply('', 'Retry phase', files.length ? toWire(files) : undefined)`, then clears
  `files` (mirroring `send()`'s post-send reset). This is coherent server-side: an empty `replyText`
  still appends `attachmentBlock(task.attachments)` into `freshPrompt` ([orchestrator.ts §buildPrompts](../../apps/builder/server/lib/orchestrator.ts)),
  so the freshly-saved files reach the re-run turn. Semantics: "re-run the phase with whatever is
  currently staged" — never "re-run but silently forget the file I just attached".
- **D4 · The composer stays available for a STEERED retry (locked).** Clicking `Retry phase` does the
  text-less (file-inclusive) re-run; a user who wants to steer (e.g. "simplify the spec — drop the CSV
  export") just types into the always-present composer and sends — that routes through the existing
  `st === 'error' → store.reply(msg, …)` branch ([App.tsx §send](../../apps/builder/web/src/components/App.tsx)),
  which already works for non-empty text (+ files). So both intents are reachable: one-click re-run
  (button), steered re-run (dock). No second button is added — the dock IS the steered path.
- **D5 · No orchestrator change (locked).** `replyWithin(task, '', ctx)` already re-runs the current
  phase: with an empty `replyText`, [orchestrator.ts §buildPrompts](../../apps/builder/server/lib/orchestrator.ts)
  sets `resumePrompt = freshPrompt` (the `opts?.replyText ? … : freshPrompt` ternary), i.e. the resumed
  session receives the full phase prompt again — a clean re-run, exactly the byte-unchanged retry
  semantics. The `CHANGE_REQUEST` header and the `{{KNOWLEDGE}}` tail are appended ONLY on the
  non-empty branch, so an empty retry carries neither (correct — there is no change to request). This
  branch is already exercised by fresh phase runs; the retry path merely reaches it via `replyWithin`
  for the first time. **STATIC-only** — that resume-with-`freshPrompt` produces a clean artifact (not a
  duplicated/confused SPEC.md) is asserted from reading, not observed; AC7 is the runtime gate (QA-1).
- **D6 · An errored PROMOTE build's empty retry 409s gracefully — no crash, no dead code path
  (locked; r2, verified).** A promote build CAN reach `status:'error'` with `task.gate = undefined`
  ([promote.ts §startPromote error branch](../../apps/builder/server/lib/promote.ts)). Once D1 lets
  empty text past the top guard, an empty `/reply` on such a task flows to the promote-gate check
  `task.kind === 'promote' && !task.gate?.actions.some(a => a.kind === 'reply')`. With `gate` undefined,
  `task.gate?.actions.some(...)` SHORT-CIRCUITS to `undefined` (optional chaining collapses the whole
  chain — it does NOT throw on `.some` of undefined), so `!undefined === true` → a clean
  `409 'this promote gate has no change action'`. The FE never even shows a retry button for a promote
  error (gate undefined → `GateActions` renders nothing — `actions.length===0` early-return), so this only defends a crafted POST. AC-new pins
  it (200-vs-409-vs-throw matrix) so a future refactor of that guard can't regress it into a 500.
- **D7 · A text-less retry still gets a visible "retrying" state (locked).** `store.reply('', …)`
  calls `optimisticAdvance(...)` with the `'Retry phase'` label just like a normal reply, so the gate
  closes and the phase re-opens as a fresh run via SSE (the `phase running` disclosure). The user sees
  the phase restart immediately — the fix's whole point is that the click now has visible effect. On a
  409 turn-busy (another turn racing) `store.reply` returns `false`; since there is no typed draft to
  restore, the FE just re-enables the button (the existing `busy` gating covers the in-flight window). A
  double-click is a non-issue: the button is `disabled={busy}` and the server `acquireTurn` 409s the
  second call — no second turn spawns.

## Non-goals

- **No** auto-retry / retry-with-backoff / wait-until-quota-resets (still human-gated per 009 §I and
  the 045 non-goals — the button is the recovery path, now functional).
- **No** change to the STEERED reply path (041) — non-empty `/reply` at any gate is byte-unchanged.
- **No** empty-reply allowance at `awaiting_confirm` gates (D1 scopes strictly to `status:'error'`).
- **No** new gate action, wire `kind`, or Task field — D2 keys on the existing `id==='retry'` +
  `status==='error'`.
- **No** retry-count cap or "retried N times" telemetry (a separate idea; the user can retry as often
  as a transient failure warrants, same as they could by re-typing today).
- **No** dropping of staged files on a one-click retry — D3 forwards them. (The *inverse* non-goal:
  we do NOT add a confirm-dialog for "retry with the attached file?" — forwarding silently matches the
  `send()` mental model where staged files always ride the next send.)
- **No** `send()` change (r2) — the empty-retry never routes through it; its `!msg` guard is untouched.

## Acceptance criteria

1. *(S1, server)* A new `test/retry-out-of-error.test.ts` (or extend `test/recovery.test.ts`),
   `app.inject`-driven like the other route tests (there is no `tasks.test.ts` — the `/reply` route is
   exercised across `advance-loop`/`edit-existing`/etc.): a task in `status:'error'` accepts an
   **empty**-text `/reply` (200, dispatches `replyWithin`); the SAME empty `/reply` against an
   `awaiting_confirm` task still 400s `text is required`. A non-empty `/reply` is byte-unchanged in both
   states (pinned).
2. *(S1, server)* An empty-text retry on an errored NON-test phase re-runs that phase: assert
   `replyWithin` is invoked with `text === ''` and the prompt built is the `freshPrompt` (no
   `CHANGE_REQUEST` header) — proving D5's empty-branch is taken, not a steered edit.
3. *(S1, server — promote edge, D6)* Empty `/reply` against a `kind:'promote'` task in `status:'error'`
   (gate `undefined`) returns a clean **409 `this promote gate has no change action`** — NOT a 400
   (empty text is now allowed past the top guard), NOT a 500/throw (optional-chaining short-circuit).
   Pin the full matrix: {phase-task, promote-task} × {error, awaiting_confirm} × empty text → expected
   status, so a refactor of the guard order can't silently regress it.
4. *(S1, store)* `web/src/store.test.ts` — `reply('')` on a `status:'error'` task issues `api.reply(id, '', …)`,
   pushes **no** empty user bubble, and optimistic-advances with the `'Retry phase'` label; `reply('')`
   on an `awaiting_confirm` task returns `false` and posts nothing (guard still holds off the error path).
5. *(S1, store — file inclusion, D3)* `web/src/store.test.ts` — `reply('', 'Retry phase', wireFiles)` on a `status:'error'` task
   forwards the files to `api.reply` (asserts the 3rd arg is the wire files, non-empty) — proving a
   staged attachment is NOT dropped on a one-click retry.
6. *(S2, FE)* **Pin the branch as PURE logic, not a React render** — the web app has NO component-render
   harness today (no `@testing-library`, zero `.test.tsx`; all web tests are pure `.test.ts` on
   store/lib functions). Mirror spec 035's `terminalFootActions` precedent: extract the reply-button's
   decision into a pure helper in `lib/gate-foot.ts`, e.g. `replyButtonKind(action, status) → 'retry' |
   'arm'` (retry ⇔ `action.id==='retry' && status==='error'`), and unit-test it in
   `web/src/lib/gate-foot.test.ts` — retry-at-error → `'retry'`; the same `retry` id at a non-error
   status → `'arm'`; `still_failing`/`awaiting_import` reply ids → `'arm'` (carve-out doesn't leak).
   `GateActions` then branches on the helper to pick `onRetry`+`btn ok`+`I.retry` vs
   `onArmChange`+`btn ghost`+`I.message`. (Introducing a render harness is explicitly out of scope — a
   separate infra decision; the pure helper + AC7's manual repro cover the behavior.)
7. *(S2, MANUAL — QA-1, gates D5)* Repro the field incident end-to-end: drive **② Spec** to
   `status:'error'` (e.g. a forced turn timeout), click `Retry phase` ONCE (type nothing) → the phase
   re-opens as a running disclosure, re-gates, and **SPEC.md is a clean single artifact — NOT
   duplicated or garbled** by the resume-with-`freshPrompt`. Button disabled while busy. This is the one
   decision the fix takes on static reasoning; it MUST be observed before merge, not assumed.
8. *(S2, MANUAL — QA-2)* Drive **④ Test (static)** to `status:'error'`, click `Retry phase` → confirm
   the report **actually re-runs** (`runTestAndFinish` executes; lint/report output regenerates) rather
   than falsely reporting PASS on the unchanged `main.yml`. Repeat once for **④ live** (`testMode:'live'`
   → resumes Implement) to confirm both ④ sub-paths recover.
9. *(S2, MANUAL — staged file)* At an error gate, attach a file, then click `Retry phase` → the file
   reaches the re-run turn (visible in the turn's attachment block / the produced artifact references
   it), confirming D3 end-to-end (the unit test 5 pins the wiring; this pins the round-trip).
10. Existing suites green; no change to `gate.ts` action shape, orchestrator routing, or any
    FSM/status semantics (the only server edit is the ordering + condition of the empty-text 400).

## Sequencing

- **S1** — server `/reply` empty-on-error carve-out + `store.reply` empty-on-error branch + their
  tests (the value: a text-less retry is now *possible* at the API/store layer).
- **S2** — the FE one-click wiring (`onRetry` prop + `id==='retry'` branch in `GateActions` + `I.retry`
  icon add + threading through `GateCard`) +
  render tests + the HUONG_DAN troubleshooting row (`フェーズでエラー` → 「再試行」ボタンで即再実行;
  要件を変えたい場合は下の入力欄に書いて送信) + spec-index row.

## Open questions

- ~~**OQ1** — retry button ghost vs primary?~~ **RESOLVED (r2): primary `ok`/green** — see D2. The
  error gate's sole, non-destructive action must be visibly actionable; a ghost sole-button reproduces
  the very "looks inert" failure this spec fixes.
- **OQ2** — after N consecutive empty retries that keep erroring, surface a hint ("still failing —
  try Request changes to simplify the requirement, or check the 045 cause note")? Default: not in v1;
  the 045 note already names the cause each time. Revisit if repeated-retry loops show up in the field.
- **OQ3** — mirror the same one-click affordance onto the `still_failing` "Keep trying" reply-button
  (also a re-run intent, though there the artifact usually needs a steer)? Default: no — "Keep trying"
  at a lint-failing gate genuinely wants steering text more often than not; leave it arming the composer.

## Revision log

- r1 (2026-07-09) — initial draft, from the ② Spec timeout field incident (600s network timeout → dead
  `フェーズを再試行` button). Root cause traced through the (then-claimed) three empty-text guards + the
  reply-kind arm-composer behavior; confirmed the orchestrator already re-runs on empty `replyText` (no
  server logic change beyond the guard). Anchors verified same day.
- r2 (2026-07-09) — QA-driven review folded in (all edits verified against the code same day):
  **(1)** corrected "three layers" → **two** — `send()` is NOT a guard on the retry path (the button
  fires `store.reply` directly), so its `!msg` guard is untouched (D1).
  **(2)** the one-click retry now **carries staged files** instead of dropping them — verified attach is
  live at an error gate (`askableGate` false), so a no-files retry would be silent data loss; empty
  `replyText` + files is coherent server-side (`attachmentBlock` rides `freshPrompt`) — new D3, AC5, AC9,
  a non-goal.
  **(3)** resolved OQ1 → the retry button is **primary `ok`/green + ↻ icon**, not ghost (D2); a ghost
  sole-action reproduced the "looks inert" bug.
  **(4)** documented the **promote-error edge** (new D6, AC3): once empty text is allowed past the top
  guard, an errored promote task's empty `/reply` reaches the promote-gate check and 409s gracefully —
  verified the optional-chaining short-circuit does NOT throw; pinned by a status matrix so a guard
  refactor can't regress it to a 500.
  **(5)** split the two **STATIC-only claims** into explicit MANUAL-verify ACs (AC7 QA-1: resume-with-
  `freshPrompt` produces a clean SPEC.md; AC8 QA-2: ④-static/live retry actually re-runs) + a header
  banner, so the two things reasoning can't prove are gated before merge, not assumed.
  Net: 2 server edits (guard order/condition) + `store.reply` branch + FE button wiring/styling; no
  orchestrator/gate/FSM change.
  **(6)** anchor-audit against the real tree: the buttons live in `GateActions` (NOT "GateFoot"), reached
  both docked (App.tsx) and nested in `GateCard` — `onRetry` threads through both + both call sites; the
  icon set has NO ↻ glyph, so `I.retry` is a new addition (`undo` is a wrong-semantics back-arrow); the
  reply-branch hardcodes `btn ghost` so the green needs a special-case, split on a new pure helper
  `replyButtonKind`; `.btn.ok` already exists (no CSS). Test-harness names corrected to real files: no
  `tasks.test.ts` (new `test/retry-out-of-error.test.ts` or extend `test/recovery.test.ts`,
  `app.inject`-driven); store ACs → `web/src/store.test.ts`; and — since the web app has ZERO
  component-render tests (no `@testing-library`) — AC6 pins the branch as PURE logic in
  `web/src/lib/gate-foot.test.ts` (the `terminalFootActions` precedent), not a render test.
- r3 (2026-07-09) — **IMPLEMENTED (unit-verified).** Landed exactly as r2 specced:
  - **Server** — `apps/builder/server/routes/tasks.ts` `/reply`: the empty-text `400` moved below
    `loadTask`+status-check, now `if (!text && task.status !== 'error')`.
  - **Store** — `store.ts` `reply()`: `if (!t) return false; if (!trimmed && t.status !== 'error') return false;`;
    empty text pushes NO user bubble; `api.reply(id, trimmed, files)`.
  - **FE** — `Icon.tsx` gains `retry` (↻ rotate-cw); `lib/gate-foot.ts` gains the pure
    `replyButtonKind(action, status)`; `Chat.tsx` `GateActions` branches the reply button on it
    (`retry` → `btn ok` + `I.retry` + `onRetry`; else ghost/`I.message`/`onArmChange`) and threads
    `onRetry` through `GateCard`; `App.tsx` adds the `onRetry()` closure (forwards staged `files` via
    `toWire`, clears on success) passed to both the `GateCard` and docked `GateActions`. Chose a
    zero-arg `onRetry: () => void` over r2's `onRetry(files)` prop — App owns the files closure exactly
    like `onArmChange`, so no files prop threads through the components (cleaner, same behavior).
  - **Tests** — new `test/retry-out-of-error.test.ts` (6 cases: the {phase,promote}×{error,awaiting_confirm}
    matrix + unknown-id, lock-holder trick proving empty reached dispatch without a spawn); new
    `web/src/store.reply.test.ts` (4 cases: empty-on-error dispatch/no-bubble/label, empty-on-awaiting
    no-op, file-forwarding, steered-reply-still-bubbles); `replyButtonKind` cases in `gate-foot.test.ts`.
  - **Green:** server 456/456, web 167/167, tsc clean (both), web prod build OK.
  - **STILL OPEN:** the three MANUAL gates AC7 (QA-1 clean SPEC.md on resume), AC8 (QA-2 ④ re-runs),
    AC9 (staged-file round-trip) — need a running Dify + a forced phase error; not yet observed.

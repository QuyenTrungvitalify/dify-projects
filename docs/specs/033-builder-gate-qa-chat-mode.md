# Spec 033 — Builder gate Q&A / chat mode (Ask vs Request-changes)

**Status**: Revised — an adversarial multi-agent review found the original D3 mechanism ("reuse
confinementCheck/gitDirtyPaths revert") **unenforceable** (4 independent reasons, all confirmed against the
code; see D3). This revision replaces it with a two-layer mechanism (hook-deny + byte-snapshot/restore) and
closes every contradiction/under-specification the review found (FIX-A…L below, all folded into the design).
D1/D2/D4/D6/D7 stand; D5 (was open) is now CLOSED; D3 is fully rewritten. A follow-up fact-check found layer
2's snapshot scope (one file) narrower than layer 1's actual write-allow surface (the whole
`projects/<project>/<workflowSlug>/` + `apps/builder/.runs/<taskId>/` tree) — closed as **FIX-M** below; D3's
layer 2 is widened accordingly. Ready to implement S1→S4.

**Builds on**:
- [009](009-browser-workflow-builder.md) — the gated 4-phase FSM; `/reply` = re-run the CURRENT phase via
  `--resume` ([orchestrator.ts `replyWithin`](../../apps/builder/server/lib/orchestrator.ts#L190)).
- [015](015-builder-security-turn-sandbox.md) — every `claude` turn has `DIFY_*` stripped + the PreToolUse
  permission-gate hook. **Load-bearing** here too: the Ask turn is just another turn, so it inherits both, AND
  this spec extends the hook's decision surface for the first time since 015/018 (D3 layer 1, a new branch in
  [permission-gate.ts `decide()`](../../apps/builder/server/hooks/permission-gate.ts#L318)).
- [016](016-builder-gate-copy-and-affordances.md) — the gate card + its Reply ("Request changes") affordance.
  Its inline reply textarea ([Chat.tsx `GateCard`](../../apps/builder/web/src/components/Chat.tsx#L282-L294),
  `replying`/`setReplying` state) is **removed** here — the composer's change-mode is the one reply surface
  (FIX-G).
- [032](032-builder-live-workflow-test.md) §S0.5 A1 — **only proposed**, never built, a `runDataTurn`
  primitive. The shape that actually shipped, `runJudge`
  ([live-test.ts:78-117](../../apps/builder/server/lib/live-test.ts#L78-L117)), never `--resume`s and never
  persists a `session_id` ([live-test.ts:100-108](../../apps/builder/server/lib/live-test.ts#L100-L108) —
  `new ClaudeSession(...)` with no `resumeSessionId`, `runTurn(session, prompt, () => {}, …)`) — the **wrong
  shape** for Ask, which needs resume+persist (D5). This spec does not reuse it; it duplicates a small spawn
  helper instead (§1, FIX-A).

**Depends on**: nothing new — no new deps, no Dify contact. No change to the gate FSM / `computeGate` / phase
outcomes (Ask is orthogonal to the gate, D3). Two existing modules each gain one small, additive branch: the
permission-gate hook (D3 layer 1) and the turn lock ([lock.ts](../../apps/builder/server/lib/lock.ts), D9).

**Split out**: Ask/Q&A at the ④ Test gate, and after a terminal `done` build, is tracked in a separate sibling
spec, **034** — see D4 / Non-goals / Open questions.

---

## Context — why the current behavior is wrong for a question

At a parked gate the composer's Send is ALWAYS a `/reply` → `replyWithin` →
`runPhaseAndGate(task.phase, {resumeId, replyText})`
([orchestrator.ts:190,202](../../apps/builder/server/lib/orchestrator.ts#L190)). So it **re-runs the whole
phase turn** and **re-gates**. The skill body (e.g. `spec.md`) tells the turn to *"revise the existing
artifact"*.

Real observed friction: at the Spec gate the user typed *"giải thích kĩ hơn về phần đã phân tích được
không"* (a QUESTION). The build showed **`実行中 ② 仕様 / 処理中`** (re-running Spec), spent a full turn,
**risked rewriting `SPEC.md`**, and rendered the answer as **phase-output** — not a clean message↔message
reply. There is **no way to ASK a question at a gate without triggering a phase re-run**.

**This feature:** add a **conversational Ask** mode at gates — a resume-the-session, **answer-only**,
artifact-immutable turn rendered as message↔message — distinct from the existing **Request-changes**
(re-run) path.

---

## Design decisions

- **D1 · Two EXPLICIT modes — never auto-classify (locked).** `Ask` (chat, no phase re-run) vs `Request
  changes` (re-run the phase, as today). We do NOT infer intent from the text: a misclassified *change*
  silently treated as chat would leave the user thinking they edited the spec when they didn't (and
  vice-versa). Explicit is safe; classification is a footgun.

- **D2 · Composer Send defaults to `Ask`; `Request changes` is the explicit edit path (locked).** Most
  messages at a gate are discussion/questions. The exact routing predicate (closing FIX-F, a real
  pre-existing-behavior contradiction the review found) is now explicit — see §3:
  - `status==='awaiting_confirm' && phase∈{analyze,spec,implement} && mode==='ask'` → `/ask` (new).
  - `status==='awaiting_confirm'` with `mode==='change'`, OR `phase==='test'` → `/reply` (today's behavior,
    byte-unchanged — ④ never offers Ask, D4). **[Superseded by spec 034 D5]** — once 034 ships, `phase==='test'`
    is no longer a blanket `/reply`; it gets the SAME `mode==='ask'|'change'` split as the other three phases.
    This row is accurate only as of 033's own scope (④ has no Ask yet here); do not read it as still current
    once 034 lands.
  - `status==='error'` → `/reply` (Retry-out-of-error, byte-unchanged — [tasks.ts:314](../../apps/builder/server/routes/tasks.ts#L314)
    already accepts `error`; App.tsx's `send()` must keep hitting this branch, not the new Ask branch).
  - `status==='done'|'cancelled'`, or the empty view → `/api/tasks` (start a new build), unchanged.
    **[Superseded by spec 034 D3 for `done`/`cancelled` specifically]** — once 034 ships, Send at those two
    statuses routes to Ask instead (`store.ask(text)`), not `store.start()`; only the empty view still starts
    a new build. This row, too, is accurate only as of 033's own scope.

- **D3 · Ask turn containment — TWO INDEPENDENT LAYERS, neither relying on confinementCheck (locked,
  REWRITTEN).** The original mechanism ("resume + wrapper instruction + reuse confinementCheck/gitDirtyPaths
  revert") is **unenforceable**, confirmed on the actual code:
  1. `confinementCheck` **whitelists** `projects/<project>/<workflowSlug>/`
     ([post-turn.ts:192-201](../../apps/builder/server/lib/post-turn.ts#L192-L201)) — exactly where
     `SPEC.md`/`main.yml` live post-scaffold — so a write there is classified NON-breach and never reverted.
  2. Its revert only acts on `turnTouched = gitDirtyPaths(after) MINUS a freshly-captured baseline`
     ([post-turn.ts:189-190](../../apps/builder/server/lib/post-turn.ts#L189-L190)). The gate's own artifact
     is **already dirty/uncommitted** at a parked gate (it's in the baseline already), so a re-edit of the
     SAME path is invisible to this delta — even a "revert everything touched" variant would miss it.
  3. At the Spec gate pre-scaffold, `SPEC.md` lives at `apps/builder/.runs/<taskId>/SPEC.md`
     ([phases.ts:67-70](../../apps/builder/server/lib/phases.ts#L67-L70)), a **gitignored** directory
     ([apps/builder/.gitignore:3](../../apps/builder/.gitignore#L3), root
     [.gitignore:37](../../.gitignore#L37)) — a rewrite there is invisible to `git status` entirely; git-based
     detection can't see it at all.
  4. `revertPath` does `git checkout -- <path>` then `git clean -fd -- <path>`
     ([post-turn.ts:242-246](../../apps/builder/server/lib/post-turn.ts#L242-L246)): for an untracked
     freshly-built artifact, `checkout` is a no-op and `clean -fd` **deletes** it (does not restore the
     pre-Ask content); for a tracked edit-existing `main.yml`, `checkout` resets to `HEAD`, wiping the whole
     Implement phase's work, not just the Ask's edit.
  5. §3 (original)'s claim that the PreToolUse hook "contains" a rogue write was also false: the hook
     explicitly **allows** in-project writes (`WRITE_TOOLS` → `'in-project write'`,
     [permission-gate.ts:341-344](../../apps/builder/server/hooks/permission-gate.ts#L341-L344)) — it must,
     for Implement — so it provided zero containment for this specific case.

  **The replacement — two layers, neither borrowed from the phase-verify pipeline:**

  **Layer 1 (structural, primary).** The backend spawns the Ask turn with a new env var
  `BUILDER_ASK_MODE=1` on the child, set the same way `BUILDER_TASK_ID` already is
  ([claude-session.ts:114-118](../../apps/builder/server/lib/claude-session.ts#L114-L118) — a new
  `SessionOptions.askMode?: boolean`, set right after the existing strip loop). `permission-gate.ts`'s
  `decide()` gains a new branch, checked **before** the existing write-allow
  ([permission-gate.ts:341-344](../../apps/builder/server/hooks/permission-gate.ts#L341-L344)): when
  `BUILDER_ASK_MODE` is set (read in `main()` the same way `BUILDER_TASK_ID` is at
  [permission-gate.ts:387](../../apps/builder/server/hooks/permission-gate.ts#L387), passed into `decide()` as
  a new parameter), **every** `Write`/`Edit`/`MultiEdit`/`NotebookEdit` call is denied outright — reason
  `"Ask mode — this turn may not write files"`. A normal phase/reply turn never sets this env, so `decide()`'s
  existing branch is untouched byte-for-byte for every other turn. (Bash needs no matching change: the
  Builder's allowed Bash surface — `ALLOWED_PYTHON_SCRIPTS` — contains only read-only validators/finders,
  none of which write `SPEC.md`/`main.yml`, and `SIMPLE_COMMAND`
  ([permission-gate.ts:99](../../apps/builder/server/hooks/permission-gate.ts#L99)) already forbids `>`
  redirects — there is no write path through Bash to close.) This makes "Ask cannot write" a **structural**
  property enforced by the same hook mechanism spec 015 already trusts for everything else, not a soft prompt
  instruction.

  **Layer 2 (backstop, defense-in-depth — in case layer 1 has a bug or is bypassed) — scoped to the FULL
  write-surface layer 1 protects, not one file (FIX-M, closed via the same fold-into-design discipline as
  FIX-A…L).** The original draft of this layer snapshotted only the phase's own gate artifact
  (`phase.artifactRel(task)`). That undersells what "layer 1 is bypassed" actually means: layer 1 is a single
  categorical branch inserted **before** the existing `WRITE_TOOLS` → `'in-project write'` allow
  ([permission-gate.ts:341-344](../../apps/builder/server/hooks/permission-gate.ts#L341-L344)), which itself
  permits a write **anywhere** `pathIsProtectedWrite` allows
  ([permission-gate.ts:239-252](../../apps/builder/server/hooks/permission-gate.ts#L239-L252)) — the whole
  `projects/<project>/<workflowSlug>/` tree, plus the task's own `apps/builder/.runs/<taskId>/` tree. So a
  bypassed layer 1 doesn't narrow the turn down to "can only mis-write the one gate artifact" — it hands the
  turn the **identical** write surface an ordinary phase turn already has. A layer 2 that watches only one
  file inside that surface would silently miss a new file dropped elsewhere in the project, an edit to some
  other pre-existing file in it, or a write into `.runs/<taskId>/` outside the phase artifact — for any of
  those, "Biggest risks #1" ("a failure of one is caught by the other") would not actually be true.

  **The fix: layer 2's scope is DEFINED AS whatever `pathIsProtectedWrite` allows for this turn, not a
  hand-picked path.** Immediately before spawning the Ask turn, the backend recursively snapshots every
  existing file under BOTH writable roots (`projects/<project>/<workflowSlug>/` and
  `apps/builder/.runs/<taskId>/` — the same two roots
  [permission-gate.ts:247-249](../../apps/builder/server/hooks/permission-gate.ts#L247-L249) allow), holding
  each file's relative path + bytes (a plain recursive directory walk + read, or a copy into a temp snapshot
  dir — safer than holding arbitrary content as JS strings if a project ever contains a binary asset). This
  is filesystem-direct, never git-based — it must NOT reintroduce the four problems the ORIGINAL (pre-rewrite)
  D3 was found unenforceable for (whitelisted dirs, in-baseline-already-dirty, gitignored `.runs`, destructive
  `checkout`+`clean`): none apply here, since this walks the filesystem directly and restores by writing held
  bytes back, exactly like the single-file case already did. If the initial walk itself fails (permissions,
  missing root), `askWithin` fails closed, same as the single-file case.

  After the turn settles (success, error, or timeout — the compare always runs regardless of outcome), the
  backend re-walks the SAME two roots and diffs against the snapshot:
  - a path present now but absent from the snapshot → **created** (delete it to restore).
  - a path in the snapshot but absent now → **deleted** (recreate it from the held bytes).
  - a path present in both with different bytes → **modified** (overwrite with the held bytes).
  - a path present in both with identical bytes → unchanged (ignored).
  - all three anomaly kinds are restored **unconditionally**, file-by-file — exactly like the single-file
    case's "overwrites immediately, before the FE is told anything," just no longer limited to one path.

  - **no anomalies across the whole walk** → proceed normally (§1's normal path — no gate/status touch, no
    `task:update`, FIX-B) — byte-identical to today's normal-path behavior.
  - **any anomaly** → after restoring every touched path, compute a per-file report: a unified diff
    (reusing `diff.ts`'s `DIFF_PROBE` `difflib.unified_diff` shape,
    [diff.ts:29-41](../../apps/builder/server/lib/diff.ts#L29-L41)) for each **modified** file, and a plain
    `created`/`deleted` tag for the other two kinds (a diff against nothing isn't meaningful) — aggregated
    into `anomaly: { files: Array<{ path: string; kind: 'modified' | 'created' | 'deleted'; diff?: string }>
    }` (widens §2's `ask:done` payload; the single-file `{diff: string}` shape becomes a one-element case of
    this). The FE's `ConfirmModal`/`store.askConfirm()` reuse (unchanged mechanism) renders one block per
    file instead of one diff. Note `ConfirmModal` always renders TWO buttons (`onCancel`/`onOk`,
    [Modal.tsx:125-128](../../apps/builder/web/src/components/Modal.tsx#L125-L128)) — there is no
    single-button mode. Since every restore already happened before the dialog shows, there is nothing left
    to decide: both `onOk` and `onCancel` are wired to the SAME dismiss handler, and both labels read as a
    plain acknowledgment (not the default Cancel/OK semantics, which would falsely imply a choice). There is
    deliberately **no** "keep this change" affordance anywhere in this dialog: D1 requires Ask and
    Request-changes to stay absolutely distinct; letting a user "keep" an unauthorized Ask-turn edit would
    let an Ask become a de-facto Request-changes. If the user wants that content, they must explicitly use
    Request-changes.

  **New consequence for the mandatory `PUT /spec` fix (§1) — FIX-M.** Since layer 2's scope now equals layer
  1's full allow-surface, the SAME false-positive risk the `PUT /api/tasks/:id/spec` turn-lock gap posed (a
  legitimate concurrent write misattributed to the Ask and reverted) now applies to **any** route that can
  write into either root outside the turn lock, not just that one route. Auditing for other such routes
  becomes part of S1, not optional cleanup — each one found needs the identical `turnHolderId() === id` → 409
  guard `PUT /spec` already gets. **The S1 audit found TWO sites, both now guarded:** (1) `PUT /spec`, and
  (2) `POST /api/tasks/:id/reply` — whose `saveAttachments` writes into `apps/builder/.runs/<id>/uploads/`
  (a snapshotted root) BEFORE its own `acquireTurn` 409s ([tasks.ts:324-333](../../apps/builder/server/routes/tasks.ts#L324));
  a `/reply` racing a live Ask on the same task would otherwise land files there and have the Ask's
  byte-compare delete them + false-anomaly. `POST /api/tasks` also saves attachments pre-lock but only
  under a brand-new taskId (never in a live Ask's roots), so it is out of scope; `/confirm` takes the lock
  before any write. Both guarded sites reject with the identical same-id `turnHolderId() === id` → 409.
  (Additionally: `askWithin` NEVER throws past its snapshot — any internal error becomes a benign
  `ask:done {ok:false}` rather than propagating to the dispatch `failSafe`, which would otherwise flip the
  parked gate to `error`, violating "Ask never touches status/gate".)

  Neither layer ever touches `task.status`/`task.gate` — "the gate stays parked, unchanged" holds on BOTH the
  normal and the anomaly path. Because layer 1 makes an actual write essentially unreachable, the old tension
  between "a confinement breach is always a hard error" and "Ask never changes status" dissolves: there is
  structurally nothing left for the phase FSM's `confinementCheck`/`postTurnCheck` hard-error path to catch
  during an Ask (that machinery is **untouched**, and keeps running exactly as today for
  Analyze/Spec/Implement/Reply turns — Ask has its own, separate two-layer containment).

  **A rejected alternative** (recorded so it isn't re-litigated): a live, mid-tool-call human-approval
  channel, modeled on claude-nexus's `PermissionQueue` (`src/server/lib/permission-queue.ts`, ~138 lines — a
  blocking `POST /internal/.../evaluate` the hook `fetch()`s and awaits, resolved by a browser-facing
  `/approve`/`/deny` endpoint via a `Map<requestId, {resolve, timer}>`), plus ~120 lines of routing/evaluator
  glue. Feasible to port (est. 3-5 days) but **deferred**: live-block only meaningfully outperforms
  post-hoc-detect-and-restore for **irreversible** actions (network calls, deletions, process control) —
  filesystem writes are fully reversible, so the two-layer mechanism above reaches an identical end state at
  roughly half a day's cost. Revisit only if the builder later needs live human-approval for a broader class
  of actions than Ask's file-writes.

- **D4 · Ask is available wherever a resumable session exists (analyze / spec / implement) — ④ Test and
  post-`done` are OUT OF SCOPE here (locked).** `task.sessionIds` has literally no `'test'` key
  ([task.ts:127](../../apps/builder/server/state/task.ts#L127) — `{ analyze?: string; spec?: string;
  implement?: string }`), confirming ④ has no resumable session, ever. **v1: the composer Send at the ④ gate
  keeps its current meaning** (Ask is never offered there) — not a regression, ④ already behaves as today
  (FIX-J keeps its docking unscoped-to-④ too, see D7). Ask/Q&A at ④, and after a terminal `done` build,
  requires a fundamentally different, fresh-seeded (non-resume) mechanism — **tracked separately in spec
  034**, out of scope for 033.

- **D5 · Ask context accumulates in the shared phase session (CLOSED — was open as OQ1).** The Ask turn
  `--resume`s `sessionIds[task.phase]` and persists its own returned `session_id` back to the same slot (like
  `/reply` does), so a follow-up Ask — or a later Request-changes — sees the Q&A. **Closed**: safety does not
  depend on session-sharing at all — Ask's read-only guarantee is now **structural** (D3 layer 1's
  hook-deny), independent of how much prior Q&A sits in the session, so sharing cannot compromise it. Worth
  naming an asymmetry precisely rather than glossing over it: a `/reply` on an already-resumed session sends
  ONLY the bare change-request text — `resumePrompt = opts.replyText + block`, no restated "revise the
  artifact" framing ([orchestrator.ts:322-328](../../apps/builder/server/lib/orchestrator.ts#L322-L328), esp.
  its own comment: *"A /reply with a live session sends ONLY the change request (the resumed session has
  context)"*). That framing lives once, in the phase's ORIGINAL skill-body prompt from turn 1, and persists
  in the session's history regardless of how much Ask Q&A happens in between; Ask's own wrapper, by contrast,
  IS restated every turn (§1 step 2). So the two turns are not symmetric in HOW they encode intent — but
  neither's correctness depends on the OTHER restating anything: Reply's correctness rests on turn-1's
  framing never being removed from history (nothing in this design removes it); Ask's safety rests on layer
  1, not on any restated instruction. The only real remaining cost is qualitative, not safety: could enough
  accumulated Q&A chatter dilute a later Reply's attention on the original framing? Bounded, and not a new
  risk this revision introduces — see Biggest risks #3. Session growth itself is also bounded: `confirmAdvance`
  always runs the NEXT phase as a fresh, non-resumed turn (the orchestrator's own top comment,
  [orchestrator.ts:9](../../apps/builder/server/lib/orchestrator.ts#L9) — "run the next phase as a fresh
  turn — no cross-phase resume"), so an Ask's added context never compounds across a whole build, only within
  one phase.

- **D6 · No backend chat log (unchanged).** The thread is built CLIENT-side from SSE (spec 009,
  [store.ts](../../apps/builder/web/src/store.ts)). Ask keeps that: the Q&A lives in the client thread + the
  resumed session; the backend persists no transcript.

- **D7 · The gate's action bar is PINNED while parked, SCOPED to phase∈{analyze,spec,implement} (locked,
  scope fixed — FIX-J).** Because Ask never consumes the gate (D3), the phase's next-step actions
  (Implement/Edit spec/Discard) stay valid through any amount of chat. Originally worded unscoped, which
  would have also relocated ④'s (`test_result`/`infra_degraded`/`awaiting_import`/`still_failing`) actions,
  contradicting AC#6/D4 ("④ behaves as today"). **Fixed scope**: docking applies ONLY at
  `phase∈{analyze,spec,implement}`; ④ Test gates render their actions **inline** exactly as today, unchanged.
  While `status==='awaiting_confirm'` at those three phases, the action bar docks at the bottom (above the
  composer), always visible+clickable; the Q&A chat + phase output scroll in the thread above it. Disabled
  during a live Ask OR a live Reply — needs a NEW `asking` FE signal, since `busy`
  ([store.ts:119-121](../../apps/builder/web/src/store.ts#L119-L121)) is derived solely from
  `status==='running'|'scaffolding'` and D3 means an Ask never sets those — see §3 (FIX-H).

- **D8 · `askTurn` is a standalone, DUPLICATED spawn helper — never `runDataTurn`, never wired into the
  phase pipeline (locked, closes FIX-A).** `runDataTurn` (spec 032 §S0.5 A1) was only ever PROPOSED, not
  built; the shape that shipped, `runJudge`, is throwaway/non-resuming — the wrong shape for D5. Rather than
  refactor `runPhase`'s `spawnOnce` into something both a phase turn and an Ask can share, `askTurn`
  duplicates its ~30-line spawn shape in a new leaf module. This keeps the existing phase-turn code path
  (`runPhase`/`gateAfterPhase`/`PHASES`/the phase-verify pipeline) **byte-unchanged** — matching the spec's
  own "additive" sequencing discipline — at the cost of ~30 duplicated lines, which is cheap relative to the
  risk of a shared-abstraction refactor touching the load-bearing phase FSM. See §1.

- **D9 · Ask has its own SCOPED abort, distinct from the build-terminal `/cancel` (locked, closes FIX-E).**
  Today's `/cancel` force-kills the live session AND converges `task.status`/`task.gate` to terminal
  `cancelled` — correct for a phase turn, WRONG for an Ask (D3 keeps the build parked throughout). `/cancel`
  gains a `liveKind(taskId)` check (a new `kind: 'phase'|'ask'` tag on the turn-lock holder) so it can
  force-kill an Ask's child WITHOUT converging the build's status — the parked gate is left exactly as it
  was. See §1.

---

## Design

### §1 · New turn path (backend)

**New module, not orchestrator.ts.** `askWithin(task, text, ctx)` lives in a new leaf file
`server/lib/ask.ts` (parallel to `live-test.ts`/`post-turn.ts`), imported directly by a new
`POST /api/tasks/:id/ask` route in `routes/tasks.ts` — **orchestrator.ts is not touched at all** (FIX-A). Its
internal spawn step, `askTurn(...)`, **duplicates** (does not refactor-to-share) the ~30-line
`spawnOnce` shape from `runPhase`
([orchestrator.ts:337-367](../../apps/builder/server/lib/orchestrator.ts#L337-L367)): a fresh `ClaudeSession`
with `resumeSessionId: task.sessionIds[task.phase]`, `setSession(task.taskId, session)` so `/cancel` can reach
it, `resolveRunners(ctx).runTurn` (the injectable seam, spec 013 D2 — same seam `runPhase`
([orchestrator.ts:303](../../apps/builder/server/lib/orchestrator.ts#L303)) and `runJudge`
([live-test.ts:87](../../apps/builder/server/lib/live-test.ts#L87)) use, so a unit test can inject a fake),
an `onSessionId` callback that persists `task.sessionIds[task.phase]` immediately (mirroring
[orchestrator.ts:349-352](../../apps/builder/server/lib/orchestrator.ts#L349-L352), D5), and `clearSession`
on settle. Keeping the phase-turn code path byte-unchanged matches the spec's own "additive" sequencing
discipline.

**The `/ask` route** (`routes/tasks.ts`, mirrors `/reply`'s validation shape at
[tasks.ts:298-343](../../apps/builder/server/routes/tasks.ts#L298-L343)):
- `text` required (400 if blank), same as `/reply`.
- `task.status !== 'awaiting_confirm'` → 409 (unlike `/reply`, Ask does **not** accept `status==='error'` —
  it only makes sense at a live parked gate).
- `task.phase` must be `analyze|spec|implement` → 409 otherwise (**backend-side enforcement of D4**,
  independent of the FE's own routing predicate — defense in depth against a stray client bug hitting `/ask`
  at the ④ gate, where there is no session to resume anyway per D4).
- `acquireTurn(id, 'ask')` — a new second parameter on `acquireTurn`
  ([lock.ts:49-54](../../apps/builder/server/lib/lock.ts#L49-L54)), defaulting to `'phase'` so every existing
  call site (`/api/tasks`, `/confirm`, `/reply`) is unaffected; 409 via the existing `turnBusyError()` on
  collision (the lock is a single GLOBAL slot — [lock.ts:34](../../apps/builder/server/lib/lock.ts#L34), one
  `turnHolder` variable, not per-task — so at most one turn, phase OR Ask, runs anywhere at a time; this is
  what makes FIX-C's single-current-qa-item tracking sound, see §2).
- Dispatches via the **existing** `dispatch()` helper
  ([tasks.ts:88-110](../../apps/builder/server/routes/tasks.ts#L88-L110)) unchanged — it's kind-agnostic
  (a `Promise<void>` + `releaseTurn`/`failSafe`), so no new lock-release plumbing is needed.
- Responds `{ ok: true }` immediately — **no** `optimisticRunning(task)`-style snapshot (status/gate are
  genuinely unchanged, FIX-B); the FE sets its own `asking` signal true synchronously on issuing the POST
  (client-side optimism), then relies entirely on the SSE events below.

**`askWithin`'s body:**
1. Snapshot: `before = readFile(join(projectsDir, phase.artifactRel(task)))` (layer 2, D3). Fail closed if
   unreadable.
2. Spawn `askTurn` with prompt `` `${text}\n\n(Answer conversationally. Do NOT create, modify, or delete any
   file — this is a question, not a change request.)` `` + `attachmentBlock` — the wrapper instruction is
   belt only; the deny is the suspenders (D3 layer 1). Timeout: **3 minutes**
   (`ASK_TIMEOUT_MS = 3 * 60 * 1000`), pinned shorter than the phase default `TURN_TIMEOUT_MS` (10 min,
   [orchestrator.ts:47](../../apps/builder/server/lib/orchestrator.ts#L47)) — matching the existing
   `JUDGE_TIMEOUT_MS` convention for a short data-turn
   ([live-test.ts:23](../../apps/builder/server/lib/live-test.ts#L23)) — since an Ask is meant to be a quick
   conversational reply, not a long agentic turn.
3. **Resume-failure must NOT inherit runPhase's write-intent fallback (FIX-D).** `runPhase`'s existing
   fallback ([orchestrator.ts:390-393](../../apps/builder/server/lib/orchestrator.ts#L390-L393)) re-spawns a
   FRESH turn seeded with the full skill body ("revise the existing artifact…") when a resume fails
   (`turn.isError && !turn.result && !turn.note`). `askWithin` must not do this — an Ask whose resume fails
   must never fall through to a write-intent turn. Default (simplest, v1): surface a fixed qa answer —
   *"couldn't recover this conversation — try Request changes"* — and emit `ask:done {ok:false}` (no
   anomaly; no write was attempted). A fresh, genuinely contextless answer turn (no skill body) is a viable
   later refinement if resume failures turn out to be common enough to want a real answer instead of a
   canned one.
4. Stream assistant text fragments as `ask:answer` (mirrors `onText` → `phase:output` at
   [orchestrator.ts:356-357](../../apps/builder/server/lib/orchestrator.ts#L356-L357)).
5. After settle (success, error, or cancel — see below): `after = readFile(...)` (layer 2 compare).
   - unchanged → `ask:done {ok: true}`. No `task.gate`/`task.status` touch, **no `task:update` broadcast**
     (FIX-B).
   - changed (anomaly) → restore `before` bytes, compute the diff, `ask:done {ok: false, anomaly: {diff}}`.
   Neither branch persists `task.sessionIds`/`task.gate`/`task.status` differently from D5's own persist
   step (3) above.

**Ask-scoped abort (D9, closes FIX-E).** The existing `POST /api/tasks/:id/cancel`
([tasks.ts:346-384](../../apps/builder/server/routes/tasks.ts#L346-L384)) is **build-terminal**: it
force-kills the live session AND sets `task.status='cancelled'`/`task.gate=undefined`
([tasks.ts:368-377](../../apps/builder/server/routes/tasks.ts#L368-L377)). Since D3 keeps
`status==='awaiting_confirm'` throughout an Ask, hitting today's `/cancel` mid-Ask would wrongly abandon the
whole parked build. Fix: `TurnHolder` ([lock.ts:26-30](../../apps/builder/server/lib/lock.ts#L26-L30)) gains
a `kind: 'phase' | 'ask'` field (set by `acquireTurn`'s new second parameter above), exposed via a new
`liveKind(taskId)` accessor. `/cancel` branches on it: if `liveKind(id) === 'ask'`, force-kill
`liveSession(id)` exactly as today ([tasks.ts:360-367](../../apps/builder/server/routes/tasks.ts#L360-L367))
but **skip** `markCancelled(id)` and **skip** the `fresh.status = 'cancelled'` write — the parked gate is left
exactly as it was. (Critically, `markCancelled`/`isCancelled` are keyed only by `taskId`, backed by one shared
`cancelledTasks` Set ([lock.ts:40](../../apps/builder/server/lib/lock.ts#L40),
[91-93](../../apps/builder/server/lib/lock.ts#L91-L93)) — the SAME flag a phase turn's cancel uses. If an
Ask-cancel called `markCancelled`, `isCancelled(taskId)` would stay `true` afterward. Ask's dispatch DOES run
through the same `dispatch()` helper as any turn (§1, unchanged) — but its terminal-evict check only fires
when `task.status∈{done,error,cancelled}`
([tasks.ts:100-108](../../apps/builder/server/routes/tasks.ts#L100-L108)); since D3 means Ask never sets any
of those, that check would never fire, and the flag would leak **permanently** — silently blocking every
FUTURE phase turn for that task, since a stale `isCancelled(taskId)===true` makes `runPhase` bail before
ever spawning.) The force-kill alone is sufficient to unblock `askWithin`'s pending `runTurn` promise:
`ClaudeSession.forceKill()` ([claude-session.ts:246-258](../../apps/builder/server/lib/claude-session.ts#L246-L258))
already calls `fireExit()`
([claude-session.ts:227-231](../../apps/builder/server/lib/claude-session.ts#L227-L231)), which resolves a
turn killed from outside `runTurn` — the exact mechanism `/cancel` already depends on for a phase turn. So
`askWithin` simply treats a killed turn like any other settle: it still runs the layer-2 byte-compare/restore
(a cancelled turn may have written before the kill landed), then emits `ask:done {ok: false}` — it never
converges `task.status`/`task.gate` to `cancelled`. This is the "any bail inside askTurn on a cancel signal
must re-park, not converge to cancelled" requirement.

**Pre-spawn cancel window (review round-2 fix).** `forceKill` only reaches the child once
`askTurn`'s `setSession` has run — but `askWithin`'s layer-2 `snapshotRoots` (a recursive walk of both
writable roots) runs BEFORE that. A Stop pressed during that walk finds `liveSession(id) === null` and, as
written, `/cancel` would return `200` (as if it stopped something) while the Ask runs to completion holding
the global turn lock for the full budget. Fix: `TurnHolder` gains a `cancelRequested` flag (on the holder,
NOT the shared `cancelledTasks` Set — which would leak, D9); `/cancel`'s ask-branch sets it via
`requestAskCancel(id)` when there is no live child yet, and `askWithin` checks `isAskCancelRequested` right
after its snapshot and bails before spawning. The window this closes is exactly `[lock acquired →
setSession]`; a cancel after `setSession` still force-kills the child as above. The flag dies with the turn
on `releaseTurn`, so it never leaks across turns.

**Mandatory fix, part of S1, not optional (closes the PUT /spec turn-lock gap):** `PUT /api/tasks/:id/spec`
([ui.ts:118-144](../../apps/builder/server/routes/ui.ts#L118-L144), the manual "Save SPEC.md" button) has
**no turn-lock check today** — unlike `/reply`/`/confirm` (`acquireTurn`) or `PATCH /api/tasks/:id` (which
already checks `turnHolderId() === id` → 409 at
[tasks.ts:280-284](../../apps/builder/server/routes/tasks.ts#L280-L284)). This is a genuine **pre-existing**
race (a manual Save landing while any turn runs for that task risks silent last-writer-wins data loss) that
predates this feature — but it directly undermines layer 2's soundness: if a legitimate manual Save happens
to land inside the Ask's snapshot window, the byte-compare would misattribute that diff to the Ask turn and
**wrongly restore-over the user's real, intentional edit**, silently discarding it. Fix: add the identical
`turnHolderId() === id` → 409 check to `PUT /api/tasks/:id/spec`, mirroring
[tasks.ts:280-284](../../apps/builder/server/routes/tasks.ts#L280-L284). This closes the pre-existing race
AND makes layer 2's byte-compare sound by construction — no other writer can touch the artifact during the
Ask's snapshot window once this lands.

### §2 · SSE wiring (backend → frontend)

The relay is already event-name-agnostic (`ctx.broadcast?.(taskId, event, data)`, used today for
`phase:output`/`task:update` — [sse.ts:87-98](../../apps/builder/server/plugins/sse.ts#L87-L98)); no change
to the relay itself, only two new event names + one buffering tweak:
- `ask:answer` — `{text}` fragments, high-volume like `phase:output` → **excluded from the replay ring
  buffer** the same way (`sse.ts:92`'s `if (event !== 'phase:output')` gains `&& event !== 'ask:answer'`).
- `ask:done` — the terminal marker, `{ok: boolean, anomaly?: {diff: string}}` — lightweight, like
  `task:update`, so it stays **buffered/replayable** (no exclusion needed).

`sse-client.ts` gains two `addEventListener` registrations mirroring `phase:output`
([sse-client.ts:75-78](../../apps/builder/web/src/sse-client.ts#L75-L78)), gated by the same
`waitingForInit` stale-suppression guard, plus two new `SSEHandlers` callbacks (`onAskAnswer`, `onAskDone`).

**No `task:update` on the normal (unchanged-bytes) path (FIX-B).** `applyTask`'s gate-refresh-in-place branch
only fires when the trailing thread item IS the unresolved same-phase gate
([store.ts:243-244](../../apps/builder/web/src/store.ts#L243-L244)); after an Ask, the trailing item is the
new `qa` item, so any `task:update` here would push a **duplicate** gate card. Since status/gate are
genuinely unchanged on the normal path, the backend must not broadcast one at all — the `qa` thread item +
`ask:done` are sufficient.

**A new, parallel streaming-accumulation path for qa items (FIX-C).** `store.ts`'s existing
`applyOutput`/`flushPendingOutput` coalescer ([store.ts:290-344](../../apps/builder/web/src/store.ts#L290-L344))
is keyed by **phase** and only lands text on `{kind:'run'}` items — a new `{kind:'qa'}` item has no such
target. Add a parallel rAF-coalesced buffer targeting the qa item **by its own id**, not by phase: because
the app-wide turn lock (§1) guarantees at most one turn — phase or Ask — runs anywhere at a time, there is
never more than one qa item "in flight," so a single tracked `_currentAskItemId` suffices (no per-phase Map
needed, unlike `applyOutput`).

**Client-side flow (`store.ts` new `ask(text)` action, mirroring `reply()`
[store.ts:499-512](../../apps/builder/web/src/store.ts#L499-L512)):** push a user thread item + a fresh
`{kind:'qa', question, answer:''}` item locally (optimistic, `_currentAskItemId` = its id), set `asking.value
= true`, `POST /ask`. `ask:answer` fragments append onto the item at `_currentAskItemId`. `ask:done` sets
`asking.value = false`; on `ok:false` with an `anomaly`, calls `store.askConfirm({...})` (the existing
pattern, reused verbatim) to show the single-OK notice with the diff; the qa item's answer is finalized
either way.

### §3 · Frontend — composer mode, docked bar, `asking` signal, i18n

**New `asking` signal (FIX-H).** `store.ts`'s `busy` computed
([store.ts:119-121](../../apps/builder/web/src/store.ts#L119-L121)) is derived solely from
`status==='running'|'scaffolding'`; D3 means an Ask never sets those, so `busy` stays `false` throughout an
Ask — yet D7 requires the docked bar disabled during a live Ask. Add an independent `asking` signal (boolean),
driven by the `ask()` action / `ask:done` marker (§2). The docked bar (and the composer's send-readiness while
an Ask is in flight) uses `disabled={busy || asking}`, not `disabled={busy}` alone.

**Composer mode: `'ask' | 'change'` (owned in `App.tsx`, alongside `draft`/`files` state).** The gate's
"Edit spec"/"Request changes" action (`kind:'reply'`, e.g. `gate.ts:71,80,90,103,143`) sets `mode='change'`
+ focuses the composer; a small chip shows the active mode; an easy toggle returns to `'ask'`.

**Change-mode carries the reply-action's label through (FIX-G).** Today `GateCard` calls
`onReply(text, replyAction.label)` so the resolved gate reads the TRUE action ("Edit spec"/"Keep trying",
spec 016 D4) — [Chat.tsx:290](../../apps/builder/web/src/components/Chat.tsx#L290), threaded through
`App.tsx`'s `onReply` at [App.tsx:302](../../apps/builder/web/src/components/App.tsx#L302). The new
change-mode must carry that SAME label through to the `/reply` call it eventually issues (remember
`replyAction.label` when arming change-mode from the gate's action click), so the resolved-gate copy stays
accurate. **The inline `GateCard` reply textarea is removed** (`Chat.tsx`'s `replying`/`setReplying` state
and the block at [Chat.tsx:282-294](../../apps/builder/web/src/components/Chat.tsx#L282-L294)) — the
composer's change-mode is the ONE reply surface, not a second, parallel one.

**Explicit routing predicate in `send()` (FIX-F, closes the Retry-out-of-error contradiction).** Today
`App.tsx`'s `send()` ([App.tsx:125-140](../../apps/builder/web/src/components/App.tsx#L125-L140)) routes
BOTH `awaiting_confirm` and `error` to `/reply` — `error` is the Retry-out-of-error path, and `/reply`'s
route explicitly accepts `status==='error'`
([tasks.ts:314](../../apps/builder/server/routes/tasks.ts#L314)). D2 flips the *default* to Ask, but `/ask`
only accepts `awaiting_confirm` (§1) — so the predicate must branch explicitly, not just flip the default:
```
done | cancelled | empty-view        → store.start()                 // [superseded for done|cancelled by 034 D3]
error                                → store.reply()                 // Retry, byte-unchanged
awaiting_confirm, phase==='test'     → store.reply()                 // D4 unaffected — [superseded by 034 D5]
awaiting_confirm, phase≠test,
  mode==='change'                    → store.reply(text, label)      // Request-changes
awaiting_confirm, phase≠test,
  mode==='ask' (default)             → store.ask(text)               // NEW
```
**Reader note (added post-034):** the two rows flagged above are accurate only as of THIS spec's own scope —
033 shipped before ④/`done`/`cancelled` Ask existed. Spec 034 (D3, D5) supersedes both: `done`/`cancelled` route
to Ask instead of `store.start()`, and `phase==='test'` gets the same `mode==='ask'|'change'` split as any other
phase instead of an unconditional `/reply`. If 034 has landed, treat this table as historical for those two
rows, not current behavior.

**Composer mode lifetime (FIX-I — undefined reset points let it leak otherwise).** Arming change-mode via
"Edit spec" then instead clicking a DIFFERENT confirm action (advancing the phase) would leave `mode` stuck
at `'change'`, so the next plain Send at the NEW gate would silently re-run the phase instead of defaulting
to Ask — recreating exactly the mode-confusion D2 exists to prevent. Reset `mode` to `'ask'`: after any
successful send (ask or reply), on every `task.phase` change (a `useEffect` keyed on
`task?.taskId`/`task?.phase`), on `openTask`, and inside `newTask()`/`store.resetToNew()` — mirroring the
existing reset discipline for `workflow`/`seed`/`fast`/`targetProject` at
[store.ts:641-650](../../apps/builder/web/src/store.ts#L641-L650) (since `mode` lives in `App.tsx`, not the
store, `newTask()` — which already calls `store.resetToNew()` and `setArtifactOpen(false)` at
[App.tsx:178-186](../../apps/builder/web/src/components/App.tsx#L178-L186) — must also `setMode('ask')`).

**Docked bar, scoped extraction (FIX-J).** `GateCard`'s action-foot is polymorphic across statuses — the
cancelled→Restore branch, the error→Retry-reply branch, and the awaiting_confirm confirm/reply/cancel
branch (with its `cleanup_apps` count / `awaiting_import` icon-swap logic,
[Chat.tsx:276-324](../../apps/builder/web/src/components/Chat.tsx#L276-L324)). Extract **only** the
awaiting_confirm action-render into a shared renderer (e.g. `GateActions`) usable both inline (rendered by
`GateCard` when `phase==='test'`, unchanged from today per D4/D7's scoping) and in a new docked bar rendered
by `App.tsx` just above `composer-dock` (active when `status==='awaiting_confirm' &&
phase∈{analyze,spec,implement}` — the trailing gate's OWN inline action-foot is suppressed in that case, a
resolved historical gate still shows its resolved label inline as today). error-Retry and cancelled-Restore
**stay** rendered inline in `GateCard`, never docked.

**The restore-anomaly notice** reuses `ConfirmModal`/`store.askConfirm()` verbatim (D3 layer 2) — no new
dialog component.

**New i18n keys (FIX-L, `tr()`/`tf()`/`tAction()` convention, [i18n.ts](../../apps/builder/web/src/lib/i18n.ts)):**
- mode-chip labels: `modeAsk` ("Ask"), `modeChange` ("Request changes") + a toggle-back-to-ask control title
  (`modeBackToAsk` — e.g. "Back to Ask").
- per-mode composer placeholders — the current parked placeholder `phReplyOrDescribe`
  ("Reply, or describe another change…", [i18n.ts:75](../../apps/builder/web/src/lib/i18n.ts#L75)) actively
  misleads once Ask is the default (it no longer re-runs anything). Split into `phAskGate` (Ask-mode default,
  e.g. "Ask a question…") and `phChangeMode` (change-mode, reusing `phWhatShouldChange`'s existing wording
  pattern, [i18n.ts:153](../../apps/builder/web/src/lib/i18n.ts#L153)).
- a qa-bubble chrome label (e.g. `qaAnswered` for a small "Answered" badge/tag on a settled qa item).
- the restore-anomaly `ConfirmModal`'s strings: `askAnomalyTitle`, `askAnomalyMsg` (interpolates the diff via
  `tf`), and a single `askAnomalyOk` string passed as BOTH `okLabel` and `cancelLabel` (both buttons dismiss
  identically — D3 layer 2 — so there is deliberately no separate "cancel" wording).
- JA counterparts for every key above, following the existing EN/JA dual-dict pattern
  ([i18n.ts:49](../../apps/builder/web/src/lib/i18n.ts#L49) EN, mirrored JA block further down).

### §4 · Security (spec 015 — the real trust boundary, corrected framing, FIX-K)

The original §3 dismissed injection risk because "the injected text is the user's own message" — too
narrow. D5 resumes a session that may **already** carry untrusted content from earlier in the SAME phase: a
pulled Dify-seed's YAML via `difySeedScaffoldAndPull`
([orchestrator.ts:61](../../apps/builder/server/lib/orchestrator.ts#L61)), an edited-existing workflow's own
contents via `localEditSeed` ([orchestrator.ts:74](../../apps/builder/server/lib/orchestrator.ts#L74)), and
user-supplied image/PDF attachments folded into every prompt via `attachmentBlock`
([orchestrator.ts:321,328](../../apps/builder/server/lib/orchestrator.ts#L321-L328)) — not just the live
question text. This is the real trust boundary: an Ask turn's resumed context can contain attacker-influenced
data regardless of who typed the visible question. Layer 1's unconditional write-deny neutralizes the
mutation vector **regardless of where an injected instruction originates** — a denied `Write` can't be
reached by injection either, so this boundary doesn't need a separate mitigation beyond D3.

---

## Goals
1. Ask a question at a gate → a **message↔message** answer, **no phase re-run**, **no artifact rewrite**,
   gate stays parked — enforced structurally (hook-deny + byte-restore), not by trusting model compliance.
2. Request-changes stays EXACTLY as today (re-run phase, update artifact, re-gate) — just behind an explicit
   mode.
3. The two are **explicitly** chosen by the user (no intent guessing).

## Non-goals
- **No** auto intent-classification (D1).
- **No** backend chat transcript (D6) — thread stays client-side.
- **No** change to the gate FSM / phase outcomes / `computeGate`.
- **No** Ask at ④ Test, and no Ask after a terminal `done` build, in v1 (D4) — **tracked separately, see spec
  034**: Ask/Q&A at the ④ Test gate and after a terminal `done` build requires a fundamentally different,
  fresh-seeded (non-resume) mechanism since `sessionIds` never has a `'test'` key
  ([task.ts:127](../../apps/builder/server/state/task.ts#L127)).
- **No** multi-turn agentic tool use in an Ask — it is read-only **by construction** (layer 1's unconditional
  write-deny), not merely "expected" to answer from context.
- **No** live mid-tool-call human-approval channel (the claude-nexus `PermissionQueue` port) — considered,
  explicitly deferred (D3's rejected-alternative note).

---

## Acceptance criteria
1. At a clean Analyze/Spec/Implement gate, a plain composer Send **Asks**: streams an answer as
   message↔message, the gate stays parked (`awaiting_confirm`, same actions), and the gate artifact
   (SPEC.md/main.yml) is byte-identical afterward — enforced by layer 1 (hook-deny) + layer 2 (byte-restore
   backstop), not by trusting the model's compliance with the wrapper instruction.
1b. **Hardened unit test (replaces the old, weaker "a dirtied file was reverted" test):** inject a FAKE
    `runTurn` that DELIBERATELY attempts a file write despite `BUILDER_ASK_MODE` (simulating a hook bypass —
    i.e. layer 1 is assumed defeated) and assert the backend restores **byte-IDENTICAL** content to the
    pre-Ask snapshot afterward.
1c. **FIX-M coverage (a DIFFERENT test than 1b, not a restatement):** inject a FAKE `runTurn` that writes to
    or creates a file OTHER than the phase's own gate artifact, still within the two allowed roots
    (`projects/<project>/<workflowSlug>/` or `apps/builder/.runs/<taskId>/`), and assert that file is ALSO
    detected and restored/removed. A test scoped only to the known artifact (1b) would still pass even if
    layer 2's broadened scope were silently dropped in a future refactor — 1c is what actually proves FIX-M.
2. The gate's **"Request changes"** puts the composer in change mode; Send there re-runs the phase (current
   behavior) — byte-unchanged from today.
3. An Ask never alters `task.gate`/`task.status`/`phase`; the FSM, `/confirm`, `/reply`, golden-build +
   advance-loop tests stay green.
3b. **Pinned actions (D7, scoped to phase∈{analyze,spec,implement} per FIX-J):** after ANY number of Asks at
    a parked gate, the Implement/Edit/Discard actions remain visible + clickable (docked); a live Ask
    disables them via the new `asking` signal (FIX-H), re-enabled when it settles.
4. Security: the Ask turn's env carries `BUILDER_ASK_MODE=1` (in addition to no `DIFY_*`); the permission-gate
   hook denies every `Write`/`Edit`/`MultiEdit`/`NotebookEdit` outright for that turn; the layer-2 backstop
   restores byte-identical content + surfaces an anomaly notice if layer 1 is ever bypassed.
5. **A live Ask has its own scoped abort** (D9/FIX-E): force-killing the Ask child does not clobber the
   parked gate — `task.status`/`task.gate` are left exactly as they were (this is NOT "reuses `/cancel` like
   any turn" — `/cancel` now branches on `liveKind(id)`).
6. ④ Test gate behaves exactly as today: Ask is absent, the composer Send keeps its current meaning, and the
   docked bar (D7) does not relocate ④'s actions (FIX-J).
7. **NEW (FIX-F):** a dock Send at an errored phase still re-runs the phase (Retry) — byte-unchanged from
   today, never routed to `/ask`.
8. **NEW (FIX-G):** the resolved gate after a composer-driven Request-changes still shows the SPECIFIC
   action's label (e.g. "Edit spec"/"Keep trying"), never a generic "Requested changes".
9. **NEW:** a manual SPEC.md Save via the ArtifactPanel (`PUT /api/tasks/:id/spec`) is rejected with 409
   while ANY turn — including an Ask — is running for that task.

## Sequencing (each step compiles + tests green; additive, static/reply paths byte-unchanged)
- **S1 · Backend — the two-layer mechanism + `/ask`.** `BUILDER_ASK_MODE` env (claude-session.ts) + the new
  `decide()` deny-branch (permission-gate.ts); the byte-snapshot/restore in the new `server/lib/ask.ts`
  (`askWithin`/`askTurn`, duplicated spawn shape, NOT `runDataTurn`, NOT wired into
  runPhase/gateAfterPhase/PHASES) — layer 2 now a recursive snapshot/diff/restore over BOTH writable roots
  (FIX-M), not a single-file compare; the `PUT /api/tasks/:id/spec` turn-lock fix (mandatory, part of this
  step) PLUS the FIX-M audit for any other route writing into either root outside the turn lock, each
  getting the same `turnHolderId() === id` → 409 guard; the Ask-scoped abort (`kind` tag on `TurnHolder`,
  `liveKind()`, the `/cancel` branch + the pre-spawn `cancelRequested` flag). Unit tests: (a) the AC#1b
  hardened restore test (fake write to the gate artifact despite `BUILDER_ASK_MODE` → byte-identical restore);
  (a2) the AC#1c FIX-M test (fake write to a DIFFERENT in-scope file → also detected and restored); (b) the
  resume-failure path never falls through to a write-intent fresh turn; (c) `PUT /spec` 409s while
  `turnHolderId() === id`; (d) `/cancel` during a live Ask leaves `status`/`gate` untouched. **Round-2 review
  additions:** (e) **layer 1 directly** — `decide({Write|Edit|MultiEdit|NotebookEdit}, taskId, askMode=true)`
  denies, `askMode=false` allows the same in-project write, and a LIVE-BINARY test proving `main()` reads
  `BUILDER_ASK_MODE=1` from the env (previously layer 1 — the PRIMARY defense, AC#4 — had no direct test; the
  1b/1c fakes bypass the hook); (f) a `/cancel` in the pre-spawn snapshot window aborts before spawning
  (`requestAskCancel` → `askWithin` bails); (g) a failing per-file restore (EISDIR) is isolated + flagged
  `restoreFailed` while a sibling file still restores (review #4); (h) `/reply` 409s while an Ask holds the
  lock (the 2nd FIX-M audit site); (i) `askWithin` never throws past its snapshot (an internal error becomes a
  benign `ask:done{ok:false}`, gate untouched — never `failSafe`→`error`).
- **S2 · SSE `ask:answer` + `ask:done`.** The two new events (data shapes in §2), the replay-buffer exclusion
  for `ask:answer` (sse.ts), `sse-client.ts` listeners + `SSEHandlers` callbacks.
- **S3 · FE — `asking` signal, qa-stream accumulation, composer mode.** The `asking` signal (FIX-H); the
  parallel qa-item streaming accumulator keyed by item id (FIX-C); composer `mode: 'ask'|'change'` +
  its lifetime/reset points (FIX-I) + the explicit routing predicate (FIX-F); the change-mode label
  carry-through (FIX-G); the docked-bar scoped extraction (FIX-J) with the inline `GateCard` reply textarea
  REMOVED; the `ConfirmModal` reuse for the restore-anomaly notice; the new i18n keys (FIX-L). store.ts
  thread-building + vitest.
- **S4 · Docs.** AGENTS.md (gate Ask vs Request-changes), a line in the builder README.

## Biggest risks (+ mitigations)
1. **Layer 1 (hook-deny) has a bug, or is bypassed** (a future refactor of `decide()` drops the branch, a
   new write-capable tool is added without updating `WRITE_TOOLS`, etc.). → mitigated by layer 2 (the
   byte-snapshot/restore backstop): the two layers are deliberately **each other's** mitigation — a failure
   of one is caught by the other, not by "the model behaving." This claim only holds for the WHOLE surface a
   bypassed layer 1 would actually expose (identical to a normal phase turn's write-allow set,
   `pathIsProtectedWrite`) — which is why layer 2's snapshot was widened (FIX-M) from one file to both
   writable roots; a single-file backstop would only have made the claim true for that one path. This is the
   core risk this revision exists to close (replacing the original, single-layer "backend revert" claim the
   adversarial review found unenforceable — D3).
2. **Mode confusion** (user thinks they're editing but is chatting, or vice-versa). → an always-visible mode
   chip + distinct thread rendering (qa bubbles vs phase-output), now backstopped by FIX-H (the `asking`
   signal so the docked bar visibly reflects a live Ask), FIX-I (mode can't silently leak across a gate/phase
   transition), and FIX-L (the per-mode placeholder no longer says "Reply" when the default is Ask).
3. **Session pollution** (Q&A muddying a later change turn, D5). → **OQ1 is now closed** (shared session);
   the cost is bounded because `confirmAdvance` always runs the next phase as a fresh, non-resumed turn
   ([orchestrator.ts:9](../../apps/builder/server/lib/orchestrator.ts#L9)), so an Ask's added context never
   compounds past the phase it happened in. Revisit only if real use shows a shared session degrading a
   same-phase Request-changes turn's edit quality.

## Open questions
- None outstanding for v1. (OQ1 — shared vs separate Ask session — is closed, see D5. OQ2 — Ask at ④ Test /
  after a terminal build — is split out to spec 034, not this spec's concern.) The live-approval-channel
  alternative (D3) is a closed-off tangent, not an open question: it was evaluated and explicitly deferred,
  not left undecided.

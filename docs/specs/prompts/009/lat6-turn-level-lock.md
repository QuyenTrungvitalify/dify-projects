# Implementation Prompt — Spec 009, Lát 6 (Phase 3): TURN-LEVEL LOCK + multi-build UI

> Copy-paste vào fresh session. Builds on the merged Lát 0–5 app. ~1 day.

---

You are implementing **turn-level locking** for the Spec 009 Dify Workflow Builder. Today the run-lock
is **build-level**: a build holds it from `POST /api/tasks` until `done|error|cancelled`, so a build
**paused at a gate** (`awaiting_confirm`, no `claude` turn actually running) still occupies the single
slot and a new build → 409 "Busy". This change makes the lock **turn-level**: it is held only while a
`claude` turn (or a backend write-unit) is actually running, and **released when the build parks at a
gate**. Result: **unlimited in-progress workflows parked at gates**, with turn *execution* still
serialized 1-at-a-time (so confinement + shared auth stay safe).

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects` (the app lives in `apps/builder/`).
- **READ FIRST** (the current build-level implementation you are refactoring):
  - `apps/builder/server/lib/lock.ts` — the run-lock (`holder`, `acquire`/`release`/`holderTaskId`/
    `setSession`/`clearSession`/`liveSession`/`markCancelled`/`isCancelled`/`reconcileOnBoot`).
  - `apps/builder/server/lib/orchestrator.ts` — `startTask` / `confirmAdvance` / `replyWithin` /
    `runPhaseAndGate` / `runPhase` (the pre-spawn guard `if (isCancelled || holderTaskId() !== taskId)`) /
    `gateAfterPhase` / `maybeAutoAdvance` / `runTestAndFinish` / `difySeedScaffoldAndPull` / `scaffoldAtSpecGate`.
  - `apps/builder/server/routes/tasks.ts` — the `dispatch()` fire-and-forget, the `advancing` Set guard,
    the holder-assertion in `/confirm`+`/reply`, the fast-path `holderTaskId()` 409 in `POST /api/tasks`.
  - `apps/builder/server/state/task.ts` — `Status`, `mintTaskId`.
  - `apps/builder/web/src/store.ts` + `components/App.tsx` + `Sidebar.tsx` — the single-active-task UI.
  - **Spec §I "Run-lock granularity" + Open-question Q6** in `docs/specs/009-browser-workflow-builder.md`
    — they explicitly call this out: *"a turn-level mutex (allowing multiple builds to sit at gates) is a
    Phase-3 option."* This IS that Phase-3 item.

## Why this matters (the design)

**Lock = "a turn is running", not "a build exists".** The lock is held for one **write-unit** — spawn a
turn → run it → **post-turn verify** (which reads `git status`) → set gate/status — then released when the
build parks or terminates. Because at most ONE write-unit runs at a time, the global `#3b` confinement
check (`git status` baseline-delta in `post-turn.ts`) stays valid **unchanged** (only one build writes at
a time). That 1-writer invariant is the whole reason this is cheap + safe — do NOT break it (do NOT allow
two turns to run concurrently; that would need per-build confinement scoping, which is out of scope here).

Timeline (two builds A, B):
```
POST /api/tasks(A) → acquireTurn(A) → A ① turn [lock=A] → verify+gate → releaseTurn → A parks  [free]
POST /api/tasks(B) → acquireTurn(B) → B ① turn [lock=B] → verify+gate → releaseTurn → B parks  [free]
   ↑ now BOTH A and B are parked at gates, lock free, a 3rd build could start
/confirm(A→②)      → acquireTurn(A) → A ② turn [lock=A]
/confirm(B→②)      → turnHolder=A  → 409 "a turn is running" (or queue)   ← the ONLY time "Busy" appears
A ② ends           → releaseTurn → A parks
/confirm(B retry)  → acquireTurn(B) → B ② turn ...
```

## Pre-flight
```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                                   # note baseline
(cd apps/builder && npx tsc --noEmit)        # backend compiles before you start
ls apps/builder/.runs/*/task.json 2>/dev/null | head   # existing build states (parked ones hold the lock today)
```

## Mission

Refactor the build-level lock into a turn-level lock, update the orchestrator's acquire/release points,
the routes' 409 semantics, the boot-reconcile, and the frontend so it can show + reach **multiple**
in-progress builds. Turn execution stays strictly serialized (1 at a time). No change to the phase state
machine, the gate variants, the verify, or `#3b` confinement.

## Tasks

### 1. `lock.ts` — turn-holder instead of build-holder
- Rename the concept: `holder` → **`turnHolder: { taskId, session } | null`** = the build whose turn is
  *currently executing*. Replace `acquire`/`release`/`holderTaskId` with **`acquireTurn(taskId)`** (false
  if `turnHolder` is set for a *different* task — caller maps to 409/queue), **`releaseTurn(taskId)`**
  (clear iff it matches), **`turnHolderId()`** (the running task id or null), **`turnBusy()`** (`turnHolder
  !== null`). Keep `setSession`/`clearSession`/`liveSession` keyed on `turnHolder`. Keep `markCancelled`/
  `isCancelled` EXACTLY as-is (the cancelledTasks Set must still survive a release — the orchestrator
  checks `isCancelled` after each await).
- **`reconcileOnBoot` SIMPLIFIES:** `turnHolder` is in-memory only → starts `null` on boot. Scan
  `.runs/*/task.json`: `running`/`scaffolding` → `error` ("interrupted by backend restart"); **`awaiting_confirm`
  → LEAVE as-is (do NOT re-acquire any lock — gates no longer hold the lock)**. Drop the old
  "only one awaiting_confirm survives + re-acquire" tie-breaker entirely (multiple parked builds are now legal).

### 2. `orchestrator.ts` — acquire/release around each write-unit
The lock is held from BEFORE the spawn THROUGH the post-turn verify+gate, then released. Place it at the
three entry points (so a collision is rejected synchronously before any work):
- **`startTask`**: `if (!acquireTurn(task.taskId)) throw httpError(409, 'a turn is running')` → run ① →
  gate → **`releaseTurn` in a `finally`** (so a throw/cancel still frees it).
- **`confirmAdvance`**: `acquireTurn` (409 if busy) → [scaffold if ②→③ — it writes files, must be under the
  lock] → `runPhase(next)` OR `runTestAndFinish` (④ backend) → gate/done → `releaseTurn` (finally).
- **`replyWithin`**: `acquireTurn` (409 if busy) → `runPhase(current, --resume)` → gate → `releaseTurn`.
- **Release timing:** AFTER `gateAfterPhase`/terminal (the verify reads `git status` — it must be inside
  the lock). A build parking at `awaiting_confirm` releases the lock; a build going `error`/`done`/`cancelled`
  releases it. There is no "held while parked" anymore.
- **Update the runPhase pre-spawn guard** (the Lát-4 cancel/auto-advance fix): change
  `holderTaskId() !== task.taskId` → **`turnHolderId() !== task.taskId`** (still: never spawn a turn for a
  build that doesn't currently hold the TURN lock; `isCancelled` check stays). `maybeAutoAdvance`'s recursive
  `confirmAdvance` must re-`acquireTurn` for each phase it advances (it already holds it across one phase;
  on auto-advance to the next phase it keeps/re-takes the lock — keep it held across an auto-run chain, OR
  release+reacquire per phase; either is fine as long as no OTHER build can interleave a turn).
- **Cancel semantics:** unchanged in spirit — `markCancelled` + (if this build is the `turnHolder`)
  `liveSession()?.forceKill()`. A **parked** build being cancelled has no live turn → just set `cancelled`
  (no lock to release). Keep the `isCancelled` re-checks in `runPhase` (before spawn, after verify).

### 3. `routes/tasks.ts` — 409 "a turn is running" + drop the redundant guard
- `POST /api/tasks` fast-path: replace `if (holderTaskId())` with `if (turnBusy())` → 409
  `{error:'a turn is already running — try again in a moment', holder: turnHolderId()}`. (The acquire still
  happens inside `startTask`; keep the race-safe pattern.)
- `/confirm` + `/reply`: the **holder-assertion** (`holderTaskId() !== id`) is GONE (a parked gate no longer
  holds the lock, so "is this gate the holder" is meaningless). Instead, the dispatched `confirmAdvance`/
  `replyWithin` will `acquireTurn` and 409 if busy. The `advancing` Set guard can be **removed** —
  `acquireTurn` (synchronous, in the entry point) now closes the double-dispatch race directly (two
  concurrent /confirm both `acquireTurn` → the loser gets 409). Verify this replacement is sound before
  deleting `advancing`.
- The error-retry path in `/reply` (`acquire` on `status==='error'`) → use `acquireTurn`; release on the
  non-500 catch path stays (no leak).

### 4. Frontend — show + reach MULTIPLE in-progress builds (`store.ts`, `App.tsx`, `Sidebar.tsx`)
This is what makes the feature usable (today the UI tracks one active task and "loses" parked ones):
- **Load-recovery:** add a backend **`GET /api/active`** (returns the array of non-terminal tasks —
  `running`/`scaffolding`/`awaiting_confirm` — read from `.runs/`, newest first). On store init, fetch it;
  render the parked builds in the sidebar so they are never stranded. (Extends AC #22 to the no-taskId case.)
- **Sidebar lists every non-terminal build** (not just the active one) with its phase/status; clicking one
  `openTask(id)` (reconnects its SSE + gate). The active conversation is whichever you opened.
- **Actionable busy:** the 409 `{holder}` → toast "a build's turn is running ([Open it]) — your build is
  queued/try again", with `[Open it]` = `openTask(holder)`.
- **"New task" + dead-end composer** (the working-tree fix may already route terminal→start): keep
  `send()` so empty/terminal → `store.start` (new build), `awaiting_confirm`/`error` → `store.reply`. A
  build parked at a gate is reachable via the sidebar, so "New task" no longer strands it.
- **Optional (queue):** if you implement a FIFO turn-queue instead of a 409, the UI shows "queued — waiting
  for the running turn"; otherwise a 409 with a one-tap retry is acceptable for v1.

### 5. Build + manual verify
```bash
(cd apps/builder && npm run build) && (cd apps/builder/web && npm run build)   # both clean
```
Then boot (`cd apps/builder && npm start`) and walk the acceptance below in the UI / via curl.

## Acceptance

- [ ] **Two builds parked at once:** start build A → at its first gate (`awaiting_confirm`), start build B →
  B **starts** (no 409) and reaches its own gate. Both are in `.runs/` as `awaiting_confirm`; both appear in
  the sidebar. (The old "Busy" is gone for parked builds.)
- [ ] **Turn collision (the only Busy):** while build A's turn is actively running, `/confirm` or `POST
  /api/tasks` for B → **409 "a turn is running"** (or queued); when A's turn ends, B proceeds.
- [ ] **Confinement still safe (1-writer invariant):** a seeded out-of-confinement write during a turn is
  still caught + reverted by `#3b` (unchanged) — and two builds never run turns concurrently (assert
  `turnHolder` is single).
- [ ] **Gate holds NO lock:** a build sitting at `awaiting_confirm` for minutes does not block any other
  build from running its turns.
- [ ] **Cancel:** cancelling a *parked* build just sets `cancelled` (no live turn); cancelling a build whose
  turn is *running* kills it; neither leaks the turn-lock; a new build can run immediately after.
- [ ] **Boot reconcile:** restart with one `running` (→ `error`) and two `awaiting_confirm` builds → BOTH
  parked builds survive (no re-acquire, no tie-break) and are reachable in the sidebar; `turnHolder` starts null.
- [ ] **Load-recovery:** reload the SPA → parked builds are listed (via `/api/active`), not stranded.
- [ ] Backend `tsc` + web `vite build` clean; the existing Lát 3–5 acceptance (gate variants, /reply,
  selfhost, #3b) still pass.

## On blocker
- **Two turns somehow run concurrently** → STOP; that breaks the `#3b` confinement invariant. The whole
  design rests on `turnHolder` being a single slot. Re-check the acquire is synchronous in the entry points.
- **A turn-lock leaks** (turnHolder never cleared) → ensure `releaseTurn` is in a `finally` around the whole
  phase work in all three entry points, and the dispatch `.catch→failSafe` also releases.
- **The old `advancing` guard removal re-introduces the double-dispatch race** → only remove it after
  confirming `acquireTurn` (synchronous) rejects the second concurrent /confirm.

## Guardrails
- **Do NOT touch** the phase state machine, gate computation (`gate.ts`), post-turn verify (`post-turn.ts`),
  or the model-C spawn — only the LOCK granularity + where it's held + the multi-build UI.
- **1 turn at a time stays invariant** — this is a *parked-builds* unlock, not a concurrent-turns feature
  (concurrent turns = a separate, harder change needing per-build confinement scoping).
- **Spec-update (no silent drift):** update spec §I "Run-lock granularity" + Q6 to record that the lock is
  now turn-level (gates don't hold it; multiple builds may park), and AC #21 to "a 2nd build whose *turn*
  collides with a running turn gets 409" (parked builds no longer 409). Add a ledger note in
  `docs/specs/009-implementation-plan.md`.
- Localhost only, 127.0.0.1 hardcoded; commit locally only after acceptance passes; do NOT push; do NOT
  `--no-verify`. End the commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

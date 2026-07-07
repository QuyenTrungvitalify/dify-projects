# Spec 040 — UAT hardening: confinement false-positive + composer/reload/sidebar fixes

**Status**: **Implemented** (2026-07-07, same day as authored) — **D1–D4** landed with tests; **E1–E4
deferred** (companion, opt-in). Backend + web, **surgical**: no new deps, no Dify-contact change, no
gate-FSM change, no permission-hook *logic* change. The load-bearing fix (D1) is a **narrowing** of an
over-broad revert — it removes destructive behavior, adds none. Verified green: backend typecheck +
`confinement.test.ts`/`permission-gate.test.ts` (43) + `post-turn-multi-lint` (12); web typecheck +
vitest 151 (incl. new `store.uat040.test.ts` ×6) + build.

Files touched: `server/lib/post-turn.ts` (D1) · `test/confinement.test.ts` + `test/permission-gate.test.ts`
(D1 tests) · `web/src/store.ts` (D2/D3/D4) · `web/src/components/App.tsx` (D2) · `web/src/store.uat040.test.ts`
(new).

> **Reference the SYMBOL, not the line.** Line links verified 2026-07-07; re-grep before editing.
> **`store.ts` lives at [`apps/builder/web/src/store.ts`](../../apps/builder/web/src/store.ts)** (not `lib/`).

**Self-review pass (2026-07-07, before implementation).** Four mechanism errors in the first draft were
caught by reading the code and corrected below; each is called out inline as ⚠️ **Review fix** so the
implementer knows *why* the obvious-looking approach is wrong:
- **D2** — `start`/`reply`/`ask` **catch internally and resolve** ([store.ts:666-668,698-700,725-736](../../apps/builder/web/src/store.ts#L666)); a `.catch()` would never fire. → return a boolean instead.
- **D1** — narrowing the revert **changes an existing security test** ([confinement.test.ts:72-73,84](../../apps/builder/test/confinement.test.ts#L72)); that is intentional and compensated by a hook test, documented in D1.
- **D3** — `openTask`'s catch calls `surfaceError` ([store.ts:896-898](../../apps/builder/web/src/store.ts#L896)) → a stale/deleted `lastTask` would flash an error banner; the boot restore must swallow the 404.
- **D4** — the sidebar reads the **`active`** signal (`WireTreeTask[]`, [store.ts:60](../../apps/builder/web/src/store.ts#L60)), not `tree`; and a `done`/`cancelled` build must LEAVE that list, so an in-place status patch is insufficient — refresh via `loadActive()`.

**Provenance**: the browser-agent UAT suite [`docs/specs/prompts/uat/`](prompts/uat/) (J1–J5, run
2026-07-07). Each decision below cites the finding it closes and the code evidence that confirms it is
a real defect (not a wording nit). Two failed builds are on disk as primary evidence:
`apps/builder/.runs/1783352985100/task.json` (J5) and `.../1783352193570/task.json`.

**Builds on**:
- [015](015-builder-security-turn-sandbox.md)/[018](018-builder-turn-write-allowlist.md) — the PreToolUse
  permission hook that **denies out-of-scope writes pre-execution**
  ([permission-gate.ts:239-252](../../apps/builder/server/hooks/permission-gate.ts#L239-L252)). This is
  the *load-bearing* defense; D1 leans on it to prove the post-turn git revert is safe to narrow.
- [030](030-builder-nested-project-workflow-folders.md)/[039](039-post-turn-multi-workflow-lint.md) — the
  per-workflow-subtree confinement in `post-turn.ts confinementCheck`
  ([post-turn.ts:306-328](../../apps/builder/server/lib/post-turn.ts#L306-L328)) that D1 narrows.
- [033](033-builder-gate-qa-chat-mode.md)/[034](034-builder-test-gate-terminal-qa.md) — Ask vs
  Request-changes; E1/E2 refine its *presentation*, never its structural guarantee (Ask never mutates).

**Depends on**: nothing new.

---

## Context — the UAT triage

Five browser-agent journeys were run as a real user (not the string-asserting QA T01–T15). The core
build flow scored well (app understood the requirement, gates explained themselves in the user's own
language, Request-changes applied precisely). Seven observations survived triage. Verdicts:

| # | Finding (UAT) | Verdict | Where | Severity |
|---|---|---|---|---|
| **B1** | Implement fails `confinement breach (reverted)` on `INDEX.md`, `templates/patterns/agent-with-tools.yml`, `docs/specs/038-fp-report.md` → build dead, no deploy | **REAL BUG** (false positive + data loss) | `post-turn.ts confinementCheck` | 🔴 High |
| **B2** | Composer draft text is lost when a send hits `409 turn busy` (must retype) | **REAL BUG** (data loss) | `App.tsx send()` | 🟠 Med |
| **B3** | Hard reload drops you on "New task" instead of the build you were viewing | **REAL BUG** (state loss) | `store.ts` boot | 🟠 Med |
| **B4** | Sidebar shows `running` after the build already reached a gate (stale hint) | **REAL BUG** (stale state) | sidebar tree vs `task:update` | 🟠 Low |
| E1 | Typing a change in Ask mode answers but silently doesn't apply — reads as "done" | Enhancement (by-design guardrail, poor affordance) | Composer Ask/Change | 🟡 |
| E2 | Button names mislead: `Edit spec` = "ask AI to revise", `open SPEC.md` = "edit by hand" | Enhancement (copy) | `gate.ts`/i18n | 🟡 |
| E3 | Long phase shows only `Working…`, no "usually a few minutes" | Enhancement (copy) | i18n `working` | 🟡 |
| E4 | Empty/whitespace send is blocked but silent — no hint why | Enhancement | Composer | 🟡 |

B1–B4 are the scope of this spec (real defects, no-regression fixes). E1–E4 are a **companion section**
(§Companion) — they touch localized strings and the string-asserting web tests, a larger regression
surface, so they are optional and gated separately.

---

## Root-cause proof for B1 (the important one)

`confinementCheck` ([post-turn.ts:306](../../apps/builder/server/lib/post-turn.ts#L306)) computes a
**repo-global** `git status --porcelain` delta: `turnTouched = after − baseline`, then reverts (via
`git checkout` + `git clean -fd`, [post-turn.ts:365-369](../../apps/builder/server/lib/post-turn.ts#L365-L369))
every `turnTouched` path outside the whitelist (`projects/<project>/<workflowSlug>/`, `.runs/<taskId>/`,
`.vscode/settings.json`).

The three reverted paths in build `1783352985100` (requirement: *"Take a customer email … classify …
COMPLAINT/…"* — J5's Plan A) are **not producible by that turn**:

1. The PreToolUse hook **denies** any `Write`/`Edit`/`MultiEdit`/`NotebookEdit` outside `projects/` +
   own `.runs/` **before it happens** — `pathIsProtectedWrite` returns `true` (protected) for `INDEX.md`,
   `templates/…`, `docs/…` ([permission-gate.ts:247-251](../../apps/builder/server/hooks/permission-gate.ts#L247-L251)).
   So the agent could not have written them via a file tool.
2. Bash is default-deny with a metacharacter gate and a 5-script allowlist
   ([permission-gate.ts:122-181](../../apps/builder/server/hooks/permission-gate.ts#L122-L181)); the only
   runnable scripts (`find.py`, `generate_id.py`, `validate_workflow.py`, `lint_refs.py`,
   `lint_plugin_hashes.py`) are read-only and never write `INDEX.md` or author an `fp-report`.
3. All three files are **spec-038 development artifacts**, committed the same minute
   (`git log` → `fcf654d "spec 038 P2 artifacts … (re-applied)"`, mtime `01:01`, inside J5's turn window
   `00:55–01:07`). The `(re-applied)` in that commit message is the smoking gun: the guard `git checkout`/
   `clean`'d the user's concurrent spec-038 edits, so they had to be redone.

**Conclusion**: the breach was an **external, concurrent process** (a parallel spec-038 editing session)
that the repo-global baseline-delta misattributed to the build turn. Two independent harms:
(a) it **fails an innocent build** (blocks deploy — the J5 blocker), and (b) it **destroys unrelated
working-tree changes** by reverting them. The design comment already flags that the repo "carries
pre-existing uncommitted work" but only excludes paths *already dirty at baseline* — a file that goes
clean→dirty **during** the turn is the blind spot.

Why this is safe to fix without weakening security: the hook (spec 018) is the *pre-execution*
allowlist and it is airtight for the only two write channels a turn has (file tools + the fixed bash
set). The post-turn git pass is a **backstop** (its own header says so,
[post-turn.ts:11-17](../../apps/builder/server/lib/post-turn.ts#L11-L17)). The single class it uniquely
adds over the hook is a **cross-scope write within the hook-permitted `projects/` tree** — e.g. a turn
for workflow A writing into `projects/other/` or a sibling workflow (the hook blanket-allows all of
`projects/`, [permission-gate.ts:247](../../apps/builder/server/hooks/permission-gate.ts#L247), and
defers that policing to post-turn). Everything **outside `projects/`** — root files, `docs/`,
`templates/`, `tools/`, `skills/`, `apps/`, AND a *sibling* `.runs/<other>/` (own `.runs/` is
whitelisted; a sibling is hook-denied, [:248-249](../../apps/builder/server/hooks/permission-gate.ts#L248-L249))
— is already hook-denied and therefore **cannot be the turn's doing** — so treating it as external is correct, not a
loophole.

---

## Decisions

### D1 — Confinement reverts only the class the hook defers to it (B1)

The whole point: the PreToolUse hook is complete for **every** write channel — `WRITE_TOOLS` always get
allow/deny (never abstain, [permission-gate.ts:350-352](../../apps/builder/server/hooks/permission-gate.ts#L350-L352)),
Bash is default-deny ([:180](../../apps/builder/server/hooks/permission-gate.ts#L180)). It denies writes
to everything **except** the task's own `projects/<p>/<w>/`, own `.runs/`, and `.vscode/settings.json` —
with ONE deliberate breadth: it blanket-allows **all of `projects/`**
([:247](../../apps/builder/server/hooks/permission-gate.ts#L247)) and *defers* cross-project /
cross-workflow policing to post-turn. That deferred class — a write under `projects/**` but outside the
task's own subtree — is the **only** thing post-turn confinement uniquely adds. Everything else a turn
could dirty is either whitelisted (own scope) or **hook-denied at execution** (so it can never be the
turn's doing).

Therefore: **`inWriteZone(path) = path.startsWith('projects/')`.** In `confinementCheck`, split the
non-whitelisted turn-delta:

```ts
const inWriteZone = (path: string): boolean => path.startsWith('projects/');

const nonWhitelisted = turnTouched.filter((path) => !isWhitelisted(path));
const breaches = nonWhitelisted.filter(inWriteZone);         // deferred class → revert + error (unchanged)
const external = nonWhitelisted.filter((p) => !inWriteZone(p)); // not turn-reachable → concurrent/external
for (const path of external) p.log.warn({ path }, 'out-of-scope dirty path ignored (not turn-reachable — likely concurrent external edit)');
// revert ONLY `breaches`, exactly as today; `touched` is unchanged (it already = turnTouched.filter(isWhitelisted)).
```

Why sibling `.runs/<other>/` is **also** in `external` (not a breach): the hook already denies a turn
writing a sibling run dir ([:248-249](../../apps/builder/server/hooks/permission-gate.ts#L248-L249) —
only `own` is allowed), so a dirty sibling `.runs/` during a turn is the **backend** writing another
build's state concurrently. Reverting it would *corrupt a concurrent build*. Ignoring it is strictly
safer and loses no real protection.

**⚠️ Review fix — this intentionally changes a security test, and that must be compensated, not hidden.**
[confinement.test.ts:72-73,84,92-93](../../apps/builder/test/confinement.test.ts#L72-L93) currently
asserts a root `evil.txt` (untracked) and `tracked.txt` (tracked-modified) are **reverted** by
`confinementCheck`. After D1 they are `external` → **ignored**, so those assertions must change. This is
**not** a coverage loss, because a root write is impossible for a real turn (`pathIsProtectedWrite`
returns "protected" for any non-`projects/`/`.runs/`/`.vscode` path → **hook-denied pre-execution**),
and that denial is already covered by [permission-gate.test.ts:98-112](../../apps/builder/test/permission-gate.test.ts#L98-L112)
(`tools/…`, `skills/…`, `.venv`, `.env`, `/home/…`, sibling `.runs/` all → denied). Responsibility for
root writes moves entirely to the hook, where it structurally belongs. Required test edits:

1. **`confinement.test.ts`** — retarget the first test: the retained breaches are the `projects/other/…`
   (sibling project) + `projects/<p>/other/…` (sibling workflow) + `projects/<p>/<w>_2/…` (prefix sibling)
   cases (still revert+error, unchanged); assert the root `evil.txt`/`tracked.txt` are **left untouched**
   (present, unmodified) and produce **no** breach reason. Add one case: an `INDEX.md` + `docs/specs/x.md`
   in the delta yield zero breaches and are not reverted.
2. **`permission-gate.test.ts`** — add one line locking the guarantee that now lives solely in the hook:
   `assert.ok(checkForbiddenPath('Write', { file_path: 'INDEX.md' }, TASK))` (+ `docs/specs/x.md`,
   `templates/patterns/x.yml`) → all denied. (Today these pass by the `return true` default but aren't
   asserted; make them explicit since they're now the *only* line of defense for root writes.)

- **No product-security regression**: hook (pre-execution, all channels) + post-turn (`projects/`
  cross-scope) together still block every out-of-scope write a turn can attempt. The net set of
  reverted-or-denied turn writes is **unchanged**; only *who* handles root writes moves (post-turn →
  hook, where it already was), and *concurrent external* dirt is no longer collateral-damaged.
- **Sec-CLI-2** (AGENTS' `python -c "open('tools/x','w')"`): already hook-denied at execution (bare
  `python` + `-c` + `tools/` write all fail the hook), so `tools/x` is never created — D1 changes
  nothing there. The Appendix's "reverted" wording is stale independent of D1 (OQ1).
- **①/② parity**: `confinementCheck` also runs for Analyze/Spec turns
  ([orchestrator.ts:552-554](../../apps/builder/server/lib/orchestrator.ts#L552-L554)) using only
  `.breaches`; the same false-positive could kill an Analyze turn, so the fix protects those too. Pre-
  scaffold (`project`/`workflowSlug` null) a `projects/` write is still non-whitelisted **and**
  in-zone → still a breach, unchanged.

### D2 — Preserve the composer draft when a send fails (B2)

`send()` clears the input **optimistically before** the async dispatch resolves
([App.tsx:152-153](../../apps/builder/web/src/components/App.tsx#L152-L153): `setDraft(''); setFiles([])`),
then calls `store.start/reply/ask`, any of which can hit a `409` (turn busy). The text is gone.

**⚠️ Review fix — a `.catch()` cannot work here.** `start`/`reply`/`ask` all **catch internally and
resolve** (they call `surfaceError(e)` and return; [store.ts:666-668,698-700,725-736](../../apps/builder/web/src/store.ts#L666-L668)),
so the promise never rejects — the first draft's `.catch(restore)` would never fire. The outcome must be
communicated by **return value**, not rejection.

Fix (two small, backward-compatible parts):
1. **Store** — have `start`/`reply`/`ask` **return `Promise<boolean>`**: `return true` after the try
   succeeds, `return false` in the `catch` (right after `surfaceError`/the ask-error finalize). Adding a
   return value is additive — every current caller uses `void store.X(...)` and ignores it, so nothing
   breaks. (`reply`/`ask` still push the user text into `thread` optimistically, so on failure the text
   is doubly recoverable — thread item + restored draft; leaving the thread item is harmless.)
2. **App** — `send()` restores on a `false` result, guarded so it never clobbers text typed during the
   in-flight window:

```ts
const msg = (text ?? draft).trim(); if (!msg) return;
const atts = files.length ? toWire(files) : undefined;
const prevFiles = files;
setDraft(''); setFiles([]);                              // keep the responsive clear
const onDone = (ok: boolean) => {
  if (!ok) { setDraft((d) => d || msg); setFiles((f) => (f.length ? f : prevFiles)); }
};
if (view === 'empty') { void store.start(msg, atts).then(onDone); return; }
// … each of the reply/ask/reply(error) branches: .then(onDone) on the dispatch promise …
```

- **Test** (web, vitest): stub `store.start` to return `false` (a simulated 409) → assert `draft`
  equals the typed text after `send()` settles; stub `true` → assert `draft` is empty.

### D3 — Reopen the last-viewed build after a hard reload (B3)

The thread is already persisted to `localStorage` and restored **inside** `openTask`
([store.ts:879-895](../../apps/builder/web/src/store.ts#L879-L895)), but nothing persists *which* task
was open, so boot lands on the empty view (`task.value = null`) until the user re-clicks the sidebar.
Close the loop:

- Persist the active taskId at the single choke point both entry paths share — **`openStream(taskId)`**
  ([store.ts:528](../../apps/builder/web/src/store.ts#L528)), called by `start()` and `openTask()`:
  `localStorage.setItem('builder:lastTask', taskId)`. Clear it in **`resetToNew()`**
  ([store.ts:902](../../apps/builder/web/src/store.ts#L902)) — the empty/new-task reset.
- On boot (add to the existing `if (typeof localStorage !== 'undefined')` init block,
  [store.ts:516](../../apps/builder/web/src/store.ts#L516)) restore **quietly**:

  ```ts
  const last = localStorage.getItem('builder:lastTask');
  if (last) void api.getTask(last).then(() => openTask(last)).catch(() => localStorage.removeItem('builder:lastTask'));
  ```

  **⚠️ Review fix — do NOT call `openTask(last)` directly on boot.** `openTask`'s own `catch` calls
  `surfaceError` ([store.ts:896-898](../../apps/builder/web/src/store.ts#L896-L898)), so a stale/deleted
  id would flash an error banner on every load. Pre-checking with `api.getTask` and only then calling
  `openTask` keeps a missing build **silent** — clear the key and stay on the empty view. No new
  endpoint; `openTask` still restores the persisted thread + **re-subscribes SSE** so a still-running
  build resumes live.
- **Test** (web): set `builder:lastTask`, mock `api.getTask` → 200 ⇒ boot opens the task (`task.value`
  populated); mock 404 ⇒ `task.value` stays `null`, the key is removed, **no** `startError` banner.

### D4 — Sidebar in-progress hint follows the live gate transition (B4)

**⚠️ Review fix — the sidebar reads `active`, not `tree`.** The "In progress" list renders from the
**`active`** signal (`WireTreeTask[]`, [store.ts:60](../../apps/builder/web/src/store.ts#L60);
`activeHint(t.status)` at [Sidebar.tsx:133-135](../../apps/builder/web/src/components/Sidebar.tsx#L133-L135)).
`active` is refreshed by `loadActive()`, which the store calls after a user *confirm/reply/start* — but
the `running → awaiting_confirm` park arrives via an **SSE `task:update`** (a phase finishing on its own),
and nothing calls `loadActive()` on that event, so the row shows a stale `running` until the next user
action. A build that reaches `done`/`cancelled` must also **leave** the in-progress list — so an in-place
status patch is not enough; the list must be re-derived.

Fix (smallest correct): refresh `active` whenever `applyTask` applies a **status change**. `applyTask`
([store.ts:213](../../apps/builder/web/src/store.ts#L213)) is the single choke point for both `task:update`
and the optimistic snapshots:

```ts
export function applyTask(t: WireTask): void {
  const prevStatus = task.value?.taskId === t.taskId ? task.value.status : undefined;
  // … existing body …
  if (t.status !== prevStatus) void loadActive(); // running→gate updates the hint; →done/cancelled drops it
}
```

- Gating on `t.status !== prevStatus` means `loadActive()` fires only on genuine transitions (a handful
  per build), not on every streaming rev. `loadActive` is a best-effort localhost GET
  ([store.ts:606-612](../../apps/builder/web/src/store.ts#L606-L612)) that already tolerates failure — no
  new endpoint, no polling change. Capture `prevStatus` **before** `setTaskValue(t)` runs. The
  `awaiting_confirm → gate` / else `running` mapping is untouched.
- **Test** (web): with an active build in `active`, apply a `task:update` moving it
  `running → awaiting_confirm` (mock `api.active` to return the parked status) → after settle, the row's
  hint is `gate`; apply a `→ done` update → the build is gone from `active`.

---

## Companion — E1–E4 (optional, higher regression surface)

These improve clarity but touch **localized strings** (`i18n.ts` EN+JA) and the **string-asserting web
tests / QA String Dictionary**, so they are opt-in and must land with their test + dictionary updates,
not silently:

- **E1 — Ask-mode change affordance.** When the composer is in **Ask** and the drafted text reads like a
  change request, show a non-blocking inline hint + one-tap **"Apply to spec (Request changes)"** that
  flips `mode='change'` and re-sends — so the user isn't left thinking an answer was applied. Structural
  guarantee is untouched (Ask still never mutates; this only *offers* the switch). Detection can be a
  cheap heuristic (imperative verb / "change|add|remove|instead") — err toward *offering*, never
  auto-switching.
- **E2 — Rename the two easily-confused actions.** `Edit spec` → e.g. **"Ask AI to revise"**;
  the gate-strip `open SPEC.md` → **"View / edit the doc"**. This is a copy change across `gate.ts`/i18n
  **and** the QA String Dictionary + any `*.test.ts` asserting those literals — enumerate and update all
  of them in one change, or skip E2 entirely. (Higher blast radius than E1.)
- **E3 — Progress affordance.** Replace the bare `Working…` with a reassurance line (e.g. *"Working… this
  step usually takes a few minutes"*). Pure i18n copy; add the JA column. Optional: a determinate-feel
  elapsed timer is out of scope (no reliable ETA).
- **E4 — Empty-send hint.** The send button already disables on empty/whitespace; add a muted helper
  (*"Describe the workflow or change…"* style) so the user knows *why*. Copy only.

---

## Acceptance

1. **B1/D1**: a build turn that runs while an unrelated tracked file (`INDEX.md`, `docs/**`, `templates/**`,
   …) is edited by a concurrent process **completes normally** — that file is neither reverted nor a
   build-error reason — while a real cross-scope escape (`projects/other/**`) is still reverted + errored.
   Proven by the updated `confinement.test.ts` (root ignored / `projects/` sibling reverted) **and** the
   new `permission-gate.test.ts` line (root write hook-denied), + one manual re-run of the J5 requirement
   with a concurrent `docs/` edit in another terminal.
2. **B2/D2**: a send that 409s leaves the typed text in the composer (verified via the boolean-return
   stub, since the dispatch never rejects).
3. **B3/D3**: hard-reload while viewing a build reopens that build (or, if it no longer exists, silently
   stays on the empty view — no error banner, no crash).
4. **B4/D4**: the sidebar hint reads `gate` the moment the build parks, and a finished build leaves the
   in-progress list — both without a user action.
5. **Unchanged**: permission-hook *logic* (D1 only *adds* assertions locking behavior it already had),
   the gate FSM, Dify I/O, the 3 linters. The end-to-end security guarantee (no turn write escapes
   `projects/`+own `.runs/`) is **preserved** — D1 only moves root-write enforcement to the hook, where
   it structurally already lived, and stops collateral reverts of concurrent external work.

## Out of scope / open questions

- **OQ1** — Re-verify the `Sec-CLI-2` Appendix wording ("out-of-scope write reverted") against current
  hook behavior; the `python -c` case is hook-denied pre-execution, so "reverted" may already be stale
  independent of 040. Doc-only follow-up.
- **OQ2** — A per-turn *authorship log* from the hook (record every allowed write path) would let the
  post-turn pass revert opaque escapes with certainty instead of by zone. Not needed given the current
  airtight hook; parked unless the bash allowlist ever widens. **Residual to keep in mind**: `decide()`
  *abstains* on an **unknown tool** ([permission-gate.ts:357-358](../../apps/builder/server/hooks/permission-gate.ts#L357-L358)),
  deferring to `headless-settings.json`. D1 assumes that settings file doesn't expose a non-`WRITE_TOOLS`
  file-writing tool. If a future tool is added, either add it to `WRITE_TOOLS` in the hook or revisit the
  zone filter — otherwise a write via that tool outside `projects/` would be ignored rather than reverted.
- **Not addressed**: multi-user / multi-terminal true isolation (a git worktree per turn) — heavyweight,
  unjustified for a `127.0.0.1` single-user tool; D1 removes the harm without it.

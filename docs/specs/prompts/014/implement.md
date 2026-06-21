# Implementation Prompt — Spec 014 (remaining): D5–D7 state & integrity

> Copy-paste vào fresh session. Builds on the merged spec 013 + spec 014 **D1–D4 (already landed)**.
> ~0.5–1 day. Backend-only except D5 (a small `store.ts`/`task.ts` field).

---

You are finishing **Spec 014 — Builder ④-terminal correctness + state & deploy-gate integrity** for the
Dify Workflow Builder. The headline ④ items are **already implemented and tested** — do **NOT** redo them:

- **D1** — `auto`/`spec_only` PARK at the selfhost Import gate (`maybeAutoAdvance` hard-stops on the
  `awaiting_import` flag). No silent auto-deploy.
- **D2** — a lint≠0 ④ without a human ③-accept parks at a `still_failing` ④ gate (Accept anyway / Discard);
  `auto` hard-stops; `accept` finishes `done` tagged. Mirrored into `.claude/skills/dify-build/test.md`.
- **D3** — `writePushIntent` is temp+rename atomic.
- **D4** — the resume fallback excludes timeouts (`&& !turn.note`).

Tests are green (server `npm test` = 91). **Your job is D5, D6, D7** — the state-integrity remainder.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects` (app in `apps/builder/`).
- **READ FIRST**:
  - Spec: [docs/specs/014-builder-terminal-correctness-and-state-integrity.md](../../014-builder-terminal-correctness-and-state-integrity.md)
    — esp. **D5/D6/D7** + Open Questions **Q3/Q4** and the resolved Q1/Q2 (already applied in D1/D2).
  - Spec 013: [013-builder-linter-contract-and-test-seams.md](../../013-builder-linter-contract-and-test-seams.md)
    — the `resolveRunners` seams + `apps/builder/test/advance-loop.test.ts` harness you will reuse.
  - Spec 011 backlog rows this **supersedes**: **R8** (reconnect race — *needs a repro first*), **R14**
    (listener leak), **R15** (mtime seed) in [011-builder-test-coverage-and-remediation.md](../../011-builder-test-coverage-and-remediation.md) §4.
  - Spec 012 **D1** (multi-image bodyLimit) in [012-builder-image-attachments.md](../../012-builder-image-attachments.md).
  - Code: `apps/builder/web/src/store.ts` (`applyTask` :135, `onInit` ~:212), `apps/builder/server/state/task.ts`
    (the persisted `Task` + `emit`'s `saveTask`), `apps/builder/server/lib/orchestrator.ts`
    (`runTestAndFinish` :590, `runImportAndFinish` :635 incl. `duplicateWarning` :688-690,
    `difySeedScaffoldAndPull` ~:115-163), `apps/builder/server/lib/report.ts` (`runReport`),
    `apps/builder/server/lib/dify-io.ts` (`reconcileAppIdByName` :193, `pushApp` :142),
    `apps/builder/server/lib/claude-session.ts` (kill path), `apps/builder/server/lib/lock.ts`
    (`cancelledTasks` Set), `apps/builder/server/routes/tasks.ts` (image-turn body).

## Why this matters (the theme)

A build must never be silently **raced into a stale view**, **duplicated**, or left **leaking**. D1–D4
closed the ④ *terminal* holes; D5–D7 close the *reconnect / recovery / hygiene* ones. All are localized;
the only cross-file one is D5 (a monotonic `rev` on the persisted task, read by the web store).

## Pre-flight
```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status
(cd apps/builder && npm run typecheck && npm test)            # 91 green baseline (D1–D4)
(cd apps/builder/web && npm run build)                        # web compiles before D5
```

## Tasks

### D5 — Reconnect version guard (supersedes 011 R8) — **needs a repro FIRST**

011 R8 says: *"the post-init GET re-fetch can resolve AFTER a newer live `task:update` and clobber it"* and
**"needs a repro to confirm before fixing."** Honor that:
1. **Reproduce first.** Force `onInit`'s `void api.getTask(id).then(applyTask)` (store.ts ~:212) to resolve
   *after* a later `task:update` and show the UI reverting to an older phase/gate (a test or a logged race).
   If you cannot reproduce it, **document that in the spec ledger and STOP D5** (do not ship a guard for a
   race that doesn't exist).
2. **If reproduced**, add a monotonic `rev` (Open Q4): bump `task.rev` in the orchestrator's `emit`
   (`apps/builder/server/state/task.ts` / `orchestrator.ts emit`) on every persisted transition; have
   `applyTask` (store.ts:135) **ignore** any snapshot whose `rev` is ≤ the last applied; resolve the
   init-GET only if no newer `task:update` landed since it was issued. (Q4 alt: derive ordering from the SSE
   event id — pick one; `task.rev` is self-contained and migrates trivially since absent ⇒ 0.)
3. Test: a `store`/`mappers` unit feeding `applyTask` a stale (`rev` older) snapshot after a newer one and
   asserting the newer state survives.

### D6 — Reconcile never attaches the wrong app (Open Q3)

`reconcileAppIdByName` (dify-io.ts:193) picks the most-recently-created app whose slugified name matches —
with no check it is *this* build's app, so two same-named apps (a prior crashed-then-retried import, or two
builds with the same derived name) can attach the wrong `app_id`.
1. **Inspect `tools/dify_base/sync.py list`** output (Q3): does it expose a created-at timestamp or a stable
   id that disambiguates same-named apps? Run it (or read the parser `parseListTable` in dify-io.ts) to find out.
2. **If a disambiguator exists**, persist a push-time signature (timestamp window / `--json-out` id) on the
   `push_intent` marker and use it to pick the right match.
3. **If only the name is exposed**, degrade safely: when `>1` name match exists, do NOT pick the newest —
   surface `"ambiguous — verify in Dify"` (set `task.error`/an `importNote`) so the user reconciles manually.
4. Test (extend `apps/builder/test/dify-parsers.test.ts`): `reconcileAppIdByName` with ≥2 name matches →
   ambiguous signal, never a silent newest-pick.

### D7 — Low-risk hygiene roundup (each independent, XS–S)

- **Cloud/none edit-existing duplicate warning.** Today the `created a NEW Dify app (DUPLICATE)` warning is
  built only inside `runImportAndFinish` (orchestrator.ts:688-690, selfhost). Move/compute it in `runReport`
  (it has `task.workflow` + `task.deploy`) so a **cloud or none** *edit-existing* build (`task.workflow` set)
  also carries the warning in `report.json` notes. (`cloud` tells the user to Studio-import → duplicates too.)
- **Listener leak on kill (011 R14).** In `claude-session.ts`, on `forceKill`/timeout close the `readline`
  interface + remove the `stderr`/`exit`/`error` listeners so a killed child leaves nothing attached.
- **Bounded `cancelledTasks` (lock.ts).** The `cancelledTasks` Set grows unbounded; evict a taskId when the
  build reaches a terminal status (`done`/`error`/`cancelled`) — keep the "survives a turn-lock release"
  property D1–D4/Lát-6 rely on (only evict on TERMINAL, not on release).
- **Exact seed file (011 R15).** In `difySeedScaffoldAndPull`, track the exact file `pullApp` wrote instead
  of the max-mtime `readdir` scan (orchestrator.ts ~:152-163) so a clock-skew tie can't seed/diff the wrong YAML.
- **Image-turn bodyLimit (012 D1).** Confirm/raise Fastify `bodyLimit` to comfortably exceed
  `3 × 10MB × 1.33` (base64) so a max multi-image turn yields the friendly 400 from `validateImages`, not a
  raw Fastify 413. Add a regression assertion (oversize body → readable 400).

## Build + verify
```bash
(cd apps/builder && npm run typecheck && npm test)     # all green incl. your new D5/D6/D7 cases
(cd apps/builder/web && npm run build)                 # D5 web change compiles
```

## Acceptance (maps to spec 014 §Acceptance criteria 5–7)

- [ ] **D5:** R8 either reproduced → a stale (`rev`-older) snapshot can no longer overwrite a newer applied
  state (unit green); OR documented unreproducible in the ledger and deferred.
- [ ] **D6:** `reconcileAppIdByName` never silently attaches a wrong app when ≥2 names match — it disambiguates
  by signature or surfaces "ambiguous — verify in Dify" (test green).
- [ ] **D7:** cloud/none edit-existing carries the duplicate warning; killed child leaves no listeners;
  `cancelledTasks` is bounded; seed picks the exact pulled file; an oversize image turn returns a readable 400.
- [ ] `npm run typecheck` + `npm test` (server) + `npm run build` (web) + CI `builder` job all green; the
  D1–D4 tests and 013's golden-build still pass (no behavior regression).

## On blocker
- **R8 won't reproduce** → do NOT ship D5's guard; record "R8 unreproducible on current code" in the spec
  ledger and move on (this is exactly what 011 R8 asked).
- **`sync.py list` exposes no disambiguator** → D6 is "best-effort + warn" only; say so in the ledger, don't
  invent an id.
- **A D7 item turns out behavior-changing** (e.g. evicting `cancelledTasks` on release breaks a cancel
  re-check) → stop and reassess; the Set must survive a turn-lock release, only evict on terminal.

## Guardrails
- **Do NOT touch D1–D4** (the ④ terminal / deploy-gate / atomic-marker / resume-timeout code is done +
  tested) — only add D5/D6/D7. Do NOT touch the phase state machine, `gate.ts` variants, post-turn verify,
  or the model-C spawn beyond the D7 listener cleanup.
- **Spec-update (no silent drift):** update spec 014 status → `Implemented` when D5–D7 land (or note D5
  deferred-unreproducible), and mark 011 **R8/R14/R15** superseded in the 011 backlog. Update the README index row.
- Localhost only; commit locally only after acceptance passes; do **not** push; do **not** `--no-verify`.
  End the commit message with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

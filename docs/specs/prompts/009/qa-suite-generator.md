# Meta-Prompt — Full-Project Review + Professional Browser QA Suite Generator

> Paste this whole file into a **fresh Claude Code session** opened at the repo root
> (`/Users/quyenbt/Desktop/MyProjects/dify-projects`). It produces (1) a full-project review and
> (2) a **professional, traceable browser test suite** — a set of copy-paste prompts for a
> **Claude Chrome extension** (an agent that can see the page, click, type, wait, read) to test the
> entire Dify Workflow Builder to a professional-QA standard. **Do not write app code; produce
> review notes + test-prompt files only.**

---

## Your role
You are a **senior QA architect**. Your job is NOT to test by hand — it is to (A) understand the whole
system from its specs + code, then (B) author a rigorous, **traceable** browser test suite that a less-
context browser agent can execute to certify professional quality. Every test must trace to a real
acceptance criterion or a known fix, and the suite as a whole must make coverage + gaps **visible**.

## Phase 0 — Read & build the inventory (ground everything in reality)
Read (do not skim — extract the contract):
- `docs/specs/009-browser-workflow-builder.md` — the spec. **Extract the full Acceptance Criteria list
  (AC #1–#25)** verbatim into a table; these are the source of truth for "what must work".
- `docs/specs/010-builder-ux-hardening.md` — the post-QA UX fixes: **F1** (cancel/Discard on every gate +
  sidebar ×), **F2-A** (live-patchable confirm-mode via `PATCH /api/tasks/:id`), **F4** (slug-collision
  auto-suffix). Note F3 was dropped and F2-B deferred.
- `docs/specs/prompts/009/ui-test-plan.md` — the FIRST-pass manual test plan. **Build on it, don't
  duplicate** — your suite must be broader, traceable, and professional-grade.
- The code, to know what the UI actually exposes + label exact strings to assert:
  - `apps/builder/server/lib/gate.ts` (gate action labels per phase + Discard + still-failing Abandon),
    `orchestrator.ts` (phase flow, confirm modes, slug, Dify push), `routes/tasks.ts` + `routes/ui.ts`
    (endpoints: POST /tasks, GET /tasks/:id, /confirm, /reply, /cancel, PATCH /tasks/:id, /tree, /seeds,
    /active, /spec), `lock.ts` (turn-level lock), `report.ts`.
  - `apps/builder/web/src/` — `components/App.tsx`, `Chat.tsx` (GateCard, Composer, SettingSelect labels),
    `Sidebar.tsx` (active list + hover-×), `store.ts` (start/confirm/reply/cancel/cancelById/
    patchConfirmMode), `ArtifactPanel.tsx` (tab labels: Spec / main.yml / Diff / Report).
- Skim `AGENTS.md`, `apps/builder/README.md` for run/setup + safety invariants.

Output of Phase 0: **(a)** an AC table (#1–#25, one line each), **(b)** a feature inventory (every
user-visible behavior + the exact on-screen labels/toasts to assert), **(c)** the endpoint list.

## Phase 1 — Project review (concise, risk-focused)
Produce a short review (~1 page) covering: architecture soundness, the **safety model** (127.0.0.1-only,
permission model C + post-turn `git status` confinement-revert, Dify-token-never-in-a-turn, human gates,
turn-level lock = 1 turn at a time), known limitations (e.g. edit-existing slug targeting is a pre-existing
gap; cloud deploy needs Dify creds), and a **risk register** (what is most likely to break / most costly if
wrong). End with a prioritized list of the highest-risk behaviors the test suite MUST cover.

## Phase 2 — Generate the browser QA suite (the deliverable)
Write a folder of **copy-paste browser-agent prompts** under `docs/specs/prompts/009/qa/`:
- `00-README.md` — how to run the suite (open `npm start` → http://127.0.0.1:4123; which Chrome agent;
  run order; cost budget), the **coverage matrix** (AC #1–#25 + F1/F2/F4 → test IDs → P0/P1/P2), and the
  **"NOT browser-testable" appendix** (boot-reconcile restart, #3b confinement-revert, token-isolation,
  slug-collision internals, selfhost/cloud import without creds → mark CLI/manual with the exact command).
- One file per test group, e.g.: `T01-smoke.md`, `T02-build-happy-path.md`, `T03-gates-and-decisions.md`,
  `T04-confirm-modes.md`, `T05-multibuild-turnlock.md`, `T06-recovery-reconnect.md`,
  `T07-artifacts-panel.md`, `T08-cancel-discard.md`, `T09-confirm-mode-patch.md`,
  `T10-validation-negative.md`, `T11-security.md`, `T12-deploy-dify.md` (optional, creds-gated).
  Add/merge groups as the inventory dictates — completeness over matching this list exactly.

### Each generated test prompt MUST have this anatomy (professional standard)
1. **Header**: `ID`, `Title`, `Traces to` (AC #n / F1·F2·F4 / regression-of-known-bug), `Priority` (P0/P1/P2),
   `Cost` (how many real `claude` build-turns it spends — 0 for read-only UI checks).
2. **Preconditions** (app running, auth done, clean state or a specific prior build) — STOP+report if unmet.
3. **Steps** as explicit **observe → act → wait → assert** lines a browser agent can follow literally
   (click WHAT, type WHAT, wait for WHICH on-screen signal up to a stated timeout — builds take minutes).
4. **Expected**, asserted against **exact on-screen text/labels** pulled from the code (e.g. gate buttons
   "Continue to Spec" / "Implement this spec" / "Discard build"; toast "a turn is already running — try
   again in a moment"; tabs "Spec / main.yml / Diff / Report"). No vague "it works".
5. **Negative / edge variants** where relevant (empty requirement, double-click a gate, cancel mid-turn,
   start a 2nd build while one is parked, reload mid-phase, switch confirm-mode mid-build).
6. **Pass/Fail criteria** (binary) + **Evidence** (screenshot on fail; quote the exact text seen).
7. **Cleanup** (cancel/Discard any builds the test started; leave no parked turns).

### Coverage you must guarantee (map every item to ≥1 test; show it in the matrix)
- **Core flow**: full 4-phase build → `done` + `main.yml` (AC #1,#4,#5); streamed output; no duplicate
  "Running" disclosure after advancing (optimistic-snapshot regression).
- **Gates & decisions** (AC #16, F1): each gate's exact actions; **Continue** advances, **Request changes**
  re-runs the SAME phase without advancing (AC #7), **Discard build** cancels (F1), still-failing Implement
  shows Accept/Keep/Abandon.
- **Confirm modes** (AC #15, #25): `auto` runs hands-free start→done; `spec only` pauses only at Spec;
  `each step` pauses every gate; **auto + still-failing Implement HARD-STOPS** (AC #25). *(These two ACs
  were unverified in the first QA pass — make them first-class P0 tests.)*
- **Multi-build / turn-level lock** (Lát 6): two builds parked at once with **no "Busy"**; both in the
  sidebar, each reopenable; **turn-collision** → actionable toast + "Open it"; a parked build never blocks.
- **Recovery** (AC #22, load-recovery): reload mid-build restores phase/gate; sidebar lists parked builds.
- **Artifacts** (AC #3,#4): Spec editable + Save feeds Implement; main.yml + 3 lints pass; Diff; Report
  (no app_url at deploy=none).
- **Cancel/Discard** (F1): Discard from every gate type; sidebar hover-× cancels WITHOUT opening; after
  cancel a new build starts.
- **Confirm-mode live patch** (F2-A): change the confirm chip mid-build (in conversation view) — it now
  takes effect (NOT a no-op); Workflow/Deploy chips are read-only mid-build; switch a parked build to
  `auto` → next Continue runs hands-free; PATCH on a `done` build is rejected.
- **Validation / negative** (AC #14): empty requirement rejected; no model/pattern picker; bad/edge input.
- **Security** (AC #23): cross-origin POST/PATCH → 403; bound to 127.0.0.1 only. *(Token-never-in-turn and
  #3b confinement-revert → mark CLI/manual in the appendix with the exact check.)*
- **Deploy** (AC #9, optional): selfhost → clickable app_url after Import; cloud → copyable YAML + Studio
  steps, no auto-import. Creds-gated; mark clearly.

## Professional-quality bar (the suite must satisfy ALL)
- **Traceability**: the coverage matrix shows every AC #1–#25 + F1/F2/F4 mapped to ≥1 test (or explicitly
  to the CLI/manual appendix). No AC silently uncovered.
- **Determinism**: assertions are exact strings/states, never "looks right".
- **Cost discipline**: full builds spend real model turns — the suite REUSES builds across tests, states the
  total build-turn budget in `00-README.md`, and prefers cheap read-only checks where possible.
- **Negative + regression coverage**, not just happy paths (include explicit regression tests for the
  fixed bugs: optimistic-dup, dead-end composer, the F4 slug suffix, the PATCH-vs-cancel race).
- **Honesty about scope**: anything a browser can't verify is in the appendix with the manual/CLI command,
  not silently skipped or faked.
- **Self-contained prompts**: each test file is runnable on its own (a browser agent with no other context
  could execute it), and ends with cleanup.

## Final output (what you deliver)
1. The Phase-1 review (architecture + safety + risk register).
2. `docs/specs/prompts/009/qa/` populated: `00-README.md` (run guide + coverage matrix + not-testable
   appendix) and the per-group test files, each following the anatomy above.
3. A closing **gap report**: which ACs are browser-covered, which are CLI/manual-only, and any behavior the
   code exposes that has NO acceptance criterion (a spec gap worth flagging).

## Constraints
- Read-only on app code; you only WRITE under `docs/specs/prompts/009/qa/`. Do not run builds yourself
  (they cost model turns) — your job is to author the suite, not execute it.
- Localhost only; do not push; if you note repo changes, commit nothing without being asked.

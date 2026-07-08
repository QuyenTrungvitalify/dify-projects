# Spec 048 — Timeout knobs, auto-mode ④ lint reuse, implement.md de-accretion

**Status**: Implemented (r2, 2026-07-08) — the second "optimize without touching quality" batch after
[046](046-phase-latency-and-drift.md) (same review source: the 5-lens 4-phase audit). **S** (~1 ngày).
Every decision here is BEHAVIOR-PRESERVING by construction on the default path; the one item with
real regression risk (merging the triplicated language directives) is explicitly OQ'd, not shipped.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-08.

**Builds on**: [032](032-builder-live-workflow-test.md) (the `BUILDER_LIVE_RUN_TIMEOUT_MS` env-knob
idiom D1 copies); [013](013-builder-linter-contract-and-test-seams.md) (the single LINTERS contract —
D2 reuses ③'s codes, it never forks the list); [017](017-builder-prompt-linter-and-perf.md) D5 (the
concurrent-linters precedent D2 extends: same verdict, less wall-clock); [045](045-turn-failure-triage.md)
(field evidence: users hit the hardcoded ceilings and could not adjust them).

---

## Motivation (from the review + field)

- `TURN_TIMEOUT_MS` (10 min, `orchestrator.ts`) and `ASK_TIMEOUT_MS` (3 min, `ask.ts`) are HARDCODED;
  `BUILDER_LIVE_RUN_TIMEOUT_MS` (120 s, `live-test.ts`) is env-configurable but UNDOCUMENTED in
  `.env.example`. Field: UAT's complex workflows exceed 120 s live-run; long JP requirements + the
  4-linter 5-pass loop press the 10-min turn ceiling; users cannot tune any of it.
- On `auto`, ④'s report re-runs all 4 linters + the preflight probe although NO gate was shown
  between the ③ verify and the ④ report — no human (or anything else, under the turn lock) could
  have touched `main.yml`. The re-run exists for the each_step gate-edit window (037 r2's staleness
  fix); on the windowless path it is a provably-identical repeat (4 spawns + ~1–2 s per auto build).
- `implement.md` has accreted to 21 hard directives with step 4 a ~350-word mega-bullet mixing 6
  concerns, and the mandatory-structural-elements list enumerated TWICE in the same file — each new
  spec appends rather than restructures.

## Decisions

- **D1 · Timeout knobs (locked).** `TURN_TIMEOUT_MS` → `Number(process.env.BUILDER_TURN_TIMEOUT_MS) ||
  600_000`; `ASK_TIMEOUT_MS` → `Number(process.env.BUILDER_ASK_TIMEOUT_MS) || 180_000` (the exact
  `BUILDER_LIVE_RUN_TIMEOUT_MS` idiom). `.env.example` documents ALL THREE knobs with the defaults
  and one guidance line each (live-run: raise for iteration/file-heavy workflows). One HUONG_DAN
  troubleshooting line. Defaults unchanged ⇒ zero behavior change unless the operator opts in.
- **D2 · ④ reuses ③'s lint verdict on the WINDOWLESS auto hop only (locked).** Mechanics — explicit
  parameter threading, NO stash/state (a stash would need invalidation and could go stale — the exact
  bug class this spec must not introduce):
  1. `PhaseVerify` gains `lintCodes?: LintCodes` (internal type); the ③ implement verify sets it from
     `check.detail.lintCodes` (all outcomes — success AND still_failing).
  2. `runPhaseAndGate` returns the `PhaseVerify` (was fire-and-forget; callers may ignore — additive).
  3. *(r2 — the hop transits `confirmAdvance`, review finding 2.3)* `maybeAutoAdvance(task, ctx,
     internal?)` fires the primary via `confirmAdvance(task, 'continue', ctx, undefined, internal)`,
     where `internal?: { reuseLint?: LintCodes }` is a **separate 5th parameter** — deliberately NOT a
     `ConfirmPayload` field, because payload is the HTTP request body and a client-supplied
     `reuseLint` could skip the ④ re-run on a WINDOWED path. routes/ never populates it. Applied to
     `actionId === 'continue'` only (`accept` is always a human click — auto HARD-STOPS at
     still_failing). Mode-AGNOSTIC (finding 2.7): `auto`, `spec_only`, and fast+auto all hop through
     this same seam inside the one lock-holding request, and all reuse.
  4. `runReport` with a **clean** `opts.reuseLint` (guarded by `lintClean` — a failing set would need
     the linters' output lines for the notes, and is unreachable from the hop anyway): ONE shared
     `reuse` branch (finding 2.6 — a single guard so the two skips can never diverge) skips the 4
     linter spawns (codes verbatim) AND the preflight recompute (`task.preflightNote` is fresh from
     the same ③ verify — 037 r2's recompute exists precisely for the gate-edit window this path does
     not have). `hasUnresolvedPluginTodo` is still recomputed — a pure file read, no spawn, no stored
     ③ equivalent. `detail.lintCodes` is null-narrowed (`?? undefined`) — null only on artifact-missing,
     which maps to `error` and never hops (finding 2.4).
  5. Every path WITH a human window keeps the full re-run: each_step's ③-gate `continue`, the
     still_failing `accept`, every ④ `/reply` retry, and the import re-report. Their call sites simply
     don't pass `reuseLint`.
  Result equality is STRUCTURAL: same request, lock held, 039 reverts any foreign write mid-turn —
  there is nothing that could change the file between the two lint runs being merged.
- **D3 · implement.md de-accretion — editorial ONLY (locked).** Reorganize without adding/removing a
  single rule: (a) *(r2, finding 3.2 — the two lists were VARIANTS, not duplicates)* ONE canonical
  **Mandatory structural elements** checklist in step 4 carrying the trivial branch's deltas inline
  (`answer` replaces `end` for advanced-chat; a trivial advanced-chat build keeps its chat `mode`);
  the trivial branch references it. The old custom-branch framing "a custom build MUST still carry"
  generalizes to "the build MUST still carry" — a semantic no-op (pattern copies and the trivial
  list already required the same set); (b) step 4's mega-bullet splits into labeled sub-bullets
  (Source / Mandatory structural elements / Wire-up / Plugins & datasets / Code nodes / if-else);
  (c) no change to the 🌐 banner, `## Output language`, the `{{KNOWLEDGE}}` line (byte-identity
  test pins it), the linter list (docs-pin test), or any MUST/NEVER wording. *(r2, finding 3.3 —
  the banner had NO test)*: docs-contract-pin now pins the banner line, the `## Output language`
  heading, the single `` `kind: app` `` occurrence, and the surviving advanced-chat delta. The
  directive inventory (14/14 strings verified) lives in the S3 commit message.

## Non-goals

- **No** merging of the language banner + Output-language section + languagePin (the ~18–33%-of-body
  triplication): real preamble-regression risk in the owner's actively-tuned area → **OQ1**, owner's
  explicit call, separate change.
- **No** cap-5 lint-loop change (no field evidence it binds), no timeout default changes, no ④
  behavior change on ANY path with a human window, no SKILL.md/AGENTS.md trimming.

## Acceptance criteria

1. *(D1, r2 — split per findings 1.2/1.3/1.4)* 1a: with no env set, `TURN_TIMEOUT_MS` (now exported) =
   600 000 and `ASK_TIMEOUT_MS` = 180 000, and `.env.example` documents all three knobs
   (timeout-knobs.test.ts). 1b: with the env set BEFORE module load (separate test-file process +
   dynamic import — module-load consts can't be mutated in-process), the consts reflect the env, and a
   hung real `runTurn` on the overridden budget times out fast with the unchanged note TEMPLATE
   (`phase timed out after 1s — retry or simplify`; 045's JA frame matches via a `(\d+)` capture, so
   the number may differ — the template may not). 1c (wiring): an orchestrator-driven build's fake
   `runTurn` captures `opts.timeoutMs === TURN_TIMEOUT_MS` for every phase turn (lint-reuse.test.ts).
2. *(D2, r2)* Auto build: the stubbed `runReport` receives `opts.reuseLint` deep-equal to the ③ codes.
   Real-`runReport` spawn-proof: in a projectsDir with NO `.venv` (any spawn attempt exits non-zero), a
   clean `reuseLint` yields all-zero `report.json.lint` + `all linters passed` + a ③-planted
   `task.preflightNote` left untouched, while a control call without reuse (and a NON-clean reuse,
   pinning the lintClean guard) comes back dirty — proof the reuse path spawned nothing.
   - 2b (anti-gaming): each_step's ③-gate `continue` passes NO `reuseLint` — the windowed path
     re-runs in full.
   - 2c: the ④ `/reply` retry and the still_failing `accept` pass NO `reuseLint`; the retry test first
     proves the failed attempt WAS the reuse hop, then that the retry is not.
   - 2d *(finding 2.7)*: `spec_only`'s ③→④ hop reuses too — the seam is mode-agnostic.
3. *(D2)* The linters.test.ts cross-consumer identity suite passes UNCHANGED (it calls `runReport`
   without opts — the contract that ③ and ④ agree is untouched).
4. *(D3, r2)* implement.md: `` `kind: app` `` occurs exactly once; every pre-048 MUST/NEVER/STOP
   directive string still present (14/14 inventory in the commit); the advanced-chat deltas survive
   the merge; knowledge-inject byte-identity green with zero edits; docs-contract-pin extended with
   the banner/heading/checklist pins (an ADD — the pre-048 assertions themselves unchanged).
5. Full suites green; no gate.ts/FSM/confirm-mode change.

## Sequencing

- **S1** — D1 knobs + `.env.example` + HUONG_DAN + AC 1.
- **S2** — D2 threading + AC 2/2b/2c/3.
- **S3** — D3 editorial + AC 4 inventory.

## Open questions

- **OQ1** — merge the triplicated language directives into one block per body (+ languagePin)?
  Saves ~10–18% of every turn-phase prompt; owner's call after the current language tuning settles
  (measured by whether English preambles recur in JP builds).

## Revision log

- r1 (2026-07-08) — initial draft. Adversarial-review note: the subagent reviewer pool was
  quota-limited at authoring time; the D2 mechanics were verified inline against orchestrator.ts
  (the ③→④ hop runs inside the same lock-holding request; `runTestAndFinish` call sites
  enumerated: auto hop, each_step continue, still_failing accept, ④ /reply retry).
- r2 (2026-07-08) — adversarial agent review (quota recovered) + implementation. Structural claims
  all verified CLEAN (windowless hop, lock lifetime, call-site enumeration). Findings folded:
  **2.3** the hop transits `confirmAdvance`, so the threading is an internal-only 5th param (the
  ConfirmPayload alternative was HTTP-injectable — rejected); **2.7** spec_only/fast hop the same
  seam → mode-agnostic + AC 2d; **2.4** `lintCodes` null-narrowing; **2.6** lint-skip and
  preflight-skip share ONE guard so they cannot diverge, and the spawn-proof moved to a no-.venv
  fixture (the linters.test.ts shim records script spawns only — it could not see the probe);
  **1.2/1.3** module-load consts kept (live-test.ts idiom parity; testable via per-file process +
  dynamic import), `TURN_TIMEOUT_MS` now exported, plus the orchestrator→runTurn wiring capture;
  **1.4** AC pins the note template, not bytes; **3.2** the two structural lists were variants —
  merged with the advanced-chat deltas inline; **3.3** implement.md's banner/heading had no test —
  docs-contract-pin extended. Implemented S1→S3; server suite 419 pass / 0 fail.

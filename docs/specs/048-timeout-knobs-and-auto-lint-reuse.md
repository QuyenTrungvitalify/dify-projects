# Spec 048 — Timeout knobs, auto-mode ④ lint reuse, implement.md de-accretion

**Status**: Draft — authored 2026-07-08, the second "optimize without touching quality" batch after
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
  3. `maybeAutoAdvance(task, ctx, opts?: { reuseLint?: LintCodes })`: ONLY the ③→④ hop inside the
     SAME dispatched request (which still holds the turn lock — no edit window exists) passes
     `verify.lintCodes` through to `runTestAndFinish` → `runReport` `opts.reuseLint`.
  4. `runReport` with `opts.reuseLint`: skips the 4 linter spawns (uses the codes verbatim) AND skips
     the preflight recompute (`task.preflightNote` is already fresh from the same ③ verify — 037 r2's
     recompute exists precisely for the gate-edit window this path does not have).
  5. Every path WITH a human window keeps the full re-run: each_step's ③-gate `continue`, the
     still_failing `accept`, every ④ `/reply` retry, and the import re-report. Their call sites simply
     don't pass `reuseLint`.
  Result equality is STRUCTURAL: same request, lock held, 039 reverts any foreign write mid-turn —
  there is nothing that could change the file between the two lint runs being merged.
- **D3 · implement.md de-accretion — editorial ONLY (locked).** Reorganize without adding/removing a
  single rule: (a) the mandatory-structural-elements list appears ONCE (the trivial branch references
  the custom branch's list instead of restating it); (b) step 4's mega-bullet splits into labeled
  sub-bullets (pattern-copy / custom-path / edit-seed / plugins&datasets / code nodes / if-else);
  (c) no change to the 🌐 banner, `## Output language`, the `{{KNOWLEDGE}}` line (byte-identity
  test pins it), the linter list (docs-pin test), or any MUST/NEVER wording. A before/after directive
  inventory is attached to the PR description as the review artifact.

## Non-goals

- **No** merging of the language banner + Output-language section + languagePin (the ~18–33%-of-body
  triplication): real preamble-regression risk in the owner's actively-tuned area → **OQ1**, owner's
  explicit call, separate change.
- **No** cap-5 lint-loop change (no field evidence it binds), no timeout default changes, no ④
  behavior change on ANY path with a human window, no SKILL.md/AGENTS.md trimming.

## Acceptance criteria

1. *(D1)* With no env set, the three timeouts equal today's values (assert the exported consts/read
   sites); with `BUILDER_TURN_TIMEOUT_MS=1000` a hung fake turn times out at ~1 s with the EXACT
   pre-048 timeout note text (pinned — 045's frames key off it).
2. *(D2)* Auto build (advance-loop harness): the stubbed `runReport` receives `opts.reuseLint`
   deep-equal to the ③ codes; a REAL `runReport` with `reuseLint` performs ZERO python lint spawns
   (shim-count = 0) and writes `report.json.lint` equal to the reused codes; `lintClean` verdict and
   notes byte-equal to a control run without reuse over the same fixture.
   - 2b (anti-gaming): each_step's ③-gate `continue` path still re-runs all 4 (shim-count = 4) — the
     window-bearing paths are pinned un-skipped.
   - 2c: the ④ `/reply` retry and the still_failing `accept` paths pass NO `reuseLint` (stub capture).
3. *(D2)* The linters.test.ts cross-consumer identity suite passes UNCHANGED (it calls `runReport`
   without opts — the contract that ③ and ④ agree is untouched).
4. *(D3)* implement.md: the structural-elements list occurs exactly once; every pre-048 MUST/NEVER/
   STOP directive string still present (inventory check); knowledge-inject byte-identity + docs-pin +
   language-banner tests green with zero edits.
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

- r1 (2026-07-08) — initial draft. Adversarial-review note: the subagent reviewer pool is
  quota-limited today (resets 04:40 JST); the D2 mechanics were verified inline against
  orchestrator.ts (the ③→④ hop runs inside the same lock-holding request; `runTestAndFinish`
  call sites enumerated: auto hop, each_step continue, still_failing accept, ④ /reply retry).

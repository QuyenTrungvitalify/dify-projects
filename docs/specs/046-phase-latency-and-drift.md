# Spec 046 — Phase latency & drift: drop the constant Analyze turn, fix ③'s empty `{{REQUIREMENT}}`, stop the 3rd pattern pick

**Status**: **Implemented** (2026-07-08, same day as authored — see r2). Focus per the owner: phase
QUALITY + WAIT-TIME — not the ④ live-loop (explicitly descoped: the owner's flow uses the test app
directly). Language scope per the owner (r1b): Japanese-first, English fallback.

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-08.

**Motivation (measured, from the review):**
- Every from-scratch STANDARD build spends a full model turn on Analyze writing a CONSTANT: the 027
  honesty rules force the seedless turn to emit `{"seed": null, "pattern": "custom"}` + one note line
  and STOP — MUST OMIT `find_query`, MUST NOT `change_points` (`analyze.md` seedless branch). Cost:
  ~40 s + a spawn + SKILL/AGENTS re-read + a 10-min timeout slot + one rubber-stamp gate. Spec 028
  rescued only the opt-in single-LLM subset; the 12-prompt campaign shape (from-scratch, standard) all
  pays it.
- `implement.md` uses `{{REQUIREMENT}}` (the 🌐 language banner + ## Output language) but
  `phases.ts` implement `injectVars` never injects it — the token renders as an EMPTY string, so the
  ③ language banner literally reads "written in the language of \`\` " even for Japanese builds. (The
  product's language scope per the owner: Japanese first, English fallback — `languagePin` stays
  kana-only by design.)
- The pattern is picked up to 3× per build (analyze → spec → implement re-pick), though SPEC.md — the
  human-approved contract ③ re-reads fresh — already records the choice (spec 028 measured find.py +
  pattern reads ≈ 40% of a phase's tool calls).
- Doc/contract drift with no pin: `test.md` documents 3 of 4 linters (3-key `lint` example);
  `report.ts` comments say "3 linters" while writing 4 keys; `spec.md` step 4 says slug `[a-z0-9_-]`
  vs its own Output-language section, `draft.md`, and `slug.ts` (`[a-z0-9_]`); UAT `00-README` §5
  ("fast always stops at Spec") contradicts `maybeAutoAdvance` under auto+fast.

**Builds on**: [027](027-analyze-findquery-truth-and-from-scratch-leanness.md) (the honesty rules that
make the seedless artifact a constant — D1 keeps them byte-identical, just backend-authored);
[028](028-builder-adaptive-phase-depth.md) (the skip-Analyze precedent + the fold machinery
`applyAnalysisToTask`); [030a](030-builder-content-language-sync.md)/the language-guard commits
(`languagePin` — kana-only, deliberately untouched here); [038](038-node-body-schema-linter.md) (the
4-linter contract test.md must match).

---

## Decisions

- **D1 · Backend-authored constant `analyze.json` for SEEDLESS STANDARD builds; start at Spec (locked).**
  In `startTask`, when `!task.seedAppId && !task.workflow && !task.fastMode`: the backend writes
  `.runs/<id>/analyze.json` with EXACTLY the 027-honest constant —
  `{"seed": null, "pattern": "custom", "note": "from-scratch build — nothing to analyze (backend-written, spec 046 D1)"}`
  (no `find_query`, no `change_points`, no guessed `features`) — sets `task.artifacts.analyze`, folds it
  via `applyAnalysisToTask`, then `runPhaseAndGate(task, 'spec', ctx)`. The Analyze turn AND its gate
  disappear for this shape (the 028 precedent; `spec.md` still receives `PRIOR_ARTIFACT` = the now-real
  analyze.json). SEEDED builds (dify-seed / edit-existing) keep the full Analyze turn — that is where
  its value (seed summary, change_points, pattern classification) actually lives. Fast mode unchanged.
  Effect: −1 model turn and −1 gate on every from-scratch standard build.
- **D2 · Inject `{{REQUIREMENT}}` into ③ (locked).** `phases.ts` implement `injectVars` gains
  `REQUIREMENT: t.requirement` — the banner/Output-language references stop rendering as ''. (The
  orchestrator comment claiming ③ "has no {{REQUIREMENT}} token" is corrected — the skill body grew
  one in the language-guard commits.)
- **D3 · Implement CONSUMES the Spec-approved pattern; no 3rd pick (locked).** `implement.md` step 2's
  standard branch is reworded: read the chosen pattern from `SPEC.md` (the human approved it at the
  gate); run `find.py` ONLY when SPEC.md names no usable pattern (or `custom` with no structural base).
  `spec.md` remains the single real picker (027's truth point). Saves the duplicated find.py + pattern
  reads inside the ③ turn.
- **D4 · Drift-pin batch (locked).** `test.md` gains the 4th linter + a 4-key `lint` example;
  `report.ts` stale "3 linters" comments → 4; `spec.md` slug charset unified to `[a-z0-9_]`
  (matching `slug.ts`); UAT `00-README` §5 corrected for auto+fast. NEW pin test (builder suite):
  every `LINTERS[].script` basename appears in BOTH `test.md` and `implement.md`, so a 5th linter
  can never silently miss the docs again.

## Non-goals

- **No** ④ live-loop changes (import-at-test_result, input form, triage split) — descoped by the owner.
- **No** new languages in `languagePin` — the product targets Japanese (kana pin) with English
  fallback, per the owner; Vietnamese/Korean/Chinese pins are explicitly out of scope.
- **No** de-triplication of the language banners — the owner is actively tuning that layer
  (banner + section + pin all landed within days); consolidation into `languagePin` is OQ2, not now.
- **No** draft.md/spec.md unification, no cap-5 change, no ④ lint-rerun skip (cheap since 017 D5).
- **No** change for seeded/fast builds' phase structure.

## Acceptance criteria

1. *(S1)* Seedless standard build: `startTask` emits NO analyze phase events — the first gate is Spec;
   `.runs/<id>/analyze.json` exists with the D1 constant (assert no `find_query`/`change_points` keys);
   `task.artifacts.analyze` set. Golden ladder (`golden-build.test.ts`) updated deliberately — the diff
   is REVIEWED, not mechanical (it pins the product's emission contract).
2. *(S1)* Seeded build (fake seedPath/workflow): the Analyze TURN still runs (runTurn called with the
   analyze prompt) and its gate still parks — pinned so D1 can't over-reach.
   - 2b: fast mode still runs draft.md and stops at Spec (028 unchanged).
3. *(S2)* The rendered ③ prompt CONTAINS the requirement text (knowledge-inject-style prompt capture);
   a JA requirement keeps the JA `languagePin` unchanged; plain English renders '' pin (kana-only
   behavior pinned — the scope is Japanese-first/English-fallback).
4. *(S3)* `implement.md` no longer unconditionally instructs a find.py re-pick (text assertion:
   the standard branch tells the model to read SPEC.md's pattern first).
5. *(S4)* Docs pin test: every `LINTERS[].script` basename appears in `test.md` AND `implement.md`
   (fails today for `lint_node_bodies.py` in test.md — red-first); slug charset `[a-z0-9_-]` no longer
   appears in `spec.md`; UAT §5 wording fixed.
6. Full suites green; no change to gate.ts, confirm modes, or any ④ behavior.

## Sequencing

- **S1** — D1 + golden/advance-loop ladder updates (the churn) + AC 1/2 tests.
- **S2** — D2 one-liner + AC 3 tests (languagePin untouched — kana-only pinned).
- **S3** — D3 implement.md rewording (prompt-only).
- **S4** — D4 drift batch + the pin test + spec index row.

## Open questions

- **OQ1** — consolidate the triplicated language directives (banner + section + pin) into the pin
  layer once the current tuning settles? Owner's call; measured by whether English preambles recur.
- **OQ2** — extend D1 to seeded-but-trivial edits later? Default: no — seeded Analyze earns its turn.

## Revision log

- r1 (2026-07-08) — initial draft (from the 4-phase review synthesis; anchors verified same day).
- r1b (2026-07-08) — owner scope call: language support is Japanese-first with English fallback —
  the Vietnamese `languagePin` decision removed (recorded in Non-goals); decisions renumbered
  (pattern-pick = D3, drift batch = D4). D2 ({{REQUIREMENT}} injection) retained — it is a
  language-independent bug (the JA banner itself renders a broken empty-token sentence).
- r2 (2026-07-08) — IMPLEMENTED S1→S4. Verification note: the adversarial review subagent died on a
  session-quota limit mid-review (the exact failure class spec 045 taught the Builder to surface),
  so its checklist was verified INLINE instead: (a) `applyAnalysisToTask` tolerates the D1 constant
  by documented design ("a pattern-less / feature-less analyze.json simply leaves the optional fields
  unset"; advisory=null for custom); (b) SPEC.md's "Chosen pattern" is a MANDATORY section (spec.md
  Output structure), so D3's read-from-SPEC is reliable; (c) blast radius = exactly the 5 predicted
  test files. Landed: D1 (startTask writes the 027-honest constant + folds + starts at Spec; golden
  ladder deliberately re-pinned WITHOUT analyze rows; new AC1/AC2 tests pin both sides — seedless
  skips, seeded keeps the turn); D2 (REQUIREMENT injected into ③ + the stale orchestrator comment
  fixed + render pinned via the knowledge-inject fixture); languagePin scope pinned kana→JA/EN→'' per
  r1b; D3 (implement.md consumes SPEC's Chosen pattern; find.py only as fallback); D4 (test.md 4th
  linter + 4-key example, report.ts comments 3→4, spec.md slug charset unified, UAT §5 corrected for
  auto+fast, and `docs-contract-pin.test.ts` — every LINTERS script must appear in test.md AND
  implement.md, slug charset pinned). Suites: server 404/404, tsc clean.

# Spec 055 — From-scratch Analyze does a lean requirement digest (that Spec reuses), not a skip

**Status**: **Implemented** (code e3ca64c 2026-07-09; test harnesses realigned 9ef5506 2026-07-10). **S–M**. The theme: spec 046 D1 made a from-scratch build's Analyze a backend-written
CONSTANT (no turn) because the old seedless Analyze could only write `{seed:null, pattern:custom}` — zero
information. This spec redefines that phase into something USEFUL: a **lean requirement digest** — a plain
"here's what I understood you want" overview the user can verify at the Analyze gate, surfaced as a proper
report card (even in `auto`). The 4-phase process is whole again (① is no longer an instant skip) and the
user gets a checkpoint on intent before a spec is drafted. Seeded builds keep their seed analysis and gain
the same overview on top. (Spec is left unchanged — the review dropped the "Spec reuses Analyze's pick"
optimization as too risky; OQ4.)

> **Reference the SYMBOL, not the line.** Anchors verified 2026-07-09.

**Supersedes / revises**: [046](046-phase-latency-and-drift.md) **D1** — 046 removed the seedless Analyze
turn because it "bought zero information" (a constant). That premise held for the *old* seed-summary prompt;
this spec gives the from-scratch turn a *different* job (requirement digest + pattern pick) that buys real
information, so the skip no longer applies. **Builds on**: [027](027-analyze-findquery-truth-and-from-scratch-leanness.md)
(the honesty rules — the digest must not invent a seed analysis; `find_query`/`features` stay truthful);
[028](028-builder-adaptive-phase-depth.md) (Fast mode's merged `draft.md` — untouched here; DEPTH stays the
lever); the `analyze.md`/`spec.md` skill bodies + `orchestrator.ts`'s 046 skip (`if (!fastMode && !seedAppId
&& !workflow)`) that D2 replaces; the Analyze-gate machinery (`computeGate`/`boundaryAutoAdvances`) the
restored gate reuses.

---

## Motivation — a whole process + an intent checkpoint, at a small honest cost

Two problems with the current from-scratch flow: (1) ① 分析 completes instantly (backend constant) so the
process *looks* skipped and the user has **no checkpoint to confirm the tool understood the request** before
a full spec is drafted; (2) the real requirement-analysis (pattern search, feature extraction) happens
inside Spec, invisibly. The user asked for a from-scratch Analyze that outputs a **short requirement digest
they can check** ("are these the points I actually want?"), and — if wrong — correct before Spec runs; and
for Spec to build **on top of** that digest.

046 D1 was right that a from-scratch Analyze writing a *constant* is waste. It is **not** waste when the turn
instead (a) restates the requirement as a checkable overview and (b) does the pattern/feature pre-work that
Spec would otherwise do. The honest trade-off (D5): this re-adds a turn, so wall-clock is ~neutral-to-slightly
-more — the win is **completeness + an intent checkpoint + often a better spec** (think-before-write), not
speed. This spec commits to that trade deliberately.

## Decisions

- **D1 · A user-checkable "requirement overview" — the common new output of Analyze (both modes) (proposed,
  committed).** Every Analyze turn (from-scratch AND seeded) leads its chat summary with a short, plain-language
  **overview**: the goal in one line, the **key requirements/constraints as bullets**, and the expected
  input→output — written for the USER to verify ("これらの理解で合っていますか？"). It is the intent
  checkpoint: at the Analyze gate the user confirms (Continue) or corrects (Request changes) BEFORE any spec
  is drafted. Language follows `{{REQUIREMENT}}` (the existing rule). This is prose in chat; the structured
  twin lives in `analyze.json` (D3).

- **D2 · From-scratch Analyze becomes a lean requirement-digest TURN (replaces the 046 D1 skip) (proposed,
  committed).** The `orchestrator.ts` short-circuit that backend-writes the constant for
  `!fastMode && !seedAppId && !workflow` is removed; that build now runs a real `analyze.md` turn on a
  **from-scratch branch**. Kept LEAN (it is not the seeded change-points analysis): it (1) writes the D1
  overview; (2) runs `find.py` once to pick the closest **pattern candidate** + the **features** the request
  needs; (3) sketches the **planned shape** (rough node list) — no seed to diff, so no `change_points`. It
  then parks at the **Analyze gate** (restored for from-scratch). `boundaryAutoAdvances` is unchanged: `auto`
  auto-confirms it (no stop), `each_step` stops for the user's D1 check, `spec_only` auto-confirms (it only
  stops at Spec). **Fast mode is untouched** — `fastMode` still routes to the merged `draft.md`; D2 is the
  standard path only.

- **D3 · The overview renders as an Analyze gate-card REPORT — in BOTH `auto` and `each_step` (proposed,
  committed).** Restoring the Analyze turn+gate (D2) means from-scratch gets the same gate card seeded builds
  already show (`gateAnalyzeBadge`/`Title`/`Summary` copy), whose body is the D1 overview — a proper "report
  box" like the Spec/Test gates, not an instant-empty ①. Critically it renders **even in `auto`**: `auto`
  auto-confirms the gate (no stop) but the RESOLVED Analyze gate card still lands in the thread (the same way
  every other phase's resolved card does), so an `auto` user can still scroll back and review the digested
  intent. `analyze.json` gains `overview`/`requirements` fields (all optional — `analysis.ts` reads it
  leniently, so the shape change is back-compat). The Spec phase is UNCHANGED — it still runs its own
  `find.py` pattern pick (see the dropped Spec-reuse idea, OQ4): keeping the authoritative pick in Spec avoids
  a lower-context Analyze pick degrading quality, especially under `auto` where no gate catches a bad pick.

- **D4 · Seeded Analyze keeps its analysis and gains the overview on top (proposed, committed).** For a
  seeded/edit-existing build, `analyze.md` is unchanged EXCEPT it prepends the D1 requirement overview above
  the existing seed summary + `change_points`. So the seeded user sees both "what you asked for" (overview)
  and "what the seed is + what changes" (current analysis). `analyze.json` gains the `overview`/`requirements`
  fields alongside the existing seed fields.

- **D5 · Honest cost: this is a completeness/reviewability change, NOT a speedup (proposed, committed).**
  From-scratch re-gains one `claude` turn (+ its spawn) and one gate — reversing 046 D1's saving. Because Spec
  is UNCHANGED (D3 — it still does its own pattern pick), the Analyze turn is a **net add**, not offset: total
  wall-clock is slightly more and tokens slightly up (the user's accepted "a bit more tokens"). The committed
  benefits are: the whole 4-phase process, an **intent checkpoint before spec** (the digest the user can
  confirm/correct), and a visible ① report card — in every mode. The spec states this plainly so nobody
  expects a speedup. (The would-be offset — Spec reusing Analyze's pick — is deferred as OQ4 because it risks
  degrading pick quality; see the review that dropped it.)

## Non-goals

- **Not a speedup** (D5) — do not sell it as faster; it trades a small time/token cost for completeness +
  reviewability + quality.
- **No change to Fast mode** (028): `draft.md` still merges Analyze+Spec for the trivial single-LLM path.
  (OQ1: optionally have `draft.md` lead with a one-line overview too.)
- **No change to the seeded change-points analysis** — only the overview is prepended (D4).
- **No new gate type** — the restored Analyze gate is the existing one; `boundaryAutoAdvances` untouched.

## Acceptance criteria

1. *(D2)* A from-scratch STANDARD build runs an Analyze TURN (not a backend constant): `.runs/<id>/analyze.json`
   has a real `overview`/`pattern`/`features` (assert `pattern` may be a real name, `find_query` present), and
   the build parks at the **Analyze gate** before Spec.
2. *(D1)* At the Analyze gate in `each_step`, the chat shows the requirement overview (goal + bullets + I/O);
   Request-changes re-runs Analyze; Continue advances to Spec.
3. *(D3)* The Analyze gate renders as a report card (badge + overview body) — and in `auto` the RESOLVED
   Analyze card still appears in the thread (the user can review the digest without a stop). Spec is unchanged
   (it still runs `find.py`).
4. *(D4)* A seeded build's Analyze output leads with the requirement overview, then the seed summary +
   `change_points` (both present).
5. *(D2)* `auto` auto-confirms the from-scratch Analyze gate (no stop); `spec_only` too; `each_step` stops.
6. Test pins updated: `advance-loop.test.ts` (from-scratch `runTurn` +1; the analyze gate re-appears),
   `golden-build.test.ts` (ladder), any 046 D1 assertions superseded. Server + web suites green.

## Sequencing

- **S1** — D2 orchestrator: drop the 046 skip so from-scratch routes through `runPhaseAndGate('analyze')` (the
  existing seeded path) + restore the Analyze gate. Update the ~24 046-pinned test assertions across the 6
  files (`runTurn` +1, the analyze gate re-appears). AC1/5.
- **S2** — D1/D3/D4 skill bodies + gate: `analyze.md` — the requirement-overview section (both modes) + the
  from-scratch digest branch (overview + find.py pattern + features + planned_nodes, no change_points); seeded
  keeps its analysis + prepends the overview. Confirm the Analyze gate card + its `auto` resolved render carry
  the overview (i18n `gateAnalyze*` already exists). Spec.md UNCHANGED. AC2/3/4.

## Open questions

- **OQ1** — Give Fast mode's `draft.md` a one-line overview too (so even the trivial path shows the intent
  check)? Cheap; lean yes as a follow-up.
- **OQ2** — Should the from-scratch overview also surface in `report.json` (so an `auto` run, which never
  showed the Analyze gate, still records the digested intent)? The `patternAdvisory`/`preflightNote`
  precedent — lean yes.
- **OQ3** — Cap the from-scratch Analyze turn's depth explicitly (a `DEPTH: overview` token) so it stays
  lean and cannot balloon into a full change-points pass? Recommend yes — keeps D5's cost bounded.
- **OQ4** — (Deferred from the original D3.) Have Spec REUSE the from-scratch `analyze.json` pick (skip its
  own `find.py`) to offset the Analyze turn's cost? Dropped from v1 in review: moving the authoritative
  pattern pick from full-context Spec to a lean Analyze, then trusting it, risks a worse pick — with no gate
  to catch it under `auto`. Revisit only if measured that (a) the Analyze pick matches Spec's quality and
  (b) Spec reliably honors the "don't re-pick" instruction (else it is the 046 pure-overhead failure mode).

## Revision log

- r1 (2026-07-09) — initial draft. Emerged from the "from-scratch skips 分析 too fast" thread: the user wants
  the whole process visible AND an intent checkpoint (a short requirement digest they can confirm before a
  spec is drafted), with Spec building on the digest. Chose to REDEFINE the seedless Analyze (a useful
  requirement digest that Spec reuses) rather than either keep 046 D1's skip or naively revert it — the digest
  buys real information (unlike 046's constant), so 046 D1's premise no longer holds. Committed honestly to
  D5: this is a completeness/reviewability/quality change, not a speedup (it re-adds a turn).

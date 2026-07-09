# Spec 054 — Reconcile the promote eligibility gate with the B5 blank-model convention

**Status**: **Implemented — unit-verified** (2026-07-09). **XS**. One-line theme: spec 050's promote
eligibility gate blocks a source whose LLM node has no model ("never ran"), but the Builder's **B5**
convention *deliberately* leaves every valid build's model empty (auto-filled at deploy/live-test) — so
that check false-negatives **every** from-scratch LLM build and makes it un-promotable. Fix: model-wiring
is **advisory (a warning), not a blocker**.

> Anchors verified 2026-07-09.

**Builds on**: [050](050-proven-build-to-reusable-pattern-promotion.md) (the `promote_gate.py check`
eligibility gate — this spec revises its **D3.3** model-wiring rule); [052](052-builder-promote-to-pattern.md)
(the Builder promote flow that surfaces the gate verdict at the `promote_blocked` gate); the **B5**
blank-model convention (`dify-io.ts` — workspace facts list enabled models but instruct the build *"do NOT
fill into the workflow; model stays empty, auto-injected at live test/deploy"*; `live-test.ts`
`deployWithModel` does the fill).

---

## Motivation — the check measures a signal B5 invalidates

Spec 050 D3.3 added a model-wiring check to the promote gate: every `type: llm` node in the source must
carry a present `provider`+`name`, on the rationale *"an unwired LLM step means this build never actually
ran."* That rationale is **false under B5**. B5 is the Builder's deliberate convention: a build **never**
bakes a model into the workflow file (the model is workspace-specific and would break a portable file);
instead the LLM node stays `provider: '' / name: ''` and is auto-filled from the real workspace at
deploy/live-test (`deployWithModel`). So under B5 an **empty model is the NORMAL state of a valid, proven
build** — not a "never ran" signal. Blocking on it false-negatives every from-scratch build that has an
LLM node (observed: a lint-clean ChatWork per-row-notify build was blocked from promotion purely on the
empty model).

Because B5 leaves the model empty **in the file** and `deployWithModel` fills only a **deploy copy**
(never the source), the source model is empty forever — so the D3.3 check can NEVER pass for a B5 build.
It is a pure false-negative machine, providing no real "proven" signal, only friction.

## Decisions

- **D1 · Model-wiring is ADVISORY, not blocking (proposed, committed).** `promote_gate.py`'s `gate()` moves
  the `check_model_wiring` result out of `reasons` (which sets `eligible: false`) into a new `warnings`
  list. An empty LLM model no longer blocks promotion; it is surfaced as a warning. `check_model_wiring`
  itself is unchanged (still reports the empty model — it now feeds the advisory). The eligibility verdict
  now rests on: the **4 linters** (structure/refs/hashes/bodies) + the **human review gate** (承認, the real
  backstop — nothing lands in `templates/patterns/` without a person) + the **import-probe** where creds
  exist (the real-Dify oracle). The gate's warning message is also de-jargoned (it is user-facing at the
  review gate): *"llm node … has an empty model … the model is auto-filled at deploy/live-test, so this does
  NOT block promotion — set + live-test a model first if you want a proven-runnable pattern."*

- **D2 · Carry `warnings` through the Builder verdict (proposed, committed).** `PromoteVerdict` gains
  `warnings?: string[]`; `promote.ts`'s `parseVerdict` reads it. The Builder does NOT force the warning into
  the `promote_review` gate note (it would be noise — a pattern's blank model is expected + TODO'd); the
  field is carried for logs and possible future surfacing.

## Non-goals

- **Not the probe-restoration.** The Builder promote path still strips `DIFY_*` (the "button never contacts
  Dify" design), so its import-probe stays `skipped` and `known_good_dify` stays empty. Making promote
  resolve a real model + run the real-Dify probe (Option D — reuse `resolveDefaultLlmModel`/`deployWithModel`/
  `importForTest` from live-test) is the higher-value **separate** follow-up (spec 052 OQ3); it reverses a
  deliberate design (Dify-free button) and is not needed to unblock promotion. Deferred, tracked as OQ1.
- **No change to the CLI `template-promote` path's other gates** — lint + probe (with creds) are untouched;
  only the model-wiring *block* is downgraded to a warning, everywhere the gate runs.

## Acceptance criteria

1. *(D1)* A source whose only defect is empty LLM `provider`/`name` → `gate()` returns `eligible: true`
   with the empty model in `warnings` (not `reasons`). Verified: `promote_gate.py check` on the
   previously-blocked `_drafts/json_id_json_chatwork_2` now prints `✓ ELIGIBLE` + a `⚠` warning.
2. *(D1)* A source with a real lint failure or a FAILED import-probe still blocks (`eligible: false`) —
   unchanged.
3. *(D2)* `PromoteVerdict.warnings` is parsed; server + web + python suites green.

## Sequencing

- **S1** (this) — `promote_gate.py` gate()→warnings + message + CLI print; `test_promote_gate.py` updated
  (empty-model → eligible+warning); `PromoteVerdict.warnings` + `parseVerdict`. Python 13/13, server
  456/456, web 167/167.

## Open questions

- **OQ1** — Restore the import-probe for the Builder promote path (Option D): resolve a real workspace
  model, gate + probe against it, populate `known_good_dify`. Higher value (real-Dify verification for
  promoted patterns) but reverses the Dify-free-button design + adds latency. Deferred — decide separately.

## Revision log

- r1 (2026-07-09) — implemented. Surfaced when a from-scratch ChatWork per-row-notify build (lint-clean,
  reused the promoted per-row-notify pattern) was blocked from promotion solely on its empty LLM model,
  which is the *expected* B5 state. Chose to downgrade the model-wiring block to a warning (Option A) over
  auto-resolving a real model (Option D) — A is the right-sized fix for the B5↔gate conflict; D bundles a
  separable design reversal (promote contacting Dify) and is deferred to OQ1.

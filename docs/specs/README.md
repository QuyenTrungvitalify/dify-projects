# Specs

Development specifications for `dify-projects`. Each spec is **drafted before implementation** to surface design decisions, tradeoffs, and open questions.

## Status meaning

- `Draft` — written, needs review + answer open questions
- `Approved` — open questions resolved, ready to implement
- `In progress` — implementation underway
- `Done` — merged + acceptance criteria verified
- `Implemented` — delivered: code merged + tests green (equivalent to `Done` for shipped specs)
- `Partially implemented` — some slices shipped, remainder named in the row
- `Parked` — authored but dormant; no active plan (revive or supersede explicitly)
- `Superseded` — replaced by another spec (links forward)

> Statuses in this index are verified against code + git log (2026-07-06). Headers inside older
> spec files may lag behind — the index is the roadmap surface; trust it over stale file headers.

## Index

| # | Title | Status | Effort |
|---|---|---|---|
| [001](001-multi-version-schema.md) | Multi-version schema infrastructure | Approved* | M |
| [002](002-agents-md.md) | `AGENTS.md` for AI coding agents | Approved | S |
| [003](003-variable-ref-linter.md) | Variable reference linter (`lint_refs.py`) | Approved | M |
| [004](004-ci-pipeline.md) | GitHub Actions CI | Approved | S |
| [005](005-qa-strategy.md) | QA strategy (round-trip, drift, canary) | Approved | — (meta) |
| [006](006-implementation-plan.md) | Master phased implementation plan | Approved* | — (meta) |
| [007](007-capability-docs-and-patterns.md) | Capability docs: pitfall log + plugin behavior matrix | Approved | S |
| [008](008-meta-workflow-builder.md) | Meta Workflow Builder (Dify-builds-Dify auto-generator) | Parked‡ | M |
| [009](009-browser-workflow-builder.md) | Dify Workflow Builder App (conversational, phased, human-gated) | Done† | L |
| [010](010-builder-ux-hardening.md) | Builder UX hardening (post-009 QA): cancellable builds, live confirm-mode, slug-collision guard | Done† | S |
| [011](011-builder-test-coverage-and-remediation.md) | Builder test coverage + review remediation (automated tests, CI compile, fix backlog) | Implemented | M |
| [012](012-builder-image-attachments.md) | Builder image attachments (drag/paste/picker → path-injection into the turn) | Implemented | S |
| [013](013-builder-linter-contract-and-test-seams.md) | Builder linter-contract unification + orchestrator test seams (keystone for 014–017) | Implemented | L |
| [014](014-builder-terminal-correctness-and-state-integrity.md) | Builder ④-terminal correctness + state & deploy-gate integrity (deploy-needs-confirm, no silent done-but-broken, idempotent import) | Implemented | M |
| [015](015-builder-security-turn-sandbox.md) | Builder security & turn-permission hardening (lightweight PreToolUse hook ported from nexus — closes the python-bypass/token/confinement chain; no server/queue) | Implemented | M |
| [016](016-builder-gate-ux-hardening.md) | Builder gate & 4-phase UX hardening (the always-reached deploy gate card, R7 crash-guard, Copy-YAML, safe/distinct affordances; frontend-only) | Implemented | S |
| [017](017-builder-prompt-linter-and-perf.md) | Builder skill-prompt + linter hardening & 4-phase performance (if-else cases check, plugin-TODO note, custom path, prose; parallel linters, memoized streaming) | Implemented | M |
| [018](018-builder-turn-write-allowlist.md) | Turn write-confinement allowlist (015 follow-up — a turn can no longer overwrite its own hook/orchestrator/settings to neuter the gate) | Implemented | S |
| [019](019-builder-output-quality-and-lean-roadmap.md) | Output-quality & lean roadmap (post-018 umbrella): reachability linter + pattern verification (better YAML), lean cleanup (delete accreted weight), no-disruption rollout discipline | Partially implemented (O1→020, L*/C* shipped; O3/O4 open) | — (meta) |
| [020](020-builder-graph-reachability-linter.md) | Graph-reachability linter (019 O1): BFS that every `{{#id.field#}}`/`value_selector` source is upstream-reachable — warn-only → measured → **promoted to hard gate** | Implemented | M |
| [021](021-builder-e2e-live-run-verification.md) | Builder E2E live-run verification (automated, creds-gated): Slice A output canary (import→run→assert), Slice B builder-driven ①→④ live (AC #15/#25) — discharges 011 R10 + 005 Tier 3 | Draft | L |
| [022](022-multi-source-template-library.md) | Multi-source curated template library: source registry (`corpus/sources.yml`) feeding N vendored corpora + a standardized curated tier joined by provenance + staleness detection (two-tier — auto-update the raw intake, assisted-promote the curated set) | Done | L |
| [023](023-intake-only-sources.md) | Intake-only sources (`indexed: false` registry flag): vendor + track + promote a corpus without indexing it (vendoring ≠ indexing) — used to keep a multilingual source promotable-but-unindexed; that Chinese source was later removed entirely | Implemented | XS |
| [024](024-reality-reconciliation-and-cross-cutting-gaps.md) | Reality reconciliation & cross-cutting gaps (post-022/023 umbrella): make docs match code/data (R0–R8), close the two green-but-broken cracks (CI-red, false "English-only"), shut the cheap real gaps (schema-honesty, gate the generator E2E, pin deps, hook fail-closed) — triaged hard, lean by construction | Done | — (meta) |
| [025](025-builder-file-attachments.md) | Builder file attachments: generalize 012 image-attach to PDF + the text family (validate by extension, generic file chip, `Attached files:` injection) — reuses Approach A path-injection wholesale; closes 012's "non-image" Non-goal | Implemented | S |
| [026](026-authoring-gate-completeness-and-truth.md) | Authoring-gate completeness & residual truth gaps (post-024): gate the #1 silent-failure class (non-numeric node IDs, N1), stop the validator crashing on malformed input (V1), make the "29 NodeData" schema claim honest (envelope-only, D1), fix the 12-vs-9 hook-count doc (D2), drop builder dead imports (L1) — strictly subtractive; read-confinement + schema-oneOf deferred as triggered forks | Implemented | S |
| [027](027-analyze-findquery-truth-and-from-scratch-leanness.md) | Truthful `find_query` + lean from-scratch Analyze | Done | S |
| [028](028-builder-adaptive-phase-depth.md) | Adaptive phase depth: fast mode (merged Analyze+Spec), `DEPTH` tiers | Implemented | M |
| [029](029-builder-new-task-into-existing-project.md) | New task into existing project (sidebar +) | Superseded → 030b `targetProject` | S |
| [030a](030-builder-content-language-sync.md) | Content language follows the requirement (P1 prompt directive, P2 JA note localization) | Implemented | S |
| [030b](030-builder-nested-project-workflow-folders.md) | Real nested `projects/<project>/<workflow>/` folders + subtree confinement (supersedes 029) | Implemented | M |
| [031](031-builder-create-project-modal-real.md) | Real Create-Project modal + `POST /api/projects` | Implemented | S |
| [032](032-builder-live-workflow-test.md) | Phase-④ live workflow test on real Dify (import→publish→run→judge) | Partially implemented (S1–S5 live; S6, S7-cross-ref open) | L |
| [033](033-builder-gate-qa-chat-mode.md) | Gate Ask mode: Q&A turn vs Request-changes, 2-layer write guard (`ask.ts`) | Implemented | M |
| [034](034-builder-test-gate-terminal-qa.md) | Ask at the ④ Test gates + terminal done/cancelled builds (`askTestWithin`) | Implemented | M |
| [035](035-builder-edit-again-from-done.md) | Edit-again entry from done/cancelled + thread persistence | Implemented | S |
| [036](036-builder-capability-aware-test-targets.md) | Capability-aware test targets (`difyTargets()`, Option-A retarget) | Implemented | M |
| [037](037-builder-runnability-preflight-and-workspace-facts.md) | Runnability preflight (③ advisory note) + workspace facts (`{{KNOWLEDGE}}`) — resolves 032 OQ3 | Implemented | M |
| [038](038-node-body-schema-linter.md) | Node-body schema linter: wire the 29 dormant `NodeData_*` $defs (`lint_node_bodies.py`) — measured 0-FP, promoted to 4th gate linter | Implemented | M |
| [039](039-post-turn-multi-workflow-lint.md) | Post-turn lint completeness: gate every turn-touched `workflows/*.ya?ml` + extension-twin hard error | Implemented | S |
| [040](040-builder-uat-fixes.md) | UAT hardening: confinement false-positive revert (concurrent-edit data loss) + composer-draft/reload/sidebar fixes | Implemented (D1–D4; E1–E4 deferred) | S |
| [041](041-builder-request-changes-everywhere.md) | "Request changes" available at every parked gate from Spec onward (fixable at any ④ gate incl. LIVE ⚠) | Implemented | S |
| [042](042-foreign-residue-preflight.md) | Foreign-residue preflight: demo/seed values (URLs, tool params, stale dataset/plugin ids) surviving into a build — 4 new advisory classes on the 037 machinery | Draft | S–M |
| [045](045-turn-failure-triage.md) | Turn-failure triage: classify claude-CLI deaths (usage limit / login / network / not installed) into actionable, JA-localized gate notes | Implemented | S |
| [046](046-phase-latency-and-drift.md) | Phase latency & drift: skip the constant Analyze turn (−1 turn/gate per from-scratch build), fix ③'s empty `{{REQUIREMENT}}`, no 3rd pattern pick, docs↔contract pin | Implemented | S–M |
| [047](047-builder-live-test-file-inputs-and-timeout-classification.md) | Live-test: file inputs đúng contract (file-object thay URL trần) + phân loại ReadTimeout-khi-streaming | Draft (root cause verified) | S |
| [048](048-timeout-knobs-and-auto-lint-reuse.md) | Timeout knobs (turn/ask/live-run env-configurable), ④ lint-reuse trên auto hop không cửa sổ sửa, implement.md de-accretion | Implemented (r2) | S |
| [049](049-dify-import-blocker-defense.md) | Chống import-blocker: linter mirror variable_factory (env/conversation vars), ④ import-probe hỏi Dify thật (advisory + orphan sweep), HUONG_DAN recovery qua Edit-again/Request changes | Implemented (r3) | S–M |
| [050](050-proven-build-to-reusable-pattern-promotion.md) | Proven build → pattern: promote_gate (lint+model-wiring+probe), kênh linter-candidate dedup, trục staleness known_good_dify, pattern per-row-notify đầu tiên | Implemented (r5) | M |
| [043](043-builder-live-test-model-optional-for-llm-less-workflows.md) | Live-test needs no workspace LLM model when the workflow has no LLM node (0-model gate conditional on `llm_count`) | Implemented | S |
| [053](053-builder-one-click-retry-out-of-error.md) | One-click "Retry phase" out of error: the reply-kind button only armed the composer (dead click) + 2 layers rejected empty text — fire a file-inclusive re-run on click (primary green ↻), steered retry still via dock; promote-error 409 pinned | Implemented — unit-verified (r3); AC7–9 manual pending | S |

\* Spec 001 + 006 have 2 minor Q awaiting confirm; can proceed with defaults.

† Spec 009/010 merged (builder Lát 0–6). Residual items tracked in [011](011-builder-test-coverage-and-remediation.md): 009 live-run verification of AC #15/#25 (R10), 010 F2-Part-B deferred.

‡ Spec 008: only the Phase-1 PoC landed (`templates/patterns/meta-workflow-builder.yml` + feasibility test); the browser builder (009) became the shipped path. Revive or supersede explicitly before investing further.

**Numbering collision (030)**: two files share number 030 — [030a content-language-sync](030-builder-content-language-sync.md) and [030b nested-folders](030-builder-nested-project-workflow-folders.md). Cross-references elsewhere say "spec 030" ambiguously; when citing, use the filename. New specs start at 037+.

## How to use

1. Read [005](005-qa-strategy.md) and [006](006-implementation-plan.md) first — context + ordering.
2. For each spec to implement, resolve "Open questions" → update Status: Approved → implement → tick acceptance criteria → Status: Done.
3. If reality diverges from spec during implementation, **update the spec** (don't silently drift).

## Spec template

```markdown
# Spec NNN — Title

**Status**: Draft
**Effort**: XS / S / M / L
**Depends on**: (list of other specs)

## Context
Why this exists, what problem we're solving.

## Goals
What success looks like.

## Non-goals
Out of scope.

## Design
Technical approach.

## Open questions
Decisions needed before implementation. Q1, Q2, ...

## Acceptance criteria
How to verify it works.

## References
Links, prior art.
```

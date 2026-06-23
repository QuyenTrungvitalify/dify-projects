# Specs

Development specifications for `dify-projects`. Each spec is **drafted before implementation** to surface design decisions, tradeoffs, and open questions.

## Status meaning

- `Draft` — written, needs review + answer open questions
- `Approved` — open questions resolved, ready to implement
- `In progress` — implementation underway
- `Done` — merged + acceptance criteria verified
- `Implemented` — delivered: code merged + tests green (used by 013–018, 020, 023; equivalent to `Done` for shipped specs)
- `Superseded` — replaced by another spec (links forward)

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
| [008](008-meta-workflow-builder.md) | Meta Workflow Builder (Dify-builds-Dify auto-generator) | Draft | M |
| [009](009-browser-workflow-builder.md) | Dify Workflow Builder App (conversational, phased, human-gated) | Done† | L |
| [010](010-builder-ux-hardening.md) | Builder UX hardening (post-009 QA): cancellable builds, live confirm-mode, slug-collision guard | Done† | S |
| [011](011-builder-test-coverage-and-remediation.md) | Builder test coverage + review remediation (automated tests, CI compile, fix backlog) | Approved | M |
| [012](012-builder-image-attachments.md) | Builder image attachments (drag/paste/picker → path-injection into the turn) | Approved | S |
| [013](013-builder-linter-contract-and-test-seams.md) | Builder linter-contract unification + orchestrator test seams (keystone for 014–017) | Implemented | L |
| [014](014-builder-terminal-correctness-and-state-integrity.md) | Builder ④-terminal correctness + state & deploy-gate integrity (deploy-needs-confirm, no silent done-but-broken, idempotent import) | Implemented | M |
| [015](015-builder-security-turn-sandbox.md) | Builder security & turn-permission hardening (lightweight PreToolUse hook ported from nexus — closes the python-bypass/token/confinement chain; no server/queue) | Implemented | M |
| [016](016-builder-gate-ux-hardening.md) | Builder gate & 4-phase UX hardening (the always-reached deploy gate card, R7 crash-guard, Copy-YAML, safe/distinct affordances; frontend-only) | Implemented | S |
| [017](017-builder-prompt-linter-and-perf.md) | Builder skill-prompt + linter hardening & 4-phase performance (if-else cases check, plugin-TODO note, custom path, prose; parallel linters, memoized streaming) | Implemented | M |
| [018](018-builder-turn-write-allowlist.md) | Turn write-confinement allowlist (015 follow-up — a turn can no longer overwrite its own hook/orchestrator/settings to neuter the gate) | Implemented | S |
| [019](019-builder-output-quality-and-lean-roadmap.md) | Output-quality & lean roadmap (post-018 umbrella): reachability linter + pattern verification (better YAML), lean cleanup (delete accreted weight), no-disruption rollout discipline | Draft | — (meta) |
| [020](020-builder-graph-reachability-linter.md) | Graph-reachability linter (019 O1): BFS that every `{{#id.field#}}`/`value_selector` source is upstream-reachable — warn-only → measured → **promoted to hard gate** | Implemented | M |
| [021](021-builder-e2e-live-run-verification.md) | Builder E2E live-run verification (automated, creds-gated): Slice A output canary (import→run→assert), Slice B builder-driven ①→④ live (AC #15/#25) — discharges 011 R10 + 005 Tier 3 | Draft | L |
| [022](022-multi-source-template-library.md) | Multi-source curated template library: source registry (`corpus/sources.yml`) feeding N vendored corpora + a standardized curated tier joined by provenance + staleness detection (two-tier — auto-update the raw intake, assisted-promote the curated set) | Done | L |
| [023](023-intake-only-sources.md) | Intake-only sources (`indexed: false` registry flag): vendor + track + promote a corpus without indexing it (vendoring ≠ indexing) — used to keep a multilingual source promotable-but-unindexed; that Chinese source was later removed entirely | Implemented | XS |
| [024](024-reality-reconciliation-and-cross-cutting-gaps.md) | Reality reconciliation & cross-cutting gaps (post-022/023 umbrella): make docs match code/data (R0–R8), close the two green-but-broken cracks (CI-red, false "English-only"), shut the cheap real gaps (schema-honesty, gate the generator E2E, pin deps, hook fail-closed) — triaged hard, lean by construction | Draft | — (meta) |

\* Spec 001 + 006 have 2 minor Q awaiting confirm; can proceed with defaults.

† Spec 009/010 merged (builder Lát 0–6). Residual items tracked in [011](011-builder-test-coverage-and-remediation.md): 009 live-run verification of AC #15/#25 (R10), 010 F2-Part-B deferred.

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

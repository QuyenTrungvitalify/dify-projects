# Specs

Development specifications for `dify-projects`. Each spec is **drafted before implementation** to surface design decisions, tradeoffs, and open questions.

## Status meaning

- `Draft` — written, needs review + answer open questions
- `Approved` — open questions resolved, ready to implement
- `In progress` — implementation underway
- `Done` — merged + acceptance criteria verified
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

\* Spec 001 + 006 have 2 minor Q awaiting confirm; can proceed with defaults.

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

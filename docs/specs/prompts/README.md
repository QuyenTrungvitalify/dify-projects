# Implementation Prompts

Copy-paste-ready prompts cho fresh AI agent session (Claude Code, Codex, etc.) để implement từng Phase.

> **Per-spec prompt sets:** the `Y*` files below are the original infra batch.
> Newer specs keep their step prompts in a subfolder: **[009/](009/)** — Spec 009 Dify
> Workflow Builder app (Lát 0–5).

## Order

| File | Phase | Effort | Depends on |
|---|---|---|---|
| [Y1-multi-version-schema.md](Y1-multi-version-schema.md) | Multi-version schema infrastructure | M (~3-4h) | — |
| [Y2-agents-md.md](Y2-agents-md.md) | AGENTS.md + self-test | S (~2h) | Y.1 |
| [Y3-lint-refs.md](Y3-lint-refs.md) | Variable reference linter | M (~3-4h) | — (parallel với Y.2 OK) |
| [Y4-cleanup.md](Y4-cleanup.md) | INDEX paths + refresh + agent node fix | S-M (~2h) | Y.1 |
| [Y5-ci-pipeline.md](Y5-ci-pipeline.md) | GitHub Actions CI | S (~3h) | Y.1, Y.3 |
| [Y6-optional-polish.md](Y6-optional-polish.md) | Optional QA depth (4 sub-tasks) | Variable | Y.5 |

## Sequence recommendation

```
Y.1 ──┬── Y.2 (parallel-able with Y.3)
      │
      ├── Y.3 (parallel-able with Y.2)
      │
      ├── Y.4 ─── Y.5 ─── Y.6 (optional)
      │
      └── (Y.4 + Y.5 can also run after Y.1 directly if skip Y.2/Y.3)
```

Minimum viable sequence: Y.1 → Y.2 → Y.3 → Y.4 → Y.5.

## How to use

1. Pick the Phase you want to implement.
2. Open a **fresh Claude Code session** (or Codex/Cursor/etc.).
3. Copy entire content of the prompt file as the first user message.
4. Agent reads the prompt, reads referenced specs, executes.
5. Agent commits locally (per prompt instructions — don't push until phase done unless prompt says otherwise).
6. Verify acceptance criteria checked.
7. Repeat for next Phase.

## Why fresh sessions

Each Phase is designed to be self-contained. Fresh session has:
- No prior conversation context to leak wrong assumptions
- Full context window available for the work
- Clean recovery if anything goes wrong

## When stuck

Each prompt has "On blocker" section. Common fallbacks:
- Document blocker in relevant spec under "Open questions"
- Pick a sensible default with reasoning
- Note choice in commit message
- Don't push until human reviews

## Maintenance

When specs evolve (Q resolved, decisions change), **update the relevant prompt file too** — they should stay in sync with specs.

# Spec 002 — `AGENTS.md` for AI coding agents

**Status**: Approved
**Effort**: S (~2h, includes self-test)
**Depends on**: 001 (multi-version) — vì AGENTS.md sẽ reference convention từ 001

## Decisions resolved
- Q2.1: Target 200 lines, hard cap 250
- **Q2.2**: **English primary** + 1 Vietnamese section ở đầu cho human team (user choice)
- Q2.3: `CLAUDE.md` = stub 1 dòng `Strictly follow ./AGENTS.md`
- Q2.4: Per-tool customization skip v1, add khi observed need
- Q2.5: Pre-commit hook check file refs còn valid (drift prevention)
- Q2.6: "Observed pitfalls" section empty initially, fill theo time

## Context

Repo hiện có:
- `README.md` (overview cho human)
- `docs/GUIDE.md` (574 dòng, operations cho human)
- `docs/architecture.md` (design rationale cho human)

**Không có** file dành riêng cho AI agent. Mỗi session, agent phải tự discover lại cấu trúc, conventions, commands → tốn token + sai pattern (vd: invent plugin hash, miss `# TODO:` markers).

[AGENTS.md](https://agents.md/) là format open được [Linux Foundation Agentic AI Foundation steward](https://agents.md/). Native support: Claude Code, OpenAI Codex CLI, Cursor, Aider, Devin, Sourcegraph Amp, Google Jules/Gemini CLI, Zed AI, GitHub Copilot Coding Agent, Windsurf, Amazon Q, …

**ETH Zurich finding (2026)**: human-curated AGENTS.md → +4pp task success; LLM-generated boilerplate → −3pp (tệ hơn không có). Keep it **short, observed-failure-driven, project-specific**.

## Goals

1. Single source of truth cho "how to build a workflow in this repo" mà mọi AI agent đọc khi mở project.
2. Bắt được các failure mode phổ biến: invented plugin hash, bypass `generate_id.py`, miss DSL version match, edit files trong `skills/` (read-only).
3. Project-specific, không boilerplate generic.
4. Compact (150-250 lines) — ETH study findings.
5. Cross-tool — Claude Code đọc trực tiếp, Codex/Cursor/etc. cũng đọc.

## Non-goals

- Tutorial / educational content (đã có ở GUIDE.md)
- Generic Dify documentation (đã có ở `skills/mango-svip/`)
- Replace README.md hay GUIDE.md — chỉ complement
- Per-tool customization (Claude-specific tips lẫn lộn với generic) — chú trọng phần generic
- Step-by-step pattern walkthroughs

## Design

### Files tạo

```
AGENTS.md                          # ~180-220 lines, primary file
CLAUDE.md → AGENTS.md              # Symlink (Claude Code reads both, prefers AGENTS.md)
```

### AGENTS.md outline

```markdown
# AGENTS.md — for AI coding agents

> Universal context for AI tools (Claude Code, Codex CLI, Cursor, ...).
> Complements README.md (overview) and docs/GUIDE.md (operations).

## 1. What this repo is — and is NOT
(1 paragraph, 3 sentences max)

## 2. MUST-DO before any task
- Read docs/GUIDE.md section 3 (Anatomy of Dify Workflow YAML)
- Run scripts/setup.sh if skills/ or corpus/ empty
- Check which project: ls projects/
- Check target DSL version: cat projects/<slug>/.dify-workspace.yaml
- NEVER edit skills/* or corpus/* (gitignored read-only clones)

## 3. Building a new workflow — exact 5-step sequence
[Concrete commands, copy-pasteable]
1. Scaffold project
2. Find closest pattern via find.py
3. Generate IDs via generate_id.py
4. Copy pattern + customize TODOs
5. Validate

## 4. Conventions agents trip on
### Node IDs
- Unix timestamp ms string, quoted
- Iteration-start: <iter_id>start (no underscore)
- ALWAYS use generate_id.py, NEVER invent

### Variable references
- {{#<node_id>.<field>#}}
- <field> MUST be in source node's outputs
- <node_id> MUST be reachable upstream
- Typo here = #1 import failure
- Run lint_refs.py (pre-commit catches automatically)

### Plugin hashes
- Format: <provider>/<plugin>:<version>@<sha256>
- sha256 is REAL, workspace-specific, NEVER fabricate
- For new patterns: leave dependencies: [] empty + add # TODO

### DSL version
- Every workflow MUST have version: matching project's .dify-workspace.yaml dsl_version
- check_dsl_version.sh enforces (pre-commit)

### Code nodes
- code_language: python3
- def main(<args>) -> dict
- Sandbox = stdlib + whitelist only
- Handle None/empty defensively

## 5. DO NOT
[Concrete list, 8-12 items]
- Invent plugin sha256 hashes
- Mix DSL versions in one project
- Create patterns without # TODO: markers
- Commit envs/*.env (gitignored except .example)
- Edit INDEX.md by hand
- Use pip install directly (use scripts/setup.sh)
- Use --no-verify on git commit
...

## 6. When stuck — discovery commands
[Concrete shell commands]
- Look up node schema: grep -A 30 ... node_types.md
- Find examples: python3 tools/dify_base/find.py --has X
- See project state: ls projects/<slug>/workflows/

## 7. Test commands
- pytest tests/
- DIFY_PROJECT=X pytest tests/
- pre-commit run --all-files
- Manual validate one file: skill validator, schema check

## 8. Where to find what
[2-column table: Need → Location]
- Operations → docs/GUIDE.md
- Architecture → docs/architecture.md
- Specs → docs/specs/
- Node schema → skills/mango-svip/references/node_types.md
- 51+ examples → corpus/awesome-dify-workflow/DSL/
- Pattern starting points → templates/patterns/
- JSON Schema → schemas/dify-dsl-*.json (per project's dsl_version)
```

### Self-test plan

Sau khi merge AGENTS.md:

1. Open fresh Claude Code session in clean clone of repo.
2. Prompt: "Create a new Dify workflow project for an English-to-Japanese translation task with file upload."
3. Observe:
   - Agent reads AGENTS.md (claude code should auto-load)?
   - Agent uses `init_project.py` correctly?
   - Agent picks closest pattern (`multi-step-llm.yml` or `file-iteration.yml`)?
   - Agent uses `generate_id.py` (not random IDs)?
   - Agent leaves plugin hash empty with `# TODO:`?
   - Agent runs `validate_workflow.py` before claiming done?
   - Total errors / iterations?
4. Document outcome in `docs/specs/002-agents-md-self-test.md` (separate file, evolving)
5. Refine AGENTS.md based on observed failures

## Open questions

**Q2.1**: Length cap strict hay guideline?
- ETH study: short = better, but "short" undefined
- Đề xuất: target 200 lines, hard cap 250

**Q2.2**: AGENTS.md ngôn ngữ — English, Vietnamese, hay mixed?
- Pro EN: cross-tool maxim compatibility, agents trained mostly EN
- Pro VN: team Vietnamese, README hiện mixed VN/EN
- Đề xuất: English primary (cho agents) + 1 section Vietnamese ngắn ở đầu cho human

**Q2.3**: CLAUDE.md handling — symlink hay stub file?
- (a) `ln -s AGENTS.md CLAUDE.md` → 1 source of truth, nhưng Windows clone có thể vỡ symlink
- (b) `CLAUDE.md` chứa 1 line `Strictly follow ./AGENTS.md`
- (c) Cả 2: full CLAUDE.md content + AGENTS.md trùng lặp (drift risk)
- Đề xuất: (b) — 1 line stub, đơn giản, không vỡ trên Windows

**Q2.4**: Per-tool overrides (Claude Code skills, Cursor rules)?
- Bao gồm trong AGENTS.md hay file riêng (`.claude/`, `.cursorrules`)?
- Đề xuất: AGENTS.md generic; chỉ tạo per-tool file khi có observed need (vd Claude Code workflow build skill nếu cần expand)

**Q2.5**: Audit cycle — AGENTS.md dễ stale khi repo phát triển. Cách prevent drift?
- (a) Manual review mỗi major commit
- (b) Pre-commit hook check AGENTS.md đề cập tools/conventions hiện hành (regex check existence of mentioned files)
- (c) AI-generated update suggestions trong CI
- Đề xuất: (b) — automated check minimum, manual review khi cần

**Q2.6**: Should we include observed AI failure examples ("Last week agent X did Y wrong — avoid by Z")?
- ETH study supports observed-failure-driven content
- Nhưng failures chưa được log meaningfully — chưa có data
- Đề xuất: leave empty section "Observed pitfalls" — fill over time

## Acceptance criteria

- [ ] AGENTS.md present at root, 150-250 lines
- [ ] CLAUDE.md exists (symlink or stub)
- [ ] All commands in AGENTS.md actually work (validated by running each)
- [ ] All file references valid (no 404 links)
- [ ] Self-test: 1 fresh-session agent uses ONLY AGENTS.md to build a workflow → succeeds without reading GUIDE.md
- [ ] Lint: pre-commit hook (optional) checks AGENTS.md mentions existing files
- [ ] No conflict with README.md or GUIDE.md (no contradictory advice)

## References

- [agents.md](https://agents.md/) — official spec
- [Anthropic Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices) — CLAUDE.md guidance
- [HumanLayer: Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md) — "keep it short"
- [BuildBetter: AGENTS.md complete guide 2026](https://blog.buildbetter.ai/agents-md-complete-guide-for-engineering-teams-in-2026/)
- ETH Zurich 2026 study (cited in external review) — +4pp human-curated vs −3pp LLM-generated
- Related: Spec 001 (conventions referenced), Spec 003 (lint_refs.py referenced)

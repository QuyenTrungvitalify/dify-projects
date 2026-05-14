# Implementation Prompt — Phase Y.2: AGENTS.md

> Copy-paste vào fresh session.

---

You are implementing **Phase Y.2 — AGENTS.md** for `dify-projects` repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST**: `docs/specs/002-agents-md.md`
- Reference for content: `README.md`, `docs/GUIDE.md`, `docs/architecture.md`
- Decisions baked into spec: EN primary + 1 VN section, target 200 lines (cap 250), CLAUDE.md = stub

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git log -1 --oneline       # Y.1 commit should be present
git status                 # clean
```

## Mission

Write `AGENTS.md` at repo root — the single source of truth for AI agents about how to work in this repo. Compact (200 lines target), observed-failure-driven, project-specific. Plus `CLAUDE.md` 1-line stub.

## Tasks

### Y2.1 — Write `AGENTS.md`

Location: `/Users/quyenbt/Desktop/MyProjects/dify-projects/AGENTS.md`

Structure (from spec 002 section "AGENTS.md outline"):

```
# AGENTS.md
> (Vietnamese 2-3 line intro for human team)
> Universal context for AI tools. Complements README + docs/GUIDE.md.

## 1. What this repo is — and is NOT
## 2. MUST-DO before any task
## 3. Building a new workflow — exact 5-step sequence
## 4. Conventions agents trip on
   ### Node IDs
   ### Variable references
   ### Plugin hashes
   ### DSL version
   ### Code nodes
## 5. DO NOT
## 6. When stuck — discovery commands
## 7. Test commands
## 8. Where to find what
## 9. Observed pitfalls
   (empty section, fill over time)
```

**Content guidelines**:

- **VN intro** (3-5 lines): 1 đoạn ngắn explaining đây là AI context file, không phải human docs. Direct human readers tới README.md / GUIDE.md.
- **English from section 1 onwards**: be terse, command-driven, copy-pasteable.
- **5-step sequence**: must match what `init_project.py` + `find.py` + `generate_id.py` actually do today (verify by running each).
- **Conventions section**: lift from `docs/GUIDE.md` section 3 + 7, but condense. Focus on failure-prone bits (plugin hashes, var refs, node IDs).
- **DO NOT list**: 8-12 items, observed-or-anticipated failures.
- **Test commands**: must actually work today. Verify each with `--help` or dry-run.
- **Where to find what**: 2-column table, 10-15 entries.

### Y2.2 — Write `CLAUDE.md`

Location: `/Users/quyenbt/Desktop/MyProjects/dify-projects/CLAUDE.md`

Content: exactly 2 lines:
```markdown
# CLAUDE.md
Strictly follow the rules in [AGENTS.md](AGENTS.md).
```

Do NOT use symlink — symlinks break on Windows clones.

### Y2.3 — Cross-link from existing docs

Update `README.md`:
- In the top "Quick start" section, add a line:
  ```
  > 🤖 **AI agents**: see [AGENTS.md](AGENTS.md) — universal context file.
  ```

Update `docs/GUIDE.md`:
- In the first paragraph (after `> Tóm tắt nhanh...`), add:
  ```
  > AI agents: read [../AGENTS.md](../AGENTS.md) first — concise context.
  ```

### Y2.4 — Baseline self-test (manual, document)

After writing AGENTS.md, do ONE self-test:

1. Open a fresh Claude Code session (new context, no prior conversation memory)
2. Give it this task: "Create a new Dify workflow project for translating English markdown documents to Japanese, preserving code blocks. Show me the workflow YAML."
3. Observe & record:
   - Did the agent read AGENTS.md before doing anything?
   - Did it use `init_project.py`?
   - Did it pick a pattern from `templates/patterns/`?
   - Did it use `generate_id.py`?
   - Did it leave plugin hash empty with `# TODO:`?
   - Did it run `validate_workflow.py` before claiming done?
   - Total turns / errors / iterations
4. Document outcome in new file `docs/specs/002-agents-md-self-test.md`:
   ```markdown
   # AGENTS.md self-test log

   ## Run 1 — 2026-MM-DD
   **Task**: ...
   **Agent**: Claude Code (Opus 4.7)
   **AGENTS.md commit**: <hash>

   ### Observations
   - [x] Read AGENTS.md before task — yes/no
   - [x] Used init_project.py — yes/no
   - [x] ...

   ### What went well
   ...
   ### What failed
   ...
   ### AGENTS.md updates needed
   - [ ] Clarify section X about Y
   ```

5. Iterate AGENTS.md based on observations (1-2 rounds OK).

### Y2.5 — Pre-commit hook for AGENTS.md drift (optional, Q2.5)

If time: add a pre-commit hook that grep's AGENTS.md for file/path references and verifies they exist:

```yaml
# .pre-commit-config.yaml — append
- id: agents-md-refs
  name: AGENTS.md references valid
  entry: scripts/check_agents_refs.sh
  language: script
  files: ^(AGENTS\.md|scripts/check_agents_refs\.sh)$
  pass_filenames: false
```

Where `scripts/check_agents_refs.sh` parses backtick-quoted paths and `[text](path)` links in AGENTS.md, verifies each path exists relative to repo root.

If pressed for time: skip Y2.5, document in spec as "deferred".

## Acceptance criteria

- [ ] `AGENTS.md` exists, 150-250 lines
- [ ] All file paths in AGENTS.md verified to exist (use `grep -oE` + `test -e`)
- [ ] All commands in AGENTS.md actually work (run each `--help` or dry-run)
- [ ] No factual contradiction with README.md or docs/GUIDE.md (manual cross-read)
- [ ] `CLAUDE.md` exists, 2 lines, points to AGENTS.md
- [ ] README + GUIDE cross-link added
- [ ] Self-test run done, results logged in `docs/specs/002-agents-md-self-test.md`
- [ ] If self-test surfaced issues: AGENTS.md updated, second run done OR issues logged for later
- [ ] `pre-commit run --all-files` green
- [ ] `pytest tests/` still passes

## NOT in scope

- Per-tool customization files (`.cursorrules`, `.aider.conf.yml`, `.claude/skills/`) — deferred per Q2.4
- Full automation of self-test (manual is fine per Q5.3)
- Translating entire GUIDE.md to English
- Adding "observed pitfalls" content (section exists but starts empty)

## Commit

```
Phase Y.2: AGENTS.md + CLAUDE.md

[describe]

Self-test: <pass/needs-iterate>
- Run 1 logged at docs/specs/002-agents-md-self-test.md

Refs: docs/specs/002-agents-md.md
```

DO NOT push. Local only.

## On blocker

If AGENTS.md keeps growing past 250 lines: cut sections that duplicate GUIDE.md. AGENTS.md = rules, GUIDE.md = explanations.

If self-test fails badly (agent ignores AGENTS.md, generates random workflow): log to `002-agents-md-self-test.md` + STOP. Do not invent fixes — escalate to spec review.

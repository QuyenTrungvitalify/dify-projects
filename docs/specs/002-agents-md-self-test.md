# AGENTS.md self-test log

Tracks fresh-session agent runs against AGENTS.md to validate it works as intended.
Each run captures *what the agent actually did* — not what it should have done.

## Run 1 — 2026-05-14

**Task**: "Create a new Dify workflow project for translating English markdown documents
to Japanese, preserving code blocks. Show me the workflow YAML."

**Agent**: Claude (general-purpose subagent, fresh context, only AGENTS.md to start)
**AGENTS.md state**: introduced in this commit (parent: 7866f98)
**Test constraints**: no git, no push; allowed to write a real `projects/md_en2ja/` for traceability.

### Observations (raw — paraphrased from agent's structured report)

Order of operations actually performed:
1. `ls` repo root → confirmed AGENTS.md present
2. Read AGENTS.md end-to-end first (before any other file)
3. Listed `templates/patterns/`, `projects/`, `tools/dify_base/`, `skills/.../scripts/`
4. Read `.dify-dsl-version` (= 0.6.0) and `.dify-tag` (= 1.13.0)
5. `find.py --list-features` to confirm features
6. Read `templates/patterns/multi-step-llm.yml` in full (chosen as base)
7. `init_project.py --non-interactive --slug md_en2ja ...`
8. `generate_id.py 5` (5 fresh timestamp-ms IDs)
9. Sanity-validated unmodified pattern (baseline pass)
10. Grepped `corpus/` for a real `code` node example to confirm `outputs:` YAML shape (not strictly documented in AGENTS.md §4.5)
11. Wrote `projects/md_en2ja/workflows/main.yml` (Start → Code-mask → LLM-translate → Code-restore → End)
12. `validate_workflow.py` → ✅ pass on first write

### Checklist results

- [x] Read AGENTS.md before any other task work
- [x] Used `init_project.py` to scaffold (no hand-created folders)
- [x] Picked a pattern from `templates/patterns/` (chose `multi-step-llm.yml`)
- [x] Used `generate_id.py` for node IDs (no invented IDs)
- [x] Left plugin hash empty with `# TODO:` comment (`dependencies: []`)
- [x] Ran `validate_workflow.py` before claiming done
- Iteration count: ~13 tool calls, 1 round (no retries)
- Errors / fixups: none — validator passed on first attempt

### What went well

- AGENTS.md was read first, ahead of any code exploration. The 5-step sequence in §3 was followed in order.
- Pattern choice (`multi-step-llm` for a translation task) matched §3's priority ladder (`templates/patterns/` first).
- `# TODO: add plugin hash from target workspace` comment appeared exactly where §4.3 told it to.
- DSL version (`0.6.0`) was sourced from `.dify-workspace.yaml` written by `init_project.py`, not from a constant — matches §4.4.
- No fabricated node IDs, no hand-edited INDEX.md, no `--no-verify`.

### What failed

Nothing functional. The workflow validated on the first write.

### AGENTS.md updates suggested by the agent

1. **§4.5 (Code nodes)** — does not show the exact `outputs:` YAML shape (map of name → `{type, children}`).
   The agent had to grep `corpus/` to learn this. Adding a 4-line snippet would save that grep.
   → **Decision**: minor, defer. AGENTS.md is rules, not schema. The discovery path (grep node_types.md or corpus) is documented in §6 and worked. Adding more YAML inline risks growing the file past the 250-line cap.

2. **§4.1 (Node IDs)** — edge IDs follow `<source_id>-source-<target_id>-target` but are unquoted scalars,
   while node IDs are quoted strings. Worth calling out explicitly.
   → **Decision**: minor, defer. Did not cause an error in this run. Re-evaluate if a future run trips on it.

3. **§3** mentions pre-commit as the final step; in this test session `git` was forbidden so pre-commit
   was not run, but that is a test-environment artifact, not an AGENTS.md issue.

### Decision: do not iterate AGENTS.md this round

The self-test passed cleanly on the first write. The 3 observations above are quality-of-life, not
correctness gaps. AGENTS.md is meant to grow from *observed failures*, not anticipated ergonomics
(ETH study finding cited in spec 002). Park the suggestions; re-evaluate after Run 2 if the same
issues recur.

# Implementation Prompt — Phase Y.1: Multi-version schema

> Copy-paste này vào fresh Claude Code session (hoặc agent khác). Self-contained briefing.

---

You are implementing **Phase Y.1 — Multi-version schema infrastructure** for the `dify-projects` repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST**: `docs/specs/001-multi-version-schema.md` (full design + decisions)
- Also helpful: `docs/specs/006-implementation-plan.md` (master plan)
- Architecture context: `docs/architecture.md`

## Pre-flight checks

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git status                          # must be clean
git log -1 --oneline                # latest is 2342fb0 (or later)
.venv/bin/pytest tests/ -q          # baseline: 9 passed, 2 skipped
```

If `.venv` missing or skills/corpus empty → run `./scripts/setup.sh` first.

## Mission

Make schema validation work per-project with multiple Dify versions. Today: single `schemas/dify-dsl-0.6.0.json` pinned to Dify source at `~/Desktop/MyProjects/dify-workspace/`. Target: vendored Dify source at pinned tag, per-project DSL version declaration, multi-schema autocomplete in VS Code.

## Tasks (Y1.1 → Y1.5)

### Y1.1 — Vendor Dify source via setup.sh

1. Add `vendor/` to `.gitignore` (entry: `vendor/`)
2. Add `.dify-tag` file at repo root containing `1.13.0` followed by a trailing newline (pre-commit `end-of-file-fixer` requires it). **Commit this file** — pins target version per repo.

   ⚠ **Critical**: v1.13.0 is **last Dify tag with full monolithic source** under `api/core/workflow/nodes/`. From v1.13.1 onwards, Dify refactored most node types into separate `graphon` package, leaving only 7 nodes inline. Pinning to anything ≥ v1.13.1 will break gen_schema (produces 0-7 NodeData instead of 25+). See spec 001 section "Dify graphon refactor".
3. Modify `scripts/setup.sh`:
   - Accept `--dify-tag <tag>` flag (default: read from `.dify-tag` if exists, fallback `main`)
   - Add new step BEFORE current step [1/4]: clone `https://github.com/langgenius/dify.git` into `vendor/dify-src/` at the specified tag (`--depth=1 --branch <tag>`)
   - If `vendor/dify-src/` already exists with different tag: print warning + skip (don't auto-pull; user can manually `cd vendor/dify-src && git fetch && git checkout <tag>`)
   - If offline / clone fails: print warning, continue (schemas/gen_schema.py will skip)
4. Keep existing `--skip-venv` and `--skip-clones` flags working.
5. Update help text.

### Y1.2 — `gen_schema.py` auto-derive output filename

Currently `gen_schema.py` writes `schemas/dify-dsl-<version>.json` where `<version>` comes from source's `CURRENT_DSL_VERSION` constant. This already works — but default `--dify-src` is `~/Desktop/MyProjects/dify-workspace/`.

Change:
1. Default `--dify-src` to `vendor/dify-src/` relative to repo root.
2. If `vendor/dify-src/` doesn't exist, fall back to old path with deprecation warning.
3. After write, also update/create symlink `schemas/_latest.json` → `dify-dsl-<X>.json` (the latest one written).
4. If the output file already exists with identical content: print "no change, skipping" and skip write.
5. If existing file has different content: print diff summary (first 10 lines diff), prompt confirmation. With `--yes` flag: auto-overwrite. (Add `--yes` arg if not present.)

### Y1.3 — Per-project DSL version

Modify `templates/_base/project/.dify-workspace.yaml`:

```yaml
project:
  name: "{{project_name}}"
  slug: "{{project_slug}}"
  app_type: "{{app_type}}"
  dsl_version: "{{dsl_version}}"     # Already there, keep
  dify_tag: "{{dify_tag}}"           # NEW
```

Modify `tools/dify_base/init_project.py`:
1. Add `dify_tag` to `Answers` dataclass.
2. Auto-populate from repo's `.dify-tag` file (read at runtime).
3. Add to interactive prompt as informational (just confirm, not editable — show the repo default).

### Y1.4 — `check_dsl_version.sh` reads per-project config

Currently `scripts/check_dsl_version.sh` reads `ls schemas/dify-dsl-*.json | head -1` for expected version. Change to:

1. For each file passed: detect which project owns it (walk up parents looking for `.dify-workspace.yaml`).
2. Read `project.dsl_version` from that file (use Python for YAML parse — no `yq` dep).
3. For files NOT in a project (e.g., `templates/patterns/`): use default from `.dify-tag` mapping (need a lookup: `.dify-tag` value → DSL version). Easiest: also keep a `.dify-dsl-version` file at root pinning the default DSL version (1 line, e.g., `0.6.0`). Commit it.
4. Compare against `version:` field in the workflow YAML. Fail with clear message if mismatch.

**Test cases**:
- `templates/patterns/file-iteration.yml` (`version: 0.6.0`) + root `.dify-dsl-version` = `0.6.0` → pass
- Create test project with `dsl_version: 0.7.0` + workflow with `version: 0.6.0` → fail with project-aware error

### Y1.5 — `.vscode/settings.json` generator

Currently hardcoded:
```json
{"yaml.schemas": {"./schemas/dify-dsl-0.6.0.json": ["projects/*/workflows/*.yml", ...]}}
```

If only 1 schema exists: keep as-is. If multiple schemas exist (multi-version scenario):
1. Write `scripts/regen_vscode_settings.py` that:
   - Scans `schemas/dify-dsl-*.json` to get version list
   - Scans `projects/*/.dify-workspace.yaml` to get per-project `dsl_version`
   - Generates `.vscode/settings.json` with file-pattern mapping per project
   - `templates/patterns/*.yml` mapped to default schema (root `.dify-dsl-version`)
2. Call this from `init_project.py` after scaffolding new project.
3. Call from `setup.sh` final step.

Generated example:
```json
{
  "yaml.schemas": {
    "./schemas/dify-dsl-0.6.0.json": [
      "templates/patterns/*.yml",
      "projects/eiken_legacy/workflows/*.yml"
    ],
    "./schemas/dify-dsl-0.7.0.json": [
      "projects/new_app/workflows/*.yml"
    ]
  }
}
```

Commit the regenerated `.vscode/settings.json` (it's checked in for team consistency).

## Acceptance criteria (must verify before commit)

- [ ] `./scripts/setup.sh --skip-venv --skip-clones` still works (no regression)
- [ ] `./scripts/setup.sh --dify-tag 1.14.0` clones `vendor/dify-src/` at tag 1.14.0 (verify with `cd vendor/dify-src && git describe`)
- [ ] `.venv/bin/python schemas/gen_schema.py` defaults to `vendor/dify-src/`, produces `schemas/dify-dsl-0.6.0.json` (or whatever `CURRENT_DSL_VERSION` in v1.14.0 source is)
- [ ] Re-running `gen_schema.py` says "no change" if source unchanged
- [ ] `python3 tools/dify_base/init_project.py --non-interactive --name "Test Y1" --slug test_y1` creates project with `dsl_version` + `dify_tag` populated correctly
- [ ] After scaffolding new project, `.vscode/settings.json` regenerated (verify file pattern includes new project path)
- [ ] `scripts/check_dsl_version.sh templates/patterns/file-iteration.yml` passes (uses root default)
- [ ] Create project with mismatched `dsl_version` → `check_dsl_version.sh` on its workflow fails with project-aware error
- [ ] `.venv/bin/pytest tests/ -q` still: 9 passed, 2 skipped (no regression)
- [ ] `pre-commit run --all-files` still green

## NOT in scope (don't do these)

- Auto-migration of YAML between DSL versions (Spec 005 future)
- Implementing `tools/dify_base/lint_refs.py` (that's Phase Y.3)
- Writing `AGENTS.md` (that's Phase Y.2)
- GitHub Actions CI (Phase Y.5)
- Changing existing patterns' `version: 0.6.0` (still current)
- Refreshing Dify source (that's Phase Y.4 — for now, vendor is created but stays at 1.14.0 tag)

## Cleanup test artifact

Setup.sh test might create `projects/test_y1/`. Delete before final commit:
```bash
rm -rf projects/test_y1
```

## Commit

Single commit with message:

```
Phase Y.1: multi-version schema infrastructure

[describe what changed]

Acceptance verified:
- [tick each item from list above]

Refs: docs/specs/001-multi-version-schema.md
```

DO NOT push (user wants local commits until Y.1 done; then will push).

## On blocker

If you hit an unexpected design question not covered by spec 001:
1. STOP — don't guess
2. Document the question in `docs/specs/001-multi-version-schema.md` under "Open questions" as Q1.N
3. Pick a default that matches spec's "Decisions resolved" tone
4. Note your choice + reasoning in the commit message

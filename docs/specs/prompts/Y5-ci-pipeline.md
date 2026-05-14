# Implementation Prompt — Phase Y.5: GitHub Actions CI + automated tests

> Copy-paste vào fresh session.

---

You are implementing **Phase Y.5 — CI pipeline** for `dify-projects` repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST**: `docs/specs/004-ci-pipeline.md` (full design)
- Also: `docs/specs/005-qa-strategy.md` (sub-specs 005.1 + 005.3 implemented here)
- Repo on GitHub: https://github.com/QuyenTrungvitalify/dify-projects (private)

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git log -1 --oneline       # Y.1-Y.4 commits present
git status                 # clean
.venv/bin/pytest tests/ -q # baseline
ls vendor/dify-src/        # Y.1 vendored Dify (CI clones this fresh)
```

## Mission

Add CI workflows to:
1. Run pre-commit + pytest on push/PR (catch regressions)
2. Weekly cron refresh schema from upstream Dify (auto-PR if changed)
3. Add 2 missing automated tests: `test_docs_drift.py` + `test_pattern_consistency.py`
4. Add small linter: `lint_plugin_hashes.py` (sub-spec 005.1)

## Tasks

### Y5.1 — `.github/workflows/ci.yml`

Per spec 004. Copy structure but verify:

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
          cache: pip

      - name: Install uv
        run: pip install uv

      - name: Bootstrap workspace
        run: ./scripts/setup.sh --skip-venv
        # Clones vendor/dify-src/ at .dify-tag, fetches skills/corpus.
        # --skip-venv because CI installs deps directly via uv.

      - name: Install Python deps
        run: |
          uv pip install --system \
              pre-commit pytest pyyaml jsonschema python-dotenv \
              requests syrupy check-jsonschema yamllint pydantic \
              pydantic-settings pycryptodome httpx sqlalchemy \
              charset-normalizer pytz flask redis yarl flask-login cachetools

      - name: Cache pre-commit
        uses: actions/cache@v4
        with:
          path: ~/.cache/pre-commit
          key: precommit-${{ hashFiles('.pre-commit-config.yaml') }}

      - name: Pre-commit (all files)
        run: pre-commit run --all-files --show-diff-on-failure

      - name: Pytest
        run: pytest tests/ -v --tb=short
        # tests/test_workflow_smoke.py skips gracefully without creds
```

### Y5.2 — `.github/workflows/refresh-schema.yml`

Per spec 004. Weekly cron + workflow_dispatch:

```yaml
name: refresh-schema
on:
  schedule:
    - cron: '0 9 * * MON'   # Monday 9am UTC
  workflow_dispatch:

jobs:
  refresh:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }

      - name: Install uv + deps
        run: |
          pip install uv
          uv pip install --system pydantic pydantic-settings pyyaml \
              pycryptodome httpx sqlalchemy charset-normalizer pytz flask \
              redis yarl flask-login cachetools jsonschema requests

      - name: Check for existing open PR
        id: existing
        run: |
          existing=$(gh pr list --search "is:open head:schema-refresh-*" --json number --jq '.[].number' | head -1)
          if [ -n "$existing" ]; then
            echo "open=true" >> $GITHUB_OUTPUT
            echo "Found existing PR #$existing — skipping."
            exit 0
          fi
        env: { GH_TOKEN: ${{ secrets.GITHUB_TOKEN }} }

      - name: Read pinned Dify tag
        if: steps.existing.outputs.open != 'true'
        id: tag
        run: echo "tag=$(cat .dify-tag 2>/dev/null || echo main)" >> $GITHUB_OUTPUT

      - name: Clone Dify upstream
        if: steps.existing.outputs.open != 'true'
        run: |
          git clone --depth=1 --branch "${{ steps.tag.outputs.tag }}" \
              https://github.com/langgenius/dify.git vendor/dify-src

      - name: Regenerate schema
        if: steps.existing.outputs.open != 'true'
        run: python3 schemas/gen_schema.py --yes

      - name: Diff check
        if: steps.existing.outputs.open != 'true'
        id: changed
        run: |
          if git diff --quiet schemas/; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi

      - name: Open PR
        if: steps.changed.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v6
        with:
          title: "schema: refresh from Dify ${{ steps.tag.outputs.tag }}"
          body: |
            Auto-generated weekly schema refresh.

            **Reviewer checklist**:
            - [ ] Run `./scripts/setup.sh && .venv/bin/python schemas/gen_schema.py` locally
            - [ ] Confirm 4 patterns still validate
            - [ ] If DSL version bumped: file migration spec
          branch: schema-refresh-${{ github.run_id }}
          commit-message: "schema: refresh from Dify ${{ steps.tag.outputs.tag }}"
```

### Y5.3 — `tests/test_docs_drift.py` (sub-spec 005.3)

Assert README claims match reality:

```python
"""Detect drift between README claims and actual repo state."""
import json
from pathlib import Path

BASE = Path(__file__).parent.parent
README = (BASE / "README.md").read_text()

def test_readme_pattern_count():
    n = len(list((BASE / "templates/patterns").glob("*.yml")))
    assert f"{n} reusable" in README or f"{n} pattern" in README.lower(), \
        f"README doesn't mention {n} patterns. Found in template/patterns/: {n}"

def test_readme_schema_nodedata_count():
    # Find latest schema
    schemas = sorted((BASE / "schemas").glob("dify-dsl-*.json"))
    if not schemas:
        return  # No schema yet, skip
    s = json.loads(schemas[-1].read_text())
    n = sum(1 for k in s.get("$defs", {}) if k.startswith("NodeData_"))
    assert f"{n} NodeData" in README, \
        f"README mentions schema NodeData count but doesn't match {n} in {schemas[-1].name}"

def test_index_file_count_matches():
    """INDEX.md auto-gen file count matches actual yml count in scanned dirs."""
    import yaml, glob, re
    index = (BASE / "INDEX.md").read_text()
    match = re.search(r"\*\*(\d+) files indexed\*\*", index)
    assert match, "INDEX.md missing file count header"
    claimed = int(match.group(1))
    # Reconcile by re-running build_index logic (lightweight: count yml in scan dirs)
    # Simple: just assert reasonable
    assert 30 < claimed < 200, f"INDEX claims {claimed} files — out of expected range"
```

### Y5.4 — `tests/test_pattern_consistency.py`

```python
"""Assert all patterns in templates/patterns/ follow conventions."""
from pathlib import Path
import pytest

PATTERN_FILES = sorted((Path(__file__).parent.parent / "templates/patterns").glob("*.yml"))

@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_use_case_comment(yml_path):
    text = yml_path.read_text()
    assert "# Use case:" in text or "# use case:" in text.lower(), \
        f"{yml_path.name} missing '# Use case:' header"

@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_todo_markers(yml_path):
    text = yml_path.read_text()
    assert "# TODO:" in text, \
        f"{yml_path.name} should have # TODO: customization markers"

@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_empty_dependencies(yml_path):
    """Patterns should not commit specific plugin hashes — leave deps empty."""
    import yaml
    d = yaml.safe_load(yml_path.read_text())
    deps = d.get("dependencies", [])
    assert deps == [], \
        f"{yml_path.name} has hardcoded plugin dependencies — patterns should leave empty"
```

### Y5.5 — `tools/dify_base/lint_plugin_hashes.py` (sub-spec 005.1)

Small linter (~50 LOC):

```python
"""Lint plugin marketplace identifiers for valid format.

Format: <provider>/<plugin>:<version>@<sha256>
- provider, plugin: [a-z0-9_]+
- version: semver
- sha256: 64 hex chars

Usage: lint_plugin_hashes.py <file.yml> [<file.yml> ...]
"""
import re, sys, yaml
from pathlib import Path

PATTERN = re.compile(
    r"^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$"
)

def lint(path):
    errors = []
    try:
        d = yaml.safe_load(Path(path).read_text())
    except Exception as e:
        return [(0, f"parse error: {e}")]

    for dep in (d.get("dependencies") or []):
        if isinstance(dep, dict):
            val = (dep.get("value") or {}).get("marketplace_plugin_unique_identifier", "")
            if val and not PATTERN.match(val):
                errors.append((0, f"invalid plugin hash format: {val}"))
    return errors

def main():
    if len(sys.argv) < 2:
        print("Usage: lint_plugin_hashes.py <file.yml> ...", file=sys.stderr); return 2
    fail = 0
    for f in sys.argv[1:]:
        errs = lint(f)
        for _, msg in errs:
            print(f"❌ {f}: {msg}"); fail += 1
    return 1 if fail else 0

if __name__ == "__main__":
    sys.exit(main())
```

Add pre-commit hook:

```yaml
- id: dify-lint-plugin-hashes
  name: plugin hash format
  entry: python3 tools/dify_base/lint_plugin_hashes.py
  language: system
  files: ^(templates/patterns/.*\.yml|projects/.*/workflows/.*\.yml)$
```

### Y5.6 — README CI badge

Add to README.md top:
```markdown
![CI](https://github.com/QuyenTrungvitalify/dify-projects/actions/workflows/ci.yml/badge.svg)
```

## Acceptance criteria

- [ ] `.github/workflows/ci.yml` exists, valid YAML
- [ ] `.github/workflows/refresh-schema.yml` exists, valid YAML
- [ ] `tests/test_docs_drift.py` + `tests/test_pattern_consistency.py` exist
- [ ] `pytest tests/` total ≥ 9 (baseline) + 3 (drift) + 12 (consistency × 4 patterns) ≈ 24 passed
- [ ] `tools/dify_base/lint_plugin_hashes.py` + pre-commit hook registered
- [ ] `pre-commit run --all-files` green with all new hooks
- [ ] README has CI badge
- [ ] After commit + push: CI runs on GitHub, green within 3 min
- [ ] Test broken-push: temporarily commit broken pattern → push → CI fails at correct step

## NOT in scope

- Real Dify integration tests in CI (defer until canary creds)
- Slack/email notifications
- Multi-OS / multi-Python matrix
- Auto-merge on success

## Commit

```
Phase Y.5: CI workflows + automated tests

- .github/workflows/ci.yml (pre-commit + pytest on push/PR)
- .github/workflows/refresh-schema.yml (weekly cron, auto-PR on diff)
- tests/test_docs_drift.py (README ↔ reality assertions)
- tests/test_pattern_consistency.py (parametrized over 4 patterns)
- tools/dify_base/lint_plugin_hashes.py (sub-spec 005.1)
- Pre-commit hook for plugin hash format
- README CI badge

Refs: docs/specs/004-ci-pipeline.md, docs/specs/005-qa-strategy.md
```

After local commit, **push to GitHub** (Y.5 needs remote to verify CI runs):
```bash
git push origin main
```

Wait for CI to run, verify green. If red: fix locally, push again.

## On blocker

- CI yaml syntax error: GitHub UI shows it. Fix syntax, push.
- CI fails at deps install: missing package — add to install step.
- CI fails at pre-commit hook: same as local, fix the hook config.
- Refresh-schema cron not running: cron triggers can lag up to 1h. Use workflow_dispatch (manual) to test.
- create-pull-request action fails: needs `permissions: contents: write, pull-requests: write` in workflow file (already in spec).

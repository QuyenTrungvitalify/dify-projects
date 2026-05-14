# Implementation Prompt — Phase Y.3: Variable reference linter

> Copy-paste vào fresh session.

---

You are implementing **Phase Y.3 — Variable reference linter (`lint_refs.py`)** for `dify-projects` repo.

## Repo & specs

- Working directory: `/Users/quyenbt/Desktop/MyProjects/dify-projects`
- **READ FIRST**: `docs/specs/003-variable-ref-linter.md` (full design with edge cases + algorithm)
- Reference: `skills/mango-svip/references/node_types.md` (node output schemas, esp. implicit ones)
- Skill validator for comparison: `skills/mango-svip/scripts/validate_workflow.py`
- Existing pre-commit setup: `.pre-commit-config.yaml`

## Pre-flight

```bash
cd /Users/quyenbt/Desktop/MyProjects/dify-projects
git log -1 --oneline       # Y.1 + Y.2 commits should be present
git status                 # clean
.venv/bin/pytest tests/ -q # baseline
```

## Mission

Build `tools/dify_base/lint_refs.py` — cross-checks `{{#node_id.field#}}` references in Dify workflow YAMLs. Catches lỗi import #1: typo in node ID or field name. Plus `value_selector: [id, field]` array form (same semantics, different syntax).

## Tasks

### Y3.1 — Implement `tools/dify_base/lint_refs.py`

~150-180 LOC. Stdlib + pyyaml only.

**Algorithm** (per spec 003):
1. Parse YAML, walk `workflow.graph.nodes[]`
2. Build `{node_id: set(field_names)}` map via `collect_outputs(node)` — per-node-type knowledge:

| Node type | Output fields source |
|---|---|
| `start` | `data.variables[].variable` |
| `code` | `data.outputs` dict keys |
| `llm` | implicit: `{text, usage, finish_reason}` |
| `http-request` | implicit: `{body, status_code, headers, files}` |
| `tool` | implicit: `{text, files, json}` |
| `document-extractor` | implicit: `{text}` |
| `knowledge-retrieval` | implicit: `{result}` |
| `parameter-extractor` | `data.parameters[].name` |
| `question-classifier` | implicit: `{class_name, class_id}` |
| `agent` | implicit: `{text, usage}` |
| `variable-aggregator`, `variable-assigner` | `data.variables[].variable` |
| `iteration` | implicit: `{output}` + `data.output_selector[-1]` if present |
| `template-transform` | implicit: `{output}` |
| `list-operator` | implicit: `{result}` |
| Unknown | `set()` — skip validation, log warning to stderr |

3. Find refs via regex: `\{\{#([^.#}]+)\.([^.#}]+)#\}\}`
4. Skip special namespaces: `conversation`, `env`, `sys` (workspace state, not graph nodes)
5. For iteration body: refs like `{{#<iter_id>.item#}}` or `{{#<iter_id>.item.<field>#}}` — treat `item` as always valid (opaque per Q3.1 lenient default)
6. Also check `value_selector: [node_id, field]` arrays (Q3.4) — same validation

### Y3.2 — Test fixtures

Create `tests/fixtures/lint_refs/`:

```
tests/fixtures/lint_refs/
├── valid_simple.yml           # Valid refs, exit 0
├── valid_iteration.yml        # Iteration body refs ({{#iter.item#}}), exit 0
├── valid_special_ns.yml       # Uses conversation.X / env.Y, exit 0
├── bad_node_id.yml            # {{#nonexistent.text#}}, exit 1
├── bad_field_name.yml         # {{#start_node.wrongfield#}}, exit 1
├── bad_value_selector.yml     # value_selector: [wrong, field], exit 1
├── mixed_errors.yml           # 3+ broken refs, exit 1 with count=3+
└── code_with_string_ref.yml   # Python code field contains literal "{{# #}}"
                                # — false-positive expected per Q3.3
```

Each fixture is a minimal but valid Dify YAML.

### Y3.3 — Write `tests/test_lint_refs.py`

Parametrized over fixtures:

```python
import pytest
from pathlib import Path
import subprocess

FIXTURES_DIR = Path(__file__).parent / "fixtures/lint_refs"
TOOL = Path(__file__).parent.parent / "tools/dify_base/lint_refs.py"

EXPECTED = {
    "valid_simple.yml": 0,
    "valid_iteration.yml": 0,
    "valid_special_ns.yml": 0,
    "bad_node_id.yml": 1,
    "bad_field_name.yml": 1,
    "bad_value_selector.yml": 1,
    "mixed_errors.yml": 1,
    "code_with_string_ref.yml": 1,  # current decision: treat as ref (Q3.3)
}

@pytest.mark.parametrize("fname,expected_exit", list(EXPECTED.items()))
def test_lint_refs(fname, expected_exit):
    result = subprocess.run(
        ["python3", str(TOOL), str(FIXTURES_DIR / fname)],
        capture_output=True, text=True,
    )
    assert result.returncode == expected_exit, \
        f"{fname}: expected exit {expected_exit}, got {result.returncode}\n{result.stdout}\n{result.stderr}"

def test_lint_refs_no_args():
    result = subprocess.run(["python3", str(TOOL)], capture_output=True)
    assert result.returncode == 2  # usage error

def test_lint_refs_file_not_found():
    result = subprocess.run(
        ["python3", str(TOOL), "/nonexistent/file.yml"],
        capture_output=True,
    )
    assert result.returncode != 0
```

### Y3.4 — Pre-commit hook

Add to existing `repo: local` block in `.pre-commit-config.yaml` (alongside `dify-skill-validate`, `dify-dsl-version-guard`, `agents-md-refs`):

```yaml
      - id: dify-lint-refs
        name: variable reference linter
        entry: python3 tools/dify_base/lint_refs.py
        language: system
        files: ^(templates/patterns/.*\.yml|projects/.*/workflows/.*\.yml)$
        require_serial: false
```

(Place inside existing `repo: local` block, alongside `dify-skill-validate` and `dify-dsl-version-guard`.)

### Y3.5 — Baseline run on corpus

```bash
.venv/bin/python tools/dify_base/lint_refs.py corpus/awesome-dify-workflow/DSL/*.yml > /tmp/lint_corpus.log 2>&1
```

Count flagged files. Log result to `docs/specs/003-lint-refs-baseline.md`:

```markdown
# lint_refs.py baseline run

Date: 2026-MM-DD
Corpus version: <git rev of corpus clone>

## Stats
- Files scanned: 51
- Files with ≥1 issue: NN (NN%)
- Total issues: NN

## Sample flagged
- file.yml:line: <issue>
- ...

## False-positives identified
- (manually inspect first 10 flagged files; any that are actually valid get noted here)

## Action
- [ ] False-positive rate ≤5% → ship
- [ ] If >5%: tune algorithm before shipping
```

If false-positive rate > 5%: investigate + tune `collect_outputs` mapping.

## Acceptance criteria

- [ ] `lint_refs.py` ~150-180 LOC, runs in <1s per file
- [ ] All 8 fixtures pass expected exit codes
- [ ] `pytest tests/test_lint_refs.py -v` → 8+ passed
- [ ] `pytest tests/` overall: 9 baseline + 8 new = ≥17 passed (or 9 passed + 8 lint passed)
- [ ] Run on `templates/patterns/*.yml` (4 files) → exit 0
- [ ] Run on corpus → false-positive rate ≤5% (per Q3.5 + baseline doc)
- [ ] Pre-commit hook registered, `pre-commit run --all-files` runs lint_refs as a step
- [ ] `pre-commit run --all-files` green overall
- [ ] Output format: `path:line: {{#X.Y#}} → <reason>` (clear, grep-able)
- [ ] Exit codes: 0 clean, 1 errors, 2 usage/parse error

## Edge cases to handle

1. **Multi-line YAML strings**: refs inside `|` block scalars or `>` folded — scan whole text, not just structured fields
2. **Iteration body**: `{{#1700.item#}}` and `{{#1700.item.subfield#}}` — both valid (lenient)
3. **Conversation vars**: `{{#conversation.foo#}}` — skip, valid by definition
4. **Env vars**: `{{#env.API_KEY#}}` — skip
5. **Sys vars**: `{{#sys.user_id#}}`, `{{#sys.files#}}` — skip
6. **`value_selector` arrays**: `value_selector: ['1700', 'text']` — also validate (same logic)
7. **Unknown node types**: skip with stderr warning (forward-compat per Q3.2)
8. **YAML parse error**: exit 2 with clear "{file}: parse error — {detail}"

## NOT in scope

- Type checking refs (vd field `connect: int` ref returning stub) — separate concern
- Auto-fixing typos — too dangerous
- Multi-file holistic check (refs across files) — Dify YAMLs are self-contained
- Heuristic Python-string-boundary detection in code nodes (Q3.3 default: treat all as refs)

## Commit

```
Phase Y.3: variable reference linter

Implements tools/dify_base/lint_refs.py per spec 003. Cross-checks
{{#X.Y#}} references and value_selector arrays against per-node-type
output schemas. Catches Dify import error class #1.

- 8 fixtures, 8 tests, all pass
- Baseline corpus run: <N>/51 flagged (<X>% false-positive after review)
- Pre-commit hook integrated as the next local hook (after `dify-skill-validate`, `dify-dsl-version-guard`, `agents-md-refs`)

Refs: docs/specs/003-variable-ref-linter.md
```

DO NOT push.

## On blocker

If false-positive rate on corpus > 10% even after tuning:
1. Log examples to baseline doc
2. Mark Y3.4 hook with `# TODO: tune` and disable temporarily
3. Open issue / spec update for follow-up
4. Ship lint_refs.py but NOT pre-commit hook

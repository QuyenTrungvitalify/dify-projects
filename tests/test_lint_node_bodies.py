"""Tests for tools/dify_base/lint_node_bodies.py (spec 038 P1).

Fixture-driven exit-code tests mirror tests/test_lint_refs.py (subprocess via sys.executable —
the tool is exercised across the process boundary exactly as pre-commit / the builder gate run
it). Drift tests (spec 038 D2) bind TYPE_TO_DEF ↔ the pinned schema ↔ lint_refs.IMPLICIT_OUTPUTS,
and AC 6 pins the root `Node.data` envelope so nobody "helpfully" wires the `$ref`s into a hard
gate mid-rollout.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "lint_node_bodies"
TOOL = Path(__file__).parent.parent / "tools" / "dify_base" / "lint_node_bodies.py"
SCHEMA = Path(__file__).parent.parent / "schemas" / "dify-dsl-0.6.0.json"

sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "dify_base"))

EXPECTED: dict[str, int] = {
    "valid_real_shape.yml": 0,  # AC 2: undeclared keys (type/selected/isInIteration) pass — open additionalProperties
    "bad_missing_required.yml": 1,  # AC 1: llm without prompt_template
    "bad_nested_ref.yml": 1,  # AC 1b: model missing provider — only the nested ModelConfig $def catches it
    "skip_defless_and_error.yml": 0,  # AC 3: assigner (no def) + http-request (_error stub) warn-skip
    "demoted_required.yml": 1,  # AC 2: required missing → gates by default (see demote test below)
    "bad_malformed_node.yml": 2,  # AC 4: non-dict node → structured error
    "escape_hatch.yml": 0,  # AC 9: column-0 allow-marker suppresses the node's findings
    "escape_forged.yml": 1,  # AC 9: the same marker INDENTED inside a block scalar must NOT suppress
}


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args], capture_output=True, text=True
    )


@pytest.mark.parametrize("fname,expected_exit", list(EXPECTED.items()))
def test_exit_codes(fname: str, expected_exit: int) -> None:
    result = run_tool(str(FIXTURES_DIR / fname))
    assert result.returncode == expected_exit, (
        f"{fname}: expected exit {expected_exit}, got {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_missing_required_message_names_node_and_field() -> None:
    """AC 1: the finding carries a path:line prefix, the node id, the type, and the field."""
    result = run_tool(str(FIXTURES_DIR / "bad_missing_required.yml"))
    assert result.returncode == 1
    line = next(l for l in result.stdout.splitlines() if "prompt_template" in l)
    assert "bad_missing_required.yml:" in line, "path prefix present"
    # path:line: — a digit follows the fixture path's colon (the llm node's own line)
    after_path = line.split("bad_missing_required.yml:", 1)[1]
    assert after_path.split(":", 1)[0].isdigit(), f"line number attributed: {line}"
    assert "'1700000000002'" in line and "(llm)" in line, line


def test_nested_ref_finding_has_nested_json_path() -> None:
    """AC 1b: the defect is inside the nested ModelConfig $def — json_path proves the nested
    resolution ran (a top-level-only validator emits no finding at all for this fixture)."""
    result = run_tool(str(FIXTURES_DIR / "bad_nested_ref.yml"))
    assert result.returncode == 1
    assert "$.model" in result.stdout and "provider" in result.stdout, result.stdout


def test_defless_and_error_skips_warn_on_stderr() -> None:
    """AC 3: exactly two skip warnings (assigner def-less, http-request _error), both stderr."""
    result = run_tool(str(FIXTURES_DIR / "skip_defless_and_error.yml"))
    assert result.returncode == 0
    warnings = [l for l in result.stderr.splitlines() if "skipping body validation" in l]
    assert len(warnings) == 2, result.stderr
    assert any("assigner" in w for w in warnings) and any("http-request" in w for w in warnings)
    assert result.stdout.strip() == "", "skips are warnings, not findings"


def test_error_skip_is_schema_derived_not_hardcoded(tmp_path: Path) -> None:
    """AC 3b (anti-gaming): un-stub HttpRequestNodeData in a COPY of the schema and pass it via
    --schema — the same http-request node must now be VALIDATED (a finding appears). A hard-coded
    `if type == 'http-request': skip` passes AC 3 but fails this."""
    schema = json.loads(SCHEMA.read_text())
    schema["$defs"]["NodeData_HttpRequestNodeData"] = {
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"],
    }
    patched = tmp_path / "patched-schema.json"
    patched.write_text(json.dumps(schema))
    result = run_tool("--schema", str(patched), str(FIXTURES_DIR / "skip_defless_and_error.yml"))
    assert result.returncode == 1, f"http-request now validated:\n{result.stdout}\n{result.stderr}"
    assert "url" in result.stdout and "http-request" in result.stdout


def test_demote_flag_downgrades_required_to_warning() -> None:
    """AC 2 (D3 seam): --demote DEF:FIELD turns that missing-required into a stderr warning,
    exit 0. DEMOTED_REQUIRED ships empty — every future row must cite the P2 report."""
    result = run_tool(
        "--demote", "NodeData_LLMNodeData:context", str(FIXTURES_DIR / "demoted_required.yml")
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert "context" in result.stderr and "demoted" in result.stderr
    assert "context" not in result.stdout


def test_malformed_input_never_tracebacks() -> None:
    """AC 4 (V1 rule): non-dict node and non-YAML input → structured one-line error, exit 2."""
    result = run_tool(str(FIXTURES_DIR / "bad_malformed_node.yml"))
    assert result.returncode == 2
    assert "Traceback" not in result.stdout + result.stderr

    not_yaml = FIXTURES_DIR / "bad_malformed_node.yml"  # reuse dir; write a throwaway non-YAML
    bad = not_yaml.parent / "_tmp_not_yaml.txt"
    bad.write_text("{{{{ not: yaml: [")
    try:
        result = run_tool(str(bad))
        assert result.returncode == 2
        assert "Traceback" not in result.stdout + result.stderr
    finally:
        bad.unlink()


def test_usage_error_without_args() -> None:
    result = run_tool()
    assert result.returncode == 2


def test_escape_hatch_suppresses_with_note_and_forgery_fails() -> None:
    """AC 9 (P3): the column-0 marker suppresses (stderr notes it, stdout empty); the identical
    marker text indented inside a block scalar is DATA and must not suppress."""
    ok = run_tool(str(FIXTURES_DIR / "escape_hatch.yml"))
    assert ok.returncode == 0
    assert "suppressed" in ok.stderr and "1700000000002" in ok.stderr
    assert ok.stdout.strip() == ""

    forged = run_tool(str(FIXTURES_DIR / "escape_forged.yml"))
    assert forged.returncode == 1
    assert "prompt_template" in forged.stdout


# ── drift tests (spec 038 D2 / AC 5 / AC 6) ─────────────────────────────────────────────────────


def _schema_defs() -> dict:
    return json.loads(SCHEMA.read_text())["$defs"]


def test_type_to_def_values_resolve_in_pinned_schema() -> None:
    """AC 5: every non-None TYPE_TO_DEF value resolves to a def in the pinned schema; None rows
    (assigner) carry the documented skip rationale by construction."""
    from lint_node_bodies import TYPE_TO_DEF

    defs = _schema_defs()
    missing = [v for v in TYPE_TO_DEF.values() if v is not None and v not in defs]
    assert missing == [], f"TYPE_TO_DEF values not in schema: {missing}"


def test_every_nonbase_def_is_mapped() -> None:
    """AC 5: every NodeData_* def except the two pydantic base classes must be a TYPE_TO_DEF
    value — a schema refresh that ADDS a def fails here until someone maps or skips it."""
    from lint_node_bodies import BASE_CLASS_DEFS, TYPE_TO_DEF

    defs = {k for k in _schema_defs() if k.startswith("NodeData_")}
    mapped = {v for v in TYPE_TO_DEF.values() if v is not None}
    unaccounted = defs - mapped - BASE_CLASS_DEFS
    assert unaccounted == set(), (
        f"defs neither mapped nor on the base-class skip list: {sorted(unaccounted)}"
    )


def test_implicit_outputs_keys_subset_of_type_to_def() -> None:
    """AC 5: lint_refs' hand-written IMPLICIT_OUTPUTS can no longer drift silently — its keys
    must be node types this tool also knows."""
    from lint_node_bodies import TYPE_TO_DEF
    from lint_refs import IMPLICIT_OUTPUTS

    assert set(IMPLICIT_OUTPUTS.keys()) <= set(TYPE_TO_DEF.keys())


def test_known_node_types_deleted_from_lint_refs() -> None:
    """AC 5: KNOWN_NODE_TYPES was dead code (no consumer) — TYPE_TO_DEF is now the authoritative
    node-type list."""
    src = (Path(__file__).parent.parent / "tools" / "dify_base" / "lint_refs.py").read_text()
    assert "KNOWN_NODE_TYPES" not in src


def test_root_node_data_envelope_still_bare() -> None:
    """AC 6 (D1, anti-gaming): the root Node.data subschema stays the bare `{type}` envelope —
    wiring the NodeData_* $refs there would flip the existing check-jsonschema pre-commit hook
    into an UNMEASURED hard body-gate (the exact hazard D1 excludes structurally)."""
    node_data = _schema_defs()["Node"]["properties"]["data"]
    assert node_data == {
        "type": "object",
        "required": ["type"],
        "properties": {"type": {"type": "string"}},
    }

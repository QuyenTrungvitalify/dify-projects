"""Tests for tools/dify_base/validate_workflow.py (vendored canonical validator, spec 026).

Spec 017 D1 — if-else `cases[]` coherence: the validator gained a modern-`cases` check (Dify 0.6.0
branches off `cases`, not legacy `conditions`). Severity is split so a legacy-only-but-valid corpus
file is never regressed (Q1): a MISSING `cases` is a WARNING; a PRESENT-but-incoherent one is an ERROR.

Spec 026 N1 — node-id format: a non-numeric id (e.g. `node-code-1`) makes refs render as literal
strings at runtime with no error (the repo's #1 silent-failure class). The gate rejects non-numeric
ids; numeric ids and the `<id>start` container-start child pass.

Spec 026 V1 — a hard gate must DIAGNOSE malformed input, not stack-trace: non-dict node/edge entries
(and non-list `nodes`/`edges`) yield structured errors, never an AttributeError traceback.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import yaml

SCRIPT = Path(__file__).parent.parent / "tools" / "dify_base" / "validate_workflow.py"


def _load_validator():
    spec = importlib.util.spec_from_file_location("validate_workflow", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod.WorkflowValidator


WorkflowValidator = _load_validator()

IFELSE_ID = "1000000000002"
END_ID = "1000000000003"


def _workflow(ifelse_data: dict, edges: list | None = None) -> dict:
    """A minimal valid workflow (start + if-else + end) with the if-else `data` under test."""
    return {
        "kind": "app",
        "version": "0.6.0",
        "app": {"name": "t", "mode": "workflow"},
        "workflow": {
            "graph": {
                "nodes": [
                    {"id": "1000000000001", "data": {"type": "start", "variables": []}},
                    {"id": IFELSE_ID, "data": dict(ifelse_data, type="if-else")},
                    {"id": END_ID, "data": {"type": "end", "outputs": []}},
                ],
                "edges": edges or [],
            }
        },
    }


def _validate(tmp_path: Path, wf: dict):
    p = tmp_path / "wf.yml"
    p.write_text(yaml.safe_dump(wf), encoding="utf-8")
    return WorkflowValidator().validate(str(p))


def _has(msgs: list[str], needle: str) -> bool:
    return any(needle in m for m in msgs)


def test_legacy_only_passes_with_warning(tmp_path: Path) -> None:
    """conditions-only (no cases) → valid (don't regress legacy-only green files) but warns."""
    is_valid, errors, warnings = _validate(tmp_path, _workflow({"conditions": [{"id": "c1"}]}))
    assert is_valid, f"legacy-only must still pass; errors={errors}"
    assert _has(warnings, "no modern 'cases'"), warnings


def test_both_coherent_passes_clean(tmp_path: Path) -> None:
    """conditions + a coherent cases (id, logical_operator, conditions, matching edge) → clean."""
    wf = _workflow(
        {
            "conditions": [{"id": "c1"}],
            "cases": [
                {"id": "true", "case_id": "true", "logical_operator": "and", "conditions": [{"id": "c1"}]}
            ],
        },
        edges=[{"source": IFELSE_ID, "sourceHandle": "true", "target": END_ID}],
    )
    is_valid, errors, warnings = _validate(tmp_path, wf)
    assert is_valid, errors
    assert not _has(warnings, "no modern 'cases'")
    assert not _has(warnings, "routes to no outgoing edge")


def test_empty_cases_list_errors(tmp_path: Path) -> None:
    is_valid, errors, _ = _validate(tmp_path, _workflow({"conditions": [{"id": "c1"}], "cases": []}))
    assert not is_valid
    assert _has(errors, "empty or non-list 'cases'"), errors


def test_case_empty_conditions_errors(tmp_path: Path) -> None:
    wf = _workflow(
        {"conditions": [{"id": "c1"}], "cases": [{"id": "true", "logical_operator": "and", "conditions": []}]}
    )
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "empty/missing 'conditions'"), errors


def test_case_missing_id_errors(tmp_path: Path) -> None:
    wf = _workflow(
        {"conditions": [{"id": "c1"}], "cases": [{"logical_operator": "and", "conditions": [{"id": "c1"}]}]}
    )
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "missing 'id'/'case_id'"), errors


def test_case_missing_logical_operator_warns_but_passes(tmp_path: Path) -> None:
    """A missing logical_operator is advisory (some valid exports omit it) — warn, don't fail."""
    wf = _workflow(
        {"conditions": [{"id": "c1"}], "cases": [{"id": "true", "conditions": [{"id": "c1"}]}]},
        edges=[{"source": IFELSE_ID, "sourceHandle": "true", "target": END_ID}],
    )
    is_valid, errors, warnings = _validate(tmp_path, wf)
    assert is_valid, errors
    assert _has(warnings, "missing 'logical_operator'"), warnings


def test_case_with_no_matching_edge_warns_but_passes(tmp_path: Path) -> None:
    """A case whose handle has no outgoing edge is advisory (else/false is implicit) — warn, pass."""
    wf = _workflow(
        {"conditions": [{"id": "c1"}], "cases": [{"id": "true", "logical_operator": "and", "conditions": [{"id": "c1"}]}]},
        edges=[{"source": IFELSE_ID, "sourceHandle": "false", "target": END_ID}],
    )
    is_valid, errors, warnings = _validate(tmp_path, wf)
    assert is_valid, errors
    assert _has(warnings, "routes to no outgoing edge"), warnings


# ── spec 026 N1: node-id format gate ──────────────────────────────────────────────────────────────

START_ID = "1000000000001"


def _two_node_wf(nodes: list, edges: list | None = None) -> dict:
    return {
        "kind": "app",
        "version": "0.6.0",
        "app": {"name": "t", "mode": "workflow"},
        "workflow": {"graph": {"nodes": nodes, "edges": edges or []}},
    }


def test_string_node_id_errors(tmp_path: Path) -> None:
    """A non-numeric node id (the #1 silent-failure class) is a hard error (spec 026 N1)."""
    wf = _two_node_wf([
        {"id": "node-start-1", "data": {"type": "start", "variables": []}},
        {"id": END_ID, "data": {"type": "end", "outputs": []}},
    ])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "non-numeric id"), errors


def test_numeric_and_container_start_ids_pass(tmp_path: Path) -> None:
    """Numeric-timestamp ids and the `<id>start` container-start child both pass N1."""
    wf = _two_node_wf([
        {"id": START_ID, "data": {"type": "start", "variables": []}},
        {"id": "1000000000002start", "data": {"type": "iteration-start"}},
        {"id": END_ID, "data": {"type": "end", "outputs": []}},
    ])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert is_valid, errors
    assert not _has(errors, "non-numeric id"), errors


# ── spec 026 V1: gate diagnoses malformed input instead of crashing ────────────────────────────────


def test_non_dict_node_entry_errors_not_crash(tmp_path: Path) -> None:
    wf = _two_node_wf([
        {"id": START_ID, "data": {"type": "start", "variables": []}},
        "i-am-a-string-not-a-dict",
        {"id": END_ID, "data": {"type": "end", "outputs": []}},
    ])
    is_valid, errors, _ = _validate(tmp_path, wf)  # must not raise
    assert not is_valid
    assert _has(errors, "is not a mapping"), errors


def test_non_dict_edge_entry_errors_not_crash(tmp_path: Path) -> None:
    wf = _two_node_wf(
        [
            {"id": START_ID, "data": {"type": "start", "variables": []}},
            {"id": END_ID, "data": {"type": "end", "outputs": []}},
        ],
        edges=["i-am-a-string-not-a-dict"],
    )
    is_valid, errors, _ = _validate(tmp_path, wf)  # must not raise
    assert not is_valid
    assert _has(errors, "Edge at index 0 is not a mapping"), errors


def test_non_list_nodes_errors_not_crash(tmp_path: Path) -> None:
    wf = {
        "kind": "app",
        "version": "0.6.0",
        "app": {"name": "t", "mode": "workflow"},
        "workflow": {"graph": {"nodes": {"oops": "a-mapping-not-a-list"}, "edges": []}},
    }
    is_valid, errors, _ = _validate(tmp_path, wf)  # must not raise
    assert not is_valid
    assert _has(errors, "'nodes' must be a list"), errors


# ── advanced-chat (chatflow) mode: terminates at an 'answer' node, not 'end' ─────────────────────

def _chatflow(nodes: list) -> dict:
    return {
        "kind": "app",
        "version": "0.6.0",
        "app": {"name": "t", "mode": "advanced-chat"},
        "workflow": {"graph": {"nodes": nodes, "edges": []}},
    }


def test_advanced_chat_with_answer_passes(tmp_path: Path) -> None:
    """A chatflow (mode advanced-chat) ending at an 'answer' node is valid — no end node required."""
    wf = _chatflow([
        {"id": "1000000000001", "data": {"type": "start", "variables": []}},
        {"id": "1000000000004", "data": {"type": "answer", "answer": "hi"}},
    ])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert is_valid, errors
    assert not _has(errors, "app mode")
    assert not _has(errors, "'end' node")


def test_advanced_chat_without_answer_errors(tmp_path: Path) -> None:
    """A chatflow with no 'answer' node fails (the chatflow analogue of the missing-'end' rule)."""
    wf = _chatflow([{"id": "1000000000001", "data": {"type": "start", "variables": []}}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "'answer' node"), errors


def test_workflow_mode_still_requires_end(tmp_path: Path) -> None:
    """Regression guard: workflow mode is unchanged — an 'answer' node does NOT satisfy it."""
    wf = {
        "kind": "app", "version": "0.6.0", "app": {"name": "t", "mode": "workflow"},
        "workflow": {"graph": {"nodes": [
            {"id": "1000000000001", "data": {"type": "start", "variables": []}},
            {"id": "1000000000004", "data": {"type": "answer", "answer": "hi"}},
        ], "edges": []}},
    }
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "'end' node"), errors


def test_unknown_mode_still_rejected(tmp_path: Path) -> None:
    wf = _chatflow([{"id": "1000000000001", "data": {"type": "start", "variables": []}}])
    wf["app"]["mode"] = "completion"
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "app mode"), errors


# ── Spec 049 D1 — environment/conversation variables mirror Dify's import factory ────────────────
# vendor/dify-src/api/factories/variable_factory.py hard-fails the WHOLE import (HTTP 400
# "missing name" / "missing value type" / "missing value") — the 2026-07-08 field incident: an env
# var written with the START-NODE INPUT key `variable:` passed all four linters and 400'd at import.


def _wf_with_vars(env: list | None = None, conv: list | None = None) -> dict:
    """A minimal valid workflow whose variables block is under test."""
    wf: dict = {
        "kind": "app", "version": "0.6.0", "app": {"name": "t", "mode": "workflow"},
        "workflow": {"graph": {"nodes": [
            {"id": "1000000000001", "data": {"type": "start", "variables": []}},
            {"id": "1000000000003", "data": {"type": "end", "outputs": []}},
        ], "edges": []}},
    }
    if env is not None:
        wf["workflow"]["environment_variables"] = env
    if conv is not None:
        wf["workflow"]["conversation_variables"] = conv
    return wf


def test_env_var_variable_key_is_the_incident_red_fixture(tmp_path: Path) -> None:
    """The exact 2026-07-08 shape: `variable:` instead of `name:` → error with the targeted hint."""
    wf = _wf_with_vars(env=[{"variable": "CHATWORK_API_TOKEN", "value_type": "secret", "value": ""}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "start-node input shape"), errors
    assert _has(errors, "missing name"), errors


def test_env_var_name_key_is_the_green_fixture(tmp_path: Path) -> None:
    """The one-key fix that imported `status: completed` — `''` value is VALID (Dify checks None)."""
    wf = _wf_with_vars(env=[{"name": "CHATWORK_API_TOKEN", "value_type": "secret", "value": ""}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert is_valid, errors


def test_conversation_vars_validate_through_the_same_factory(tmp_path: Path) -> None:
    wf = _wf_with_vars(conv=[{"variable": "history", "value_type": "string", "value": ""}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "conversation_variables"), errors


def test_env_var_null_value_fails_but_empty_string_passes(tmp_path: Path) -> None:
    """Mirror `mapping.get('value') is None` exactly: YAML null → red, '' → green (above)."""
    wf = _wf_with_vars(env=[{"name": "X", "value_type": "string", "value": None}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "missing 'value'"), errors


def test_env_var_missing_value_type_fails(tmp_path: Path) -> None:
    wf = _wf_with_vars(env=[{"name": "X", "value": "v"}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "missing 'value_type'"), errors


def test_env_var_empty_name_fails_like_dify(tmp_path: Path) -> None:
    """Dify's `if not mapping.get('name')` also rejects an EMPTY name — mirrored."""
    wf = _wf_with_vars(env=[{"name": "", "value_type": "string", "value": "v"}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "missing or empty 'name'"), errors


def test_variables_block_malformed_entries_diagnose_not_crash(tmp_path: Path) -> None:
    """V1 discipline (spec 026): non-list section / non-dict entry → structured error, no traceback."""
    wf = _wf_with_vars(env=[{"name": "ok", "value_type": "string", "value": "v"}, "oops"])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "is not a mapping"), errors

    wf2 = _wf_with_vars()
    wf2["workflow"]["environment_variables"] = "not-a-list"
    is_valid2, errors2, _ = _validate(tmp_path, wf2)
    assert not is_valid2
    assert _has(errors2, "must be a list"), errors2


def test_absent_and_empty_variables_blocks_stay_green(tmp_path: Path) -> None:
    """Regression guard (AC 2): the pre-049 corpus shape — absent or `[]` — is untouched."""
    is_valid, errors, _ = _validate(tmp_path, _wf_with_vars())
    assert is_valid, errors
    is_valid2, errors2, _ = _validate(tmp_path, _wf_with_vars(env=[], conv=[]))
    assert is_valid2, errors2


# ── Spec 049 r3 (review 1.2/1.3) — the factory's remaining hard-fails, mirrored ─────────────────


def test_null_variables_block_fails_like_dify(tmp_path: Path) -> None:
    """`environment_variables:` (explicit YAML null) → Dify iterates None → import FAILED."""
    wf = _wf_with_vars()
    wf["workflow"]["environment_variables"] = None
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "is null"), errors


def test_unsupported_value_type_fails(tmp_path: Path) -> None:
    """The factory's `case _: raise 'not supported value type'` — catches '' / 'text' / typos."""
    for bad in ("text", ""):
        wf = _wf_with_vars(env=[{"name": "X", "value_type": bad, "value": "v"}])
        is_valid, errors, _ = _validate(tmp_path, wf)
        assert not is_valid
        assert _has(errors, "unsupported value_type"), (bad, errors)


def test_value_shape_must_match_value_type(tmp_path: Path) -> None:
    """string value_type with a non-string value (etc.) fails the factory's case guards."""
    red = [
        {"name": "A", "value_type": "string", "value": 42},
        {"name": "B", "value_type": "number", "value": "42"},
        {"name": "C", "value_type": "object", "value": "not-a-dict"},
        {"name": "D", "value_type": "float", "value": 1},  # Dify: int does NOT satisfy FLOAT's guard
    ]
    for entry in red:
        is_valid, errors, _ = _validate(tmp_path, _wf_with_vars(env=[entry]))
        assert not is_valid, entry
    green = [
        {"name": "A", "value_type": "string", "value": ""},
        {"name": "B", "value_type": "number", "value": 42},
        {"name": "C", "value_type": "object", "value": {}},
        {"name": "D", "value_type": "integer", "value": 7},
        {"name": "E", "value_type": "array[string]", "value": []},
        {"name": "F", "value_type": "boolean", "value": True},
    ]
    is_valid, errors, _ = _validate(tmp_path, _wf_with_vars(env=green))
    assert is_valid, errors


def test_whitespace_name_passes_like_dify(tmp_path: Path) -> None:
    """Dify's check is FALSINESS (`not mapping.get('name')`) — '  ' imports fine; don't be stricter."""
    wf = _wf_with_vars(env=[{"name": "  ", "value_type": "string", "value": "v"}])
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert is_valid, errors


# ── Spec 049 D1b — import gap-matrix additions (root mapping + version type/format) ──────────────


def test_list_root_diagnoses_not_crashes(tmp_path: Path) -> None:
    """Dify: 'content must be a mapping'. Pre-049 the validator CRASHED on a list root (V1 gap)."""
    p = tmp_path / "wf.yml"
    p.write_text("- just\n- a list\n", encoding="utf-8")
    is_valid, errors, _ = WorkflowValidator().validate(str(p))
    assert not is_valid
    assert _has(errors, "root must be a mapping"), errors


def test_unquoted_two_part_version_is_a_yaml_float_and_fails(tmp_path: Path) -> None:
    """The classic trap: `version: 0.4` (unquoted) parses as float → Dify 'expected str'."""
    wf = _wf_with_vars()
    wf["version"] = 0.4  # what yaml.safe_load produces for the unquoted form
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "must be a quoted string"), errors


def test_non_numeric_version_string_fails(tmp_path: Path) -> None:
    """'banana' hits packaging InvalidVersion — worst path: 400 with EMPTY error + orphaned app."""
    wf = _wf_with_vars()
    wf["version"] = "banana"
    is_valid, errors, _ = _validate(tmp_path, wf)
    assert not is_valid
    assert _has(errors, "dotted digits"), errors


def test_dotted_versions_stay_green(tmp_path: Path) -> None:
    for v in ("0.6.0", "0.6", "1.0.0"):
        wf = _wf_with_vars()
        wf["version"] = v
        is_valid, errors, _ = _validate(tmp_path, wf)
        assert is_valid, f"version {v!r}: {errors}"


def test_all_pattern_templates_still_lint_clean(tmp_path: Path) -> None:
    """AC 2 sweep: every shipped pattern template stays green (meta-workflow-builder's correct
    `name:` env vars are the natural green witness for the new check)."""
    patterns = sorted((Path(__file__).parent.parent / "templates" / "patterns").glob("*.yml"))
    assert patterns, "pattern templates missing?"
    for p in patterns:
        validator = WorkflowValidator()
        is_valid, errors, _ = validator.validate(str(p))
        assert is_valid, f"{p.name}: {errors}"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

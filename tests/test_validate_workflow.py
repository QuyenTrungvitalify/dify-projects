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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

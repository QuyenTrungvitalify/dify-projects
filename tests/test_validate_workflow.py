"""Tests for skills/mango-svip/scripts/validate_workflow.py — focus: spec 017 D1 if-else `cases[]`.

The validator gained a modern-`cases` coherence check (Dify 0.6.0 branches off `cases`, not legacy
`conditions`). Severity is split so a legacy-only-but-valid corpus file is never regressed (Q1):
a MISSING `cases` is a WARNING; a PRESENT-but-incoherent `cases` is an ERROR.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import yaml

SCRIPT = Path(__file__).parent.parent / "skills" / "mango-svip" / "scripts" / "validate_workflow.py"


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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

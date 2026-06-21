"""Tests for tools/dify_base/lint_refs.py (Phase Y.3)."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "lint_refs"
TOOL = Path(__file__).parent.parent / "tools" / "dify_base" / "lint_refs.py"

EXPECTED: dict[str, int] = {
    "valid_simple.yml": 0,
    "valid_iteration.yml": 0,
    "valid_special_ns.yml": 0,
    "bad_node_id.yml": 1,
    "bad_field_name.yml": 1,
    "bad_value_selector.yml": 1,
    "mixed_errors.yml": 1,
    "code_with_string_ref.yml": 1,  # Q3.3 lenient: treat literal as a ref
}


@pytest.mark.parametrize("fname,expected_exit", list(EXPECTED.items()))
def test_lint_refs(fname: str, expected_exit: int) -> None:
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / fname)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == expected_exit, (
        f"{fname}: expected exit {expected_exit}, got {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_lint_refs_mixed_errors_count() -> None:
    """mixed_errors.yml should emit >=3 errors (per spec)."""
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / "mixed_errors.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    error_lines = [ln for ln in result.stdout.splitlines() if ln.strip()]
    assert len(error_lines) >= 3, f"expected >=3 error lines, got {len(error_lines)}:\n{result.stdout}"


def test_lint_refs_no_args() -> None:
    result = subprocess.run([sys.executable, str(TOOL)], capture_output=True)
    assert result.returncode == 2


def test_lint_refs_file_not_found() -> None:
    result = subprocess.run(
        [sys.executable, str(TOOL), "/nonexistent/file.yml"],
        capture_output=True,
    )
    assert result.returncode != 0


def test_lint_refs_patterns_clean() -> None:
    """Real templates/patterns/*.yml should be ref-clean (regression guard)."""
    repo_root = Path(__file__).parent.parent
    patterns = sorted((repo_root / "templates" / "patterns").glob("*.yml"))
    assert patterns, "no patterns found — fixture broken"
    result = subprocess.run(
        [sys.executable, str(TOOL), *map(str, patterns)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, (
        f"patterns flagged broken refs:\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


# ── O1 / spec 020 — graph-reachability (warn-only, phase 1) ──────────────────────────────────────


def test_reachability_warn_only_default_unchanged() -> None:
    """Phase-1 discipline: the DEFAULT run does not gate on reachability yet. The forward-ref fixture
    has valid ids/fields, so the existing checks pass (exit 0) — reachability is opt-in via the flag."""
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / "reach_forward_ref.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"default run must not gate on reachability:\n{result.stdout}"
    assert "reachability:" not in result.stdout


def test_reachability_flag_catches_forward_ref() -> None:
    """--check-reachability flags a forward/downstream-only ref (and ONLY that), exiting 0 (warn-only)."""
    result = subprocess.run(
        [sys.executable, str(TOOL), "--check-reachability", str(FIXTURES_DIR / "reach_forward_ref.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, "warn-only mode must exit 0"
    reach = [ln for ln in result.stdout.splitlines() if ln.startswith("reachability:")]
    assert len(reach) == 1, f"expected exactly 1 finding (the forward ref), got:\n{result.stdout}"
    assert "{{#300.text#}}" in reach[0] and "'200'" in reach[0]


def test_reachability_patterns_clean() -> None:
    """templates/patterns/*.yml are reachability-clean under --check-reachability (0 false positives)."""
    repo_root = Path(__file__).parent.parent
    patterns = sorted((repo_root / "templates" / "patterns").glob("*.yml"))
    assert patterns, "no patterns found — fixture broken"
    result = subprocess.run(
        [sys.executable, str(TOOL), "--check-reachability", *map(str, patterns)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    reach = [ln for ln in result.stdout.splitlines() if ln.startswith("reachability:")]
    assert reach == [], "patterns should be reachability-clean:\n" + "\n".join(reach)

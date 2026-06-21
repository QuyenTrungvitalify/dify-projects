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


def test_reachability_default_gates_forward_ref() -> None:
    """Phase-3 (promoted): the DEFAULT run now GATES on reachability. The forward-ref fixture has valid
    ids/fields (existing checks pass), but the forward ref alone makes it exit 1."""
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / "reach_forward_ref.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1, f"default run must gate on the forward ref:\n{result.stdout}"
    assert "{{#300.text#}}" in result.stdout and "not upstream-reachable" in result.stdout


def test_reachability_default_escape_hatch_suppresses() -> None:
    """Phase-3: the escape hatch works in the gating default path too — reach_allow.yml suppresses its
    forward ref and (with valid ids/fields) passes clean."""
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / "reach_allow.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"escape hatch must suppress in the gate:\n{result.stdout}"


def test_reachability_default_no_root_does_not_gate() -> None:
    """Phase-3: a no-root file is not hard-failed on something we couldn't check. The advisory is surfaced
    only by --check-reachability; the default gate stays clean (valid ids/fields → exit 0)."""
    result = subprocess.run(
        [sys.executable, str(TOOL), str(FIXTURES_DIR / "reach_no_root.yml")],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"no-root must not gate the default run:\n{result.stdout}"


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


def _reach_lines(fname: str) -> list[str]:
    """Run --check-reachability on a fixture; return the `reachability:` finding lines (warn-only → exit 0)."""
    result = subprocess.run(
        [sys.executable, str(TOOL), "--check-reachability", str(FIXTURES_DIR / fname)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, "warn-only mode must exit 0"
    return [ln for ln in result.stdout.splitlines() if ln.startswith("reachability:")]


def test_reachability_answer_forward_caught() -> None:
    """Mục 2 — strict ancestor rule catches an `answer` referencing a node that runs after it (the old
    weaker E4 rule hid this)."""
    reach = _reach_lines("reach_answer_forward.yml")
    assert len(reach) == 1, f"expected 1 finding, got:\n" + "\n".join(reach)
    assert "{{#later.text#}}" in reach[0] and "'ans'" in reach[0]


def test_reachability_escape_hatch_suppresses() -> None:
    """Mục 1 — `# lint-refs: allow-reach 300.text` suppresses the otherwise-flagged forward ref."""
    assert _reach_lines("reach_allow.yml") == []


def test_reachability_escape_hatch_ignores_marker_in_string() -> None:
    """Mục 1 — the marker must be a full-line comment; the same text inside a prompt string does NOT
    suppress (no false-negative injection via prompt content)."""
    reach = _reach_lines("reach_allow_in_string.yml")
    assert len(reach) == 1, f"marker-in-string must not suppress, got:\n" + "\n".join(reach)
    assert "{{#300.text#}}" in reach[0] and "'200'" in reach[0]


def test_reachability_no_root_advisory() -> None:
    """Mục 5 — a rootless file with a node-to-node ref is NOT silently skipped; it emits one advisory."""
    reach = _reach_lines("reach_no_root.yml")
    assert len(reach) == 1, f"expected 1 advisory, got:\n" + "\n".join(reach)
    assert "no start" in reach[0] and "NOT checked" in reach[0]


def test_reachability_loop_valid_clean() -> None:
    """Mục 4 — a valid loop (loop-start anchor, in-loop body refs, post-loop output read) is clean."""
    assert _reach_lines("reach_loop_valid.yml") == []


def test_reachability_loop_forward_caught() -> None:
    """Mục 4 — a main-DAG forward ref is caught even when a loop is present; the loop body adds no noise."""
    reach = _reach_lines("reach_loop_forward.yml")
    assert len(reach) == 1, f"expected 1 finding, got:\n" + "\n".join(reach)
    assert "{{#after.text#}}" in reach[0] and "'mid'" in reach[0]

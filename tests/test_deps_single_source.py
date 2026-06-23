"""Pin the deps single-source-of-truth invariant (spec 024 Q1b).

Three independent unpinned dep lists (setup.sh DEPS array, ci.yml inline
`uv pip install`, tests/requirements.txt) used to drift — a new release could
pass CI while breaking gen_schema locally, or vice-versa. We collapsed them onto
one pinned source: requirements.txt (locked from requirements.in). These asserts
are deliberately simple substring checks whose only job is to fail loudly if a
future edit re-introduces an inline multi-package list.
"""
from pathlib import Path

BASE = Path(__file__).parent.parent
SETUP_SH = (BASE / "scripts/setup.sh").read_text()
CI_YML = (BASE / ".github/workflows/ci.yml").read_text()
TESTS_REQ = (BASE / "tests/requirements.txt").read_text()


def test_pinned_source_files_exist():
    assert (BASE / "requirements.in").is_file(), "requirements.in (the editable source) is missing"
    assert (BASE / "requirements.txt").is_file(), "requirements.txt (the compiled lock) is missing"


def test_setup_installs_from_lock():
    assert "requirements.txt" in SETUP_SH, "setup.sh must install from requirements.txt"


def test_ci_installs_from_lock():
    assert "-r requirements.txt" in CI_YML, "ci.yml must install from requirements.txt"


def test_tests_requirements_points_to_root():
    assert "../requirements.txt" in TESTS_REQ, "tests/requirements.txt must point to the root lock"


def test_setup_has_no_inline_dep_array():
    """The old DEPS=( ... ) array is the re-drift vector — it must stay gone."""
    assert "DEPS=(" not in SETUP_SH, "setup.sh re-grew an inline DEPS array; install from the lock instead"


def test_ci_has_no_inline_dep_list():
    """ci.yml must not list packages inline next to `uv pip install --system`."""
    for line in CI_YML.splitlines():
        if "uv pip install --system" in line:
            # The lock install is `uv pip install --system -r requirements.txt`; a
            # bare-name list (e.g. `... pytest pyyaml jsonschema`) is the regression.
            assert "-r requirements.txt" in line, (
                f"ci.yml installs packages inline; use the lock instead: {line.strip()!r}"
            )

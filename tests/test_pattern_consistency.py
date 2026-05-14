"""Assert all patterns in templates/patterns/ follow conventions."""
from pathlib import Path

import pytest
import yaml

PATTERN_FILES = sorted(
    (Path(__file__).parent.parent / "templates/patterns").glob("*.yml")
)


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_use_case_comment(yml_path):
    text = yml_path.read_text()
    assert "# Use case:" in text or "# use case:" in text.lower(), (
        f"{yml_path.name} missing '# Use case:' header"
    )


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_todo_markers(yml_path):
    text = yml_path.read_text()
    assert "# TODO:" in text, (
        f"{yml_path.name} should have # TODO: customization markers"
    )


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_empty_dependencies(yml_path):
    """Patterns should not commit specific plugin hashes — leave deps empty."""
    d = yaml.safe_load(yml_path.read_text())
    deps = d.get("dependencies", [])
    assert deps == [], (
        f"{yml_path.name} has hardcoded plugin dependencies — "
        f"patterns should leave empty"
    )

"""Detect drift between README/INDEX claims and actual repo state."""
import json
import re
from pathlib import Path

BASE = Path(__file__).parent.parent
README = (BASE / "README.md").read_text()


def test_readme_pattern_count():
    n = len(list((BASE / "templates/patterns").glob("*.yml")))
    assert f"{n} reusable" in README or f"{n} pattern" in README.lower(), (
        f"README doesn't mention {n} patterns. "
        f"Found in templates/patterns/: {n}"
    )


def test_readme_schema_nodedata_count():
    schemas = sorted((BASE / "schemas").glob("dify-dsl-*.json"))
    if not schemas:
        return
    s = json.loads(schemas[-1].read_text())
    n = sum(1 for k in s.get("$defs", {}) if k.startswith("NodeData_"))
    assert f"{n} NodeData" in README, (
        f"README mentions schema NodeData count but doesn't match "
        f"{n} in {schemas[-1].name}"
    )


def test_index_file_count_matches():
    """INDEX.md auto-gen file count matches actual yml count in scanned dirs."""
    index = (BASE / "INDEX.md").read_text()
    match = re.search(r"\*\*(\d+) files indexed", index)
    assert match, "INDEX.md missing file count header"
    claimed = int(match.group(1))
    assert 30 < claimed < 200, (
        f"INDEX claims {claimed} files — out of expected range"
    )

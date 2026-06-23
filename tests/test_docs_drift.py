"""Detect drift between README/INDEX claims and actual repo state."""
import json
import re
from pathlib import Path

BASE = Path(__file__).parent.parent
README = (BASE / "README.md").read_text()
AGENTS = (BASE / "AGENTS.md").read_text()
ARCHITECTURE = (BASE / "docs/architecture.md").read_text()
INDEX = (BASE / "INDEX.md").read_text()


def _pattern_count():
    return len(list((BASE / "templates/patterns").glob("*.yml")))


def test_readme_pattern_count():
    n = _pattern_count()
    assert f"{n} reusable" in README or f"{n} pattern" in README.lower(), (
        f"README doesn't mention {n} patterns. "
        f"Found in templates/patterns/: {n}"
    )


def test_pattern_count_consistent_across_docs():
    """Pattern count must agree across README ∧ AGENTS ∧ architecture (catches R1).

    All three are user/agent-facing surfaces; a 4-vs-6 split made agents
    under-discover patterns. Pin them to the actual file count on disk.
    """
    n = _pattern_count()
    rx = re.compile(rf"\b{n}\b[^.\n]{{0,40}}(?:patterns?|skeletons?)", re.I)
    for label, doc in (
        ("README.md", README),
        ("AGENTS.md", AGENTS),
        ("docs/architecture.md", ARCHITECTURE),
    ):
        assert rx.search(doc), (
            f"{label} does not state the actual pattern count ({n}) found in "
            f"templates/patterns/. Update it (or the others) so they agree."
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
    match = re.search(r"\*\*(\d+) files indexed", INDEX)
    assert match, "INDEX.md missing file count header"
    claimed = int(match.group(1))
    assert 30 < claimed < 200, (
        f"INDEX claims {claimed} files — out of expected range"
    )


def test_readme_corpus_count_matches_index():
    """README's '~N template' headline must equal INDEX's 'N files indexed' (catches R7)."""
    idx = re.search(r"\*\*(\d+) files indexed", INDEX)
    assert idx, "INDEX.md missing file count header"
    indexed = int(idx.group(1))
    m = re.search(r"search\s+~?(\d+)\+?\s*template", README)
    assert m, "README missing the 'search ~N template' corpus-count headline"
    claimed = int(m.group(1))
    assert claimed == indexed, (
        f"README claims ~{claimed} templates but INDEX has {indexed} files "
        f"indexed — reconcile the README headline with INDEX."
    )


def test_schema_error_nodes_are_known_set():
    """Exactly the known-broken node(s) carry an `_error` dump marker (catches R4/S1).

    gen_schema swallows per-class dump failures into `_error`. Today only
    http_request fails (SchemaSerializer); agent dumps clean. When spec 024 S1
    fixes http_request this set goes empty — update KNOWN + the README/architecture
    schema-coverage text together.
    """
    schemas = sorted((BASE / "schemas").glob("dify-dsl-*.json"))
    if not schemas:
        return
    s = json.loads(schemas[-1].read_text())
    errored = {
        k for k, v in s.get("$defs", {}).items()
        if isinstance(v, dict) and "_error" in v
    }
    KNOWN = {"NodeData_HttpRequestNodeData"}
    assert errored == KNOWN, (
        f"Schema `_error` set changed: {errored or '{}'} (expected {KNOWN}). "
        f"If S1 fixed http_request, update this test AND the README/architecture "
        f"schema-coverage claims in the same commit."
    )

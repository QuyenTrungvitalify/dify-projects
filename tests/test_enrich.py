"""The offline enrichment layer (spec 076 E1): schema validation, merge-onto-index, stale detection.

enrichment.json is LLM-authored English metadata (summary_en/tags/when_to_use/gotchas) keyed by
`source/file`, merged into the (gitignored) index.json at build time. These tests pin the three
guarantees build_index relies on: a bad map is caught, a good map merges, and a source that changed
since it was enriched is flagged stale (a warning, never a hard fail — the entry still merges).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).parent.parent / "tools" / "dify_base"
sys.path.insert(0, str(TOOLS))

from enrich import (  # noqa: E402
    entry_key,
    load_enrichment,
    merge_enrichment,
    schema_problems,
)


def test_entry_key_namespaces_by_source():
    assert entry_key("patterns", "rag-qa.yml") == "patterns/rag-qa.yml"
    assert entry_key("corpus:x", "a.yml") == "corpus:x/a.yml"


def test_schema_clean_map_has_no_problems():
    ok = {
        "patterns/a.yml": {
            "summary_en": "does a thing",
            "tags": ["data-analysis", "code"],
            "when_to_use": "when X",
            "gotchas": "",
        }
    }
    assert schema_problems(ok) == []


def test_schema_catches_bad_fields():
    bad = {
        "a": {"summary_en": "", "tags": ["ok"]},                    # empty summary
        "b": {"summary_en": "x", "tags": "not-a-list"},             # tags not a list
        "c": {"summary_en": "x", "tags": [""]},                     # empty tag
        "d": {"summary_en": "x", "tags": [], "when_to_use": 5},     # non-string prose
        "e": {"summary_en": "x", "tags": [], "orig_sha256": "abc"},  # short sha
        "f": "not-an-object",
    }
    problems = schema_problems(bad)
    joined = "\n".join(problems)
    for key in ("a:", "b:", "c:", "d:", "e:", "f:"):
        assert key in joined, f"expected a problem for {key} in {problems}"


def test_merge_sets_fields_and_leaves_unenriched_entries_untouched():
    enrichment = {
        "corpus:x/chart.yml": {
            "summary_en": "renders a chart",
            "tags": ["data-analysis", "chart"],
            "when_to_use": "charts",
            "gotchas": "old DSL",
        }
    }
    entries = [
        {"source": "corpus:x", "file": "chart.yml", "path": "/nope", "description": "一个图表"},
        {"source": "patterns", "file": "other.yml", "path": "/nope", "description": "kept as-is"},
    ]
    merge_enrichment(entries, enrichment=enrichment)
    assert entries[0]["summary_en"] == "renders a chart"
    assert entries[0]["tags"] == ["data-analysis", "chart"]
    assert entries[0]["description"] == "一个图表", "raw description is preserved (back-compat)"
    assert "summary_en" not in entries[1], "an unenriched entry is left byte-identical"


def test_missing_or_corrupt_enrichment_degrades_to_no_merge(tmp_path):
    assert load_enrichment(tmp_path / "absent.json") == {}
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert load_enrichment(bad) == {}
    entries = [{"source": "patterns", "file": "a.yml", "path": "/nope"}]
    merge_enrichment(entries, enrichment={})
    assert "summary_en" not in entries[0]


def test_stale_source_fires_the_callback_but_still_merges(tmp_path):
    src = tmp_path / "wf.yml"
    src.write_text("app: {}\n", encoding="utf-8")
    real_sha = hashlib.sha256(src.read_bytes()).hexdigest()

    fresh = {"corpus:x/wf.yml": {"summary_en": "s", "tags": ["t"], "orig_sha256": real_sha}}
    stale = {"corpus:x/wf.yml": {"summary_en": "s", "tags": ["t"], "orig_sha256": "0" * 64}}

    seen: list[str] = []
    entries = [{"source": "corpus:x", "file": "wf.yml", "path": str(src)}]
    merge_enrichment(entries, enrichment=fresh, on_stale=seen.append)
    assert seen == [], "matching sha → not stale"

    seen.clear()
    entries = [{"source": "corpus:x", "file": "wf.yml", "path": str(src)}]
    merge_enrichment(entries, enrichment=stale, on_stale=seen.append)
    assert seen == ["corpus:x/wf.yml"], "changed source → stale callback"
    assert entries[0]["summary_en"] == "s", "stale still merges (warn, not drop)"


def test_committed_enrichment_json_is_schema_clean():
    """The real tracked enrichment.json must always validate — guards hand/agent edits."""
    path = TOOLS / "enrichment.json"
    if not path.exists():
        return
    assert schema_problems(json.loads(path.read_text(encoding="utf-8"))) == []

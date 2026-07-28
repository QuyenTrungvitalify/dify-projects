"""find.py ranking + enrichment-aware search (spec 076 E2 — find.py's first ranking tests).

Two guarantees, neither of which find.py had a test for before:
  1. Precedence is enforced by a tier-weight, not the raw source string: at equal complexity a
     `patterns` example sorts BEFORE a `corpus:*` one (alphabet used to do the opposite: c < p).
  2. `--name` reaches the enriched fields (summary_en + tags), so an intent query finds a workflow
     whose raw description is empty or Chinese.

The CLI reads its index from $DIFY_INDEX_PATH, so each test drives it against a small fixture index.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).parent.parent / "tools" / "dify_base"
sys.path.insert(0, str(TOOLS))

from find import source_rank  # noqa: E402


def _entry(source, file, *, complexity="Simple", has=None, summary_en="", tags=None, desc=""):
    e = {
        "source": source, "file": file, "path": f"/x/{file}", "name": file[:-4],
        "description": desc, "mode": "workflow", "version": "0.6.0",
        "node_count": 3, "node_types": ["start", "llm", "end"], "complexity": complexity,
        "plugins": [], "summary_en": summary_en, "tags": tags or [],
    }
    for feat in (has or []):
        e[f"has_{feat.replace('-', '_')}"] = True
    return e


def _run(tmp_path, entries, *args):
    idx = tmp_path / "index.json"
    idx.write_text(json.dumps(entries), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(TOOLS / "find.py"), *args],
        capture_output=True, text=True, env={"DIFY_INDEX_PATH": str(idx), "PATH": ""},
    )


def test_source_rank_follows_documented_precedence():
    # patterns > library > project > example/starter > corpus:* > skill-assets
    assert source_rank("patterns") < source_rank("library") < source_rank("project")
    assert source_rank("project") < source_rank("example")
    assert source_rank("example") < source_rank("corpus:awesome-dify-workflow-en")
    assert source_rank("corpus:x") < source_rank("skill-assets")
    assert source_rank("corpus:anything") == source_rank("corpus:other"), "every corpus:* shares one rank"


def test_patterns_sorts_before_corpus_at_equal_complexity(tmp_path):
    entries = [
        _entry("corpus:awesome-dify-workflow-en", "aaa.yml", has=["llm"]),
        _entry("patterns", "zzz.yml", has=["llm"]),
    ]
    r = _run(tmp_path, entries, "--has", "llm")
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert out.index("zzz.yml") < out.index("aaa.yml"), (
        "patterns must sort before corpus even though 'z' > 'a' and 'corpus' < 'patterns'"
    )


def test_name_search_reaches_summary_en(tmp_path):
    # Raw description empty (the real matplotlib/chart case) — only the enrichment carries "chart".
    entries = [
        _entry("corpus:x", "matplotlib.yml", summary_en="Generates a chart with matplotlib", desc=""),
        _entry("patterns", "rag-qa.yml", summary_en="RAG question answering", desc="rag"),
    ]
    r = _run(tmp_path, entries, "--name", "chart")
    assert r.returncode == 0, r.stderr
    assert "matplotlib.yml" in r.stdout
    assert "rag-qa.yml" not in r.stdout


def test_name_search_reaches_tags(tmp_path):
    entries = [
        _entry("corpus:x", "json-repair.yml", tags=["data-processing", "json"], desc=""),
        _entry("patterns", "rag-qa.yml", tags=["rag"], desc="rag"),
    ]
    r = _run(tmp_path, entries, "--name", "data-processing")
    assert r.returncode == 0, r.stderr
    assert "json-repair.yml" in r.stdout
    assert "rag-qa.yml" not in r.stdout


def test_bm25_multiword_query_reaches_hyphen_tag(tmp_path):
    # The A/B regression: "data analysis" (space) must reach the "data-analysis" (hyphen) tag —
    # the old substring match could not, because "data analysis" is not a substring of "data-analysis".
    entries = [
        _entry("corpus:x", "chart_demo.yml", summary_en="Renders a chart from data",
               tags=["data-analysis", "chart"], desc=""),
        _entry("patterns", "rag-qa.yml", summary_en="RAG question answering", tags=["rag"], desc="rag"),
    ]
    r = _run(tmp_path, entries, "--name", "data analysis")
    assert r.returncode == 0, r.stderr
    assert "chart_demo.yml" in r.stdout and "rag-qa.yml" not in r.stdout


def test_bm25_ranks_most_relevant_first(tmp_path):
    entries = [
        _entry("corpus:x", "tangential.yml", summary_en="A workflow that mentions json once",
               tags=["utility"]),
        _entry("corpus:x", "json-repair.yml", summary_en="Repairs malformed json and returns valid json",
               tags=["json", "data-processing"]),
    ]
    r = _run(tmp_path, entries, "--name", "repair json")
    assert r.returncode == 0, r.stderr
    out = r.stdout
    assert "json-repair.yml" in out
    assert out.index("json-repair.yml") < out.index("tangential.yml"), "json-heavy doc must rank first"


def test_bm25_equal_relevance_breaks_on_precedence(tmp_path):
    # Identical text → identical BM25 score → precedence decides: patterns before corpus.
    entries = [
        _entry("corpus:x", "aaa.yml", summary_en="translate text", tags=["translation"]),
        _entry("patterns", "bbb.yml", summary_en="translate text", tags=["translation"]),
    ]
    r = _run(tmp_path, entries, "--name", "translate")
    assert r.returncode == 0, r.stderr
    assert r.stdout.index("bbb.yml") < r.stdout.index("aaa.yml"), "equal relevance → patterns first"


def test_unenriched_index_still_searches_by_raw_description(tmp_path):
    # No summary_en/tags at all → the classic description/name/file match must still work.
    entries = [{
        "source": "patterns", "file": "translate.yml", "path": "/x/translate.yml",
        "name": "translate", "description": "translate English to Japanese", "mode": "workflow",
        "version": "0.6.0", "node_count": 2, "node_types": ["start", "llm"],
        "complexity": "Simple", "plugins": [],
    }]
    r = _run(tmp_path, entries, "--name", "japanese")
    assert r.returncode == 0, r.stderr
    assert "translate.yml" in r.stdout

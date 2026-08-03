#!/usr/bin/env python3
"""Offline enrichment layer for the template index (spec 076 E1).

`build_index.py` reads each workflow's raw `app.description`. For the vendored corpus that field is
mostly Chinese or empty, so real capabilities — chart rendering (`chart_demo`), plotting
(`matplotlib`), JSON repair (`json-repair`) — are INVISIBLE to intent-based lookup. This layer stores
LLM-authored, English, TRACKED enrichment keyed by ``source/file``:

    { "corpus:awesome-dify-workflow-en/chart_demo.yml": {
        "summary_en":  "one-line English capability summary",
        "tags":        ["data-analysis", "chart", "code"],   # domain + topology
        "when_to_use": "when the user asks to …",
        "gotchas":     "DSL 0.1.x — adapt before reuse",
        "orig_sha256": "<sha256 of the source YAML at enrichment time>"
    }, … }

Design (spec 076 §2):
  - Runtime stays pure-Python / offline / zero-network. Enrichment is generated offline and COMMITTED
    (this file is derived knowledge — stored SEPARATELY from the read-only corpus clone, keyed so it
    can be regenerated when upstream drifts). `build_index.py` MERGES it into the (gitignored) index.json.
  - `orig_sha256` lets `build_index` flag enrichment that went stale after an upstream refresh — a
    WARNING, never a build failure (degrade: an un-enriched entry keeps its old description).
  - This script only VALIDATES and REPORTS. It never calls an LLM and never touches the network.

Usage:
    python3 tools/dify_base/enrich.py --check          # report missing / stale / orphan (advisory)
    python3 tools/dify_base/enrich.py --list-missing   # keys in the index that lack enrichment
    python3 tools/dify_base/enrich.py --strict         # exit 1 on stale/orphan/schema (opt-in, for CI)
"""
import argparse
import json
import sys
from pathlib import Path

from provenance import sha256_file  # full hex SHA-256, reused so drift detection matches promotion

BASE = Path(__file__).parent.parent.parent
ENRICH_PATH = Path(__file__).parent / "enrichment.json"
INDEX_PATH = Path(__file__).parent / "index.json"

# summary_en + tags are the load-bearing fields (they feed lookup); when_to_use/gotchas are prose that
# may legitimately be empty. orig_sha256 is optional but, when present, must be a 64-char hex digest.
_STR_FIELDS = ("summary_en", "when_to_use", "gotchas")


def entry_key(source, file):
    """The enrichment key for an index entry — ``source/file`` (source already namespaces corpus:*)."""
    return f"{source}/{file}"


def load_enrichment(path=ENRICH_PATH):
    """The enrichment map, or {} when absent/corrupt. Never raises — a missing layer must degrade."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def load_index(path=INDEX_PATH):
    """Index entries, or [] when absent/corrupt."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def schema_problems(enrichment):
    """List human-readable schema violations in an enrichment map (empty = clean)."""
    problems = []
    for key, v in enrichment.items():
        if not isinstance(v, dict):
            problems.append(f"{key}: value is not an object")
            continue
        s = v.get("summary_en")
        if not isinstance(s, str) or not s.strip():
            problems.append(f"{key}: summary_en must be a non-empty string")
        tags = v.get("tags")
        if not isinstance(tags, list) or not all(isinstance(t, str) and t.strip() for t in tags):
            problems.append(f"{key}: tags must be a list of non-empty strings")
        for f in _STR_FIELDS:
            if f in v and not isinstance(v[f], str):
                problems.append(f"{key}: {f} must be a string")
        sha = v.get("orig_sha256")
        if sha is not None and (not isinstance(sha, str) or len(sha) != 64):
            problems.append(f"{key}: orig_sha256 must be a 64-char hex digest")
    return problems


def merge_enrichment(entries, enrichment=None, on_stale=None):
    """Fold enrichment fields onto index entries IN PLACE and return them.

    For each entry whose ``source/file`` key is enriched, set summary_en / tags / when_to_use /
    gotchas. When the stored orig_sha256 no longer matches the source file on disk the entry is STILL
    enriched (stale text still beats an empty Chinese description) but ``on_stale(key)`` is called so
    the caller can warn. Entries with no enrichment are left byte-identical — the degrade path.
    """
    enr = load_enrichment() if enrichment is None else enrichment
    if not enr:
        return entries
    for e in entries:
        data = enr.get(entry_key(e.get("source", ""), e.get("file", "")))
        if not isinstance(data, dict):
            continue
        want = data.get("orig_sha256")
        if want and on_stale:
            try:
                got = sha256_file(e["path"])
            except (OSError, KeyError):
                got = None
            if got and got != want:
                on_stale(entry_key(e["source"], e["file"]))
        e["summary_en"] = data.get("summary_en", "")
        e["tags"] = list(data.get("tags") or [])
        e["when_to_use"] = data.get("when_to_use", "")
        e["gotchas"] = data.get("gotchas", "")
    return entries


def check_data(index_path=None, enrich_path=None):
    """Data-level half of --check (spec 080 S1): the same missing/stale/orphan/schema computation,
    returned as a dict so `catalog.py stats` can embed it without re-deriving the rules. `check()`
    below prints FROM this — one source of truth for what counts as missing/stale/orphan."""
    enr = load_enrichment(enrich_path if enrich_path is not None else ENRICH_PATH)
    idx = load_index(index_path if index_path is not None else INDEX_PATH)
    idx_paths = {entry_key(e["source"], e["file"]): e.get("path") for e in idx}

    stale = []
    for k, v in enr.items():
        want = v.get("orig_sha256") if isinstance(v, dict) else None
        path = idx_paths.get(k)
        if want and path:
            try:
                if sha256_file(path) != want:
                    stale.append(k)
            except OSError:
                pass  # file vanished → surfaces as orphan, not stale
    missing = sorted(k for k in idx_paths if k not in enr)
    return {
        "enrichment_total": len(enr),
        "index_total": len(idx_paths),
        "covered": len(idx_paths) - len(missing),
        "missing": missing,
        "stale": sorted(stale),
        "orphan": sorted(k for k in enr if k not in idx_paths),
        "problems": schema_problems(enr),
    }


def check(strict=False):
    """Report missing / stale / orphan / schema issues. Advisory (rc=0) unless --strict."""
    d = check_data()
    if not d["index_total"]:
        print(f"❌ index not found or empty at {INDEX_PATH} — run build_index.py first", file=sys.stderr)
        return 1
    missing, stale, orphan, problems = d["missing"], d["stale"], d["orphan"], d["problems"]

    print(f"Enrichment: {d['enrichment_total']} entries · index: {d['index_total']} entries")
    print(f"  covered : {d['covered']}/{d['index_total']}")
    if missing:
        print(f"  ⚠ missing enrichment ({len(missing)}):")
        for k in missing:
            print(f"      {k}")
    if stale:
        print(f"  ⚠ stale (source changed since enriched — re-run enrichment) ({len(stale)}):")
        for k in stale:
            print(f"      {k}")
    if orphan:
        print(f"  ⚠ orphan (enriched but no longer in index) ({len(orphan)}):")
        for k in orphan:
            print(f"      {k}")
    if problems:
        print(f"  ✗ schema problems ({len(problems)}):", file=sys.stderr)
        for p in problems:
            print(f"      {p}", file=sys.stderr)
    if not (missing or stale or orphan or problems):
        print("  ✓ enrichment is complete and current")

    if strict and (stale or orphan or problems):
        return 1
    return 0


def main():
    parser = argparse.ArgumentParser(description="Validate/report the offline enrichment layer (spec 076 E1)")
    parser.add_argument("--check", action="store_true", help="report missing / stale / orphan (advisory)")
    parser.add_argument("--list-missing", action="store_true", help="print index keys lacking enrichment")
    parser.add_argument("--strict", action="store_true", help="exit 1 on stale/orphan/schema problems")
    args = parser.parse_args()

    if args.list_missing:
        enr = load_enrichment()
        idx = load_index()
        for e in idx:
            k = entry_key(e["source"], e["file"])
            if k not in enr:
                print(k)
        return 0

    # Default to --check when no explicit mode is given.
    return check(strict=args.strict)


if __name__ == "__main__":
    sys.exit(main())

"""Spec 078 S1 — the fingerprint catalog (tools/dify_base/catalog.py).

Covers: fingerprint stability under rename/translation, the helper-node+edge filter, seed
idempotence, the three check verdicts (dup is sha256-ONLY; a <4-node fingerprint match is a
weak-signal near-dup, never a dup), decision replay after `record`, live `--shelf` mode
(the S2 nudge path — collected.json must NOT participate), and doctor's curated-only gate.

Fixtures are SYNTHESIZED (spec 078 S1): the real-world aircrushin↔corpus dup is illustration
only — committing a no-license file as a fixture would violate the spec's own §8.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

import yaml

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE / "tools" / "dify_base"))

import catalog  # noqa: E402


def _wf(node_types, edges=(), titles=None, helper_nodes=(), helper_edges=()):
    """Build a minimal workflow dict. `edges` are (src_idx, dst_idx) into node_types;
    helper nodes/edges exercise the filter (they must not move the fingerprint)."""
    nodes = [
        {"id": f"n{i}", "data": {"type": t, "title": (titles or {}).get(i, f"node {i}")}}
        for i, t in enumerate(node_types)
    ]
    nodes += [{"id": f"h{i}", "data": {"type": t}} for i, t in enumerate(helper_nodes)]
    edge_list = [{"source": f"n{a}", "target": f"n{b}"} for a, b in edges]
    edge_list += [{"source": a, "target": b} for a, b in helper_edges]
    return {"app": {"mode": "workflow"}, "workflow": {"graph": {"nodes": nodes, "edges": edge_list}}}


def _write(path, doc):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=True), encoding="utf-8")
    return path


FOUR_NODE = ["start", "code", "llm", "end"]
FOUR_EDGES = [(0, 1), (1, 2), (2, 3)]


# ── fingerprint ───────────────────────────────────────────────────────────────────────────────────

def test_fingerprint_stable_across_rename_and_translation(tmp_path):
    a = _write(tmp_path / "a.yml", _wf(FOUR_NODE, FOUR_EDGES, titles={1: "Extract JSON"}))
    b = _write(tmp_path / "b.yml", _wf(FOUR_NODE, FOUR_EDGES, titles={1: "JSONを抽出する"}))
    fa, fb = catalog.fingerprint_file(a), catalog.fingerprint_file(b)
    assert fa["fingerprint"] == fb["fingerprint"] == "code:1|end:1|llm:1|start:1/e:3"
    assert fa["node_count"] == 4
    assert fa["sha256"] != fb["sha256"]  # exactly the near-dup a sha misses


def test_fingerprint_drops_helper_nodes_and_their_edges(tmp_path):
    plain = _write(tmp_path / "plain.yml", _wf(FOUR_NODE, FOUR_EDGES))
    helper = _write(
        tmp_path / "helper.yml",
        _wf(FOUR_NODE, FOUR_EDGES,
            helper_nodes=["iteration-start", "loop-start"],
            helper_edges=[("h0", "n1"), ("n2", "h1")]),  # edges touching helpers must not count
    )
    assert catalog.fingerprint_file(plain)["fingerprint"] == catalog.fingerprint_file(helper)["fingerprint"]


def test_fingerprint_multiset_not_set(tmp_path):
    one_llm = _write(tmp_path / "one.yml", _wf(FOUR_NODE, FOUR_EDGES))
    two_llm = _write(tmp_path / "two.yml", _wf(FOUR_NODE + ["llm"], FOUR_EDGES + [(3, 4)]))
    assert (catalog.fingerprint_file(one_llm)["fingerprint"]
            != catalog.fingerprint_file(two_llm)["fingerprint"])  # index's node_types SET can't see this


def test_non_workflow_yaml_returns_none(tmp_path):
    p = tmp_path / "notes.yml"
    p.write_text("just: [a, list]\n", encoding="utf-8")
    assert catalog.fingerprint_file(p) is None


# ── seed ─────────────────────────────────────────────────────────────────────────────────────────

def _shelf_root(tmp_path):
    """A fake repo root with two curated patterns + one example-tier file."""
    root = tmp_path / "root"
    _write(root / "templates/patterns/four.yml", _wf(FOUR_NODE, FOUR_EDGES))
    _write(root / "templates/patterns/trivial.yml", _wf(["start", "llm", "end"], [(0, 1), (1, 2)]))
    _write(root / "examples/agentic.yml", _wf(["start", "agent", "tool", "if-else", "end"],
                                              [(0, 1), (1, 2), (2, 3), (3, 4)]))
    (root / "templates/library").mkdir(parents=True)
    return root


def test_seed_is_idempotent_and_covers_non_curated_tiers(tmp_path):
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    added1, _ = catalog.seed(root=root, catalog_path=cat_path)
    added2, skipped2 = catalog.seed(root=root, catalog_path=cat_path)
    assert added1 == 3 and added2 == 0 and skipped2 == 3
    entries = catalog.load_catalog(cat_path)["entries"]
    assert {e["tier"] for e in entries.values()} == {"patterns", "example"}
    assert all(e["decision"] == "shelf" for e in entries.values())
    # repo-relative paths only — never the machine-absolute paths index.json carries
    assert all(not Path(e["path"]).is_absolute() for e in entries.values())


def test_seed_skips_gitignored_project_scratch(tmp_path):
    """The builder writes QA runs to gitignored projects/ dirs (spec 011 R2); the TRACKED
    collected.json must mirror the index (which filters them), never local scratch."""
    root = _shelf_root(tmp_path)
    _write(root / "projects/_drafts/qa_run/workflows/main.yml", _wf(FOUR_NODE, FOUR_EDGES))
    _write(root / "projects/real_project/wf/workflows/main.yml",
           _wf(["start", "agent", "code", "end"], [(0, 1), (1, 2), (2, 3)]))
    subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / ".gitignore").write_text("projects/_drafts/\n", encoding="utf-8")

    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    paths = {e["path"] for e in catalog.load_catalog(cat_path)["entries"].values()}
    assert "projects/real_project/wf/workflows/main.yml" in paths
    assert not any("_drafts" in p for p in paths)


# ── check: three verdicts + the weak-signal hard rule ────────────────────────────────────────────

def test_check_three_verdicts_against_catalog(tmp_path):
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)

    dup = _write(tmp_path / "dup.yml",
                 yaml.safe_load((root / "templates/patterns/four.yml").read_text()))
    near = _write(tmp_path / "near.yml", _wf(FOUR_NODE, FOUR_EDGES, titles={2: "translated prompt"}))
    fresh = _write(tmp_path / "fresh.yml",
                   _wf(["start", "http-request", "code", "template-transform", "end"],
                       [(0, 1), (1, 2), (2, 3), (3, 4)]))

    assert catalog.check_file(dup, catalog_path=cat_path)["verdict"] == "dup"
    assert catalog.check_file(near, catalog_path=cat_path)["verdict"] == "near-dup"
    assert catalog.check_file(fresh, catalog_path=cat_path)["verdict"] == "new"


def test_weak_shape_fingerprint_match_is_never_dup(tmp_path):
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    # same 3-node shape as trivial.yml, different prompt → fingerprint collides, sha doesn't
    weak = _write(tmp_path / "weak.yml",
                  _wf(["start", "llm", "end"], [(0, 1), (1, 2)], titles={1: "totally different"}))
    v = catalog.check_file(weak, catalog_path=cat_path)
    assert v["verdict"] == "near-dup"  # NEVER "dup" — dup is sha256-only (spec 078 v2.1)
    assert v["weak"] is True and v["node_count"] == 3


def test_record_rejected_then_check_replays_the_reason(tmp_path):
    cat_path = tmp_path / "collected.json"
    cand = _write(tmp_path / "cand.yml", _wf(FOUR_NODE, FOUR_EDGES))
    catalog.record(cand, "rejected", "no license on the source repo",
                   url="https://github.com/x/y", tier="B", catalog_path=cat_path)
    v = catalog.check_file(cand, catalog_path=cat_path)
    assert v["verdict"] == "dup"
    assert v["prior_decision"] == "rejected"
    assert v["prior_reason"] == "no license on the source repo"


def test_hunt_log_appends(tmp_path):
    cat_path = tmp_path / "collected.json"
    catalog.hunt_log("dify-workflow pushed:>2026-07-01", new=2, dup=5, rejected=1,
                     catalog_path=cat_path)
    catalog.hunt_log("mode: workflow in:file", catalog_path=cat_path)
    hunts = catalog.load_catalog(cat_path)["hunts"]
    assert len(hunts) == 2 and hunts[0]["new"] == 2 and hunts[1]["query"].startswith("mode:")


# ── check --shelf: the S2 nudge mode (live parse, no collected.json) ─────────────────────────────

def test_shelf_mode_parses_live_and_ignores_catalog(tmp_path):
    root = _shelf_root(tmp_path)
    # NO seed on purpose: --shelf must work (and self-quench) without collected.json existing at all.
    known = _write(tmp_path / "known.yml", _wf(FOUR_NODE, FOUR_EDGES, titles={1: "renamed"}))
    fresh = _write(tmp_path / "fresh.yml",
                   _wf(["start", "knowledge-retrieval", "llm", "if-else", "end"],
                       [(0, 1), (1, 2), (2, 3), (3, 4)]))
    assert catalog.check_file(known, shelf=True, root=root)["verdict"] == "near-dup"
    v_fresh = catalog.check_file(fresh, shelf=True, root=root)
    assert v_fresh["verdict"] == "new" and v_fresh["node_count"] >= 4

    # self-quench: "promote" the fresh shape onto the shelf → the same check flips to dup, live
    _write(root / "templates/library/fresh.yml", yaml.safe_load(fresh.read_text()))
    assert catalog.check_file(fresh, shelf=True, root=root)["verdict"] == "dup"


# ── doctor ───────────────────────────────────────────────────────────────────────────────────────

def test_doctor_flags_curated_dup_but_not_house_weak_collisions(tmp_path):
    root = _shelf_root(tmp_path)
    problems, _notes = catalog.doctor(root=root)
    assert problems == []  # distinct shapes → clean baseline

    # a byte-identical copy inside the curated tier = the one thing doctor must hard-flag
    src = root / "templates/patterns/four.yml"
    (root / "templates/library/copy.yml").write_text(src.read_text(), encoding="utf-8")
    problems, _notes = catalog.doctor(root=root)
    assert any("sha256 dup" in p for p in problems)

    # weak 3-node collisions OUTSIDE curated are notes, never problems (spec 078 §5-c)
    _write(root / "examples/chat-a.yml", _wf(["start", "llm", "end"], [(0, 1), (1, 2)], titles={1: "en→ja"}))
    _write(root / "examples/chat-b.yml", _wf(["start", "llm", "end"], [(0, 1), (1, 2)], titles={1: "ja→en"}))
    problems2, notes2 = catalog.doctor(root=root)
    assert not any("chat-a" in p for p in problems2)
    assert any("weak-signal" in n for n in notes2)


# ── CLI smoke (the surface S2/S3 actually call) ──────────────────────────────────────────────────

def test_cli_check_shelf_json_on_a_real_pattern(tmp_path):
    """Proof the live shelf parse works through the exact CLI the backend invokes: a byte-identical
    COPY (outside the shelf) must report dup-of the shelf original. The on-shelf file itself reads
    'new' — spec 083 self-exclusion: the share preflight runs AFTER finalize landed the pattern, so
    a self sha-match would read 'dup of itself' and mask any real near-dup."""
    target = BASE / "templates" / "patterns" / "agent-with-tools.yml"
    copy = tmp_path / "candidate.yml"
    copy.write_bytes(target.read_bytes())
    out = subprocess.run(
        [sys.executable, str(BASE / "tools/dify_base/catalog.py"), "check", str(copy),
         "--shelf", "--json"],
        capture_output=True, text=True, check=True,
    )
    v = json.loads(out.stdout)
    assert v["verdict"] == "dup"
    assert v["match"] == "templates/patterns/agent-with-tools.yml"
    assert v["fingerprint"].startswith("agent:1")
    out_self = subprocess.run(
        [sys.executable, str(BASE / "tools/dify_base/catalog.py"), "check", str(target),
         "--shelf", "--json"],
        capture_output=True, text=True, check=True,
    )
    assert json.loads(out_self.stdout)["verdict"] == "new", "a file is never a duplicate of itself"


# ── repo-level record (--url, no file) — gap found on hunt #1 (2026-07-28) ───────────────────────

def test_record_url_only_repo_level(tmp_path):
    """A repo-level decision (empty repo / plugin-not-DSL) has no file to hash — record must accept
    --url alone, key by sha12(url), and replay on re-record (upsert, not duplicate)."""
    cat_path = tmp_path / "collected.json"
    url = "https://github.com/someone/empty-dify-repo"
    e = catalog.record(None, "rejected", "0 yml files", url=url, tier="B", catalog_path=cat_path)
    assert e["key"] == hashlib.sha256(url.encode()).hexdigest()[:12]
    assert "sha256" not in e and "fingerprint" not in e  # no file → no content hashes
    # upsert: re-record same url updates, does not duplicate
    catalog.record(None, "rejected", "still empty", url=url, catalog_path=cat_path)
    cat = catalog.load_catalog(cat_path)
    assert len([k for k, v in cat["entries"].items() if v.get("url") == url]) == 1
    assert cat["entries"][e["key"]]["reason"] == "still empty"


def test_record_no_file_no_url_is_an_error(tmp_path):
    with pytest.raises(ValueError):
        catalog.record(None, "rejected", "x", catalog_path=tmp_path / "c.json")


# ── stats (spec 080 S1) — the shelf-dashboard feed ───────────────────────────────────────────────

def _fake_index(root, entries):
    """Write a minimal index.json under the fake root (stats reads it root-relative)."""
    p = root / "tools" / "dify_base" / "index.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(entries), encoding="utf-8")


def _index_entry(source, file, **kw):
    return {"source": source, "file": file, "path": f"{source}/{file}",
            "complexity": kw.pop("complexity", "Simple"),
            "has_llm": kw.pop("has_llm", True), "has_code": kw.pop("has_code", False),
            "tags": kw.pop("tags", []), **kw}


def _stamp_provenance(path, promoted, source="original"):
    """Prepend an x-provenance header (the finalizePromotion / template-promote convention)."""
    body = path.read_text(encoding="utf-8")
    header = (f"# x-provenance: source={source} repo=https://example.git\n"
              f'#   commit=abc1234 file="x.yml" orig_sha256=deadbeef promoted={promoted} license=MIT\n')
    path.write_text(header + body, encoding="utf-8")


def test_stats_schema_counts_and_patterns_promotes(tmp_path):
    """The v1.1 case (a): a promote stamped in templates/patterns/ MUST appear in `promotes` —
    finalizePromotion stamps patterns/, and a library-only reader is blind exactly where the
    078 nudge lands its output."""
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    _fake_index(root, [
        _index_entry("patterns", "four.yml", has_code=True),
        _index_entry("patterns", "trivial.yml", tags=["translate"]),
        _index_entry("example", "agentic.yml", complexity="Medium", has_agent=True, tags=["agent"]),
    ])
    _stamp_provenance(root / "templates/patterns/four.yml", "2026-07-15")

    s = catalog.stats(root=root, catalog_path=cat_path)
    assert s["ok"] is True
    assert s["total"] == 3
    assert {t["tier"]: t["count"] for t in s["tiers"]} == {"patterns": 2, "example": 1}
    feats = {f["key"]: f["count"] for f in s["features"]}
    assert feats["has_llm"] == 3 and feats["has_code"] == 1 and feats["has_agent"] == 1
    assert s["complexity"] == {"Simple": 2, "Medium": 1}
    assert s["tags"]["unique"] == 2
    assert [p["file"] for p in s["promotes"]] == ["four.yml"]
    assert s["promotes"][0]["tier"] == "patterns"
    assert s["seed_coverage"]["stale"] is False
    assert s["doctor"]["curated_problems"] == []
    assert s["hunts"] == {"count": 0, "last": None, "median_new": None}


def test_stats_flags_stale_seed(tmp_path):
    """The v1.1 case (b): an indexed file missing from collected.json → stale seed + a hint."""
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    _fake_index(root, [_index_entry("patterns", f"f{i}.yml") for i in range(4)])  # 4 > 3 seeded
    s = catalog.stats(root=root, catalog_path=cat_path)
    assert s["seed_coverage"] == {"indexed": 4, "seeded": 3, "stale": True}
    assert any("catalog.py seed" in h for h in s["hints"])


def test_stats_rejected_and_repo_level_not_in_diversity(tmp_path):
    """The v1.1 case (c): hunt leftovers — a rejected FILE and a URL-keyed repo-level entry —
    are memory about the outside world, never shelf diversity."""
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    reject = _write(tmp_path / "reject.yml",
                    _wf(["start", "question-classifier", "llm", "llm", "end"],
                        [(0, 1), (1, 2), (1, 3), (2, 4), (3, 4)]))
    catalog.record(reject, "rejected", "no license", url="https://x/y", catalog_path=cat_path)
    catalog.record(None, "rejected", "empty repo", url="https://x/empty", catalog_path=cat_path)
    _fake_index(root, [_index_entry("patterns", f"f{i}.yml") for i in range(3)])
    s = catalog.stats(root=root, catalog_path=cat_path)
    assert s["diversity"]["files"] == 3  # the 3 seeded shelf files only
    assert s["seed_coverage"]["seeded"] == 3


def test_stats_missing_index_is_not_ok(tmp_path):
    root = _shelf_root(tmp_path)  # no index.json written
    s = catalog.stats(root=root, catalog_path=tmp_path / "collected.json")
    assert s["ok"] is False
    assert "build_index.py" in s["hint"]


def test_stats_curated_dup_surfaces_in_doctor_block(tmp_path):
    root = _shelf_root(tmp_path)
    cat_path = tmp_path / "collected.json"
    catalog.seed(root=root, catalog_path=cat_path)
    src = root / "templates/patterns/four.yml"
    (root / "templates/library/copy.yml").write_text(src.read_text(), encoding="utf-8")
    _fake_index(root, [_index_entry("patterns", "four.yml")])
    s = catalog.stats(root=root, catalog_path=cat_path)
    assert any("sha256 dup" in p for p in s["doctor"]["curated_problems"])


def test_cli_stats_json_on_the_real_repo():
    """The exact surface GET /api/dev/shelf spawns — must emit one parseable JSON object."""
    out = subprocess.run(
        [sys.executable, str(BASE / "tools/dify_base/catalog.py"), "stats", "--json"],
        capture_output=True, text=True, check=True,
    )
    s = json.loads(out.stdout)
    assert s["ok"] is True and s["total"] >= 1
    assert {"tiers", "features", "diversity", "doctor", "promotes", "sources", "hunts"} <= set(s)


def test_check_shelf_excludes_the_candidate_itself(tmp_path):
    """Spec 083 — the share preflight checks a pattern AFTER finalize already landed it on
    templates/patterns/: its own shelf entry must not sha-match (else every share reads
    'dup of itself'), and the self-match must not MASK a real dup with a DIFFERENT file."""
    root = _shelf_root(tmp_path)
    on_shelf = root / "templates/patterns/four.yml"
    assert catalog.check_file(on_shelf, shelf=True, root=root)["verdict"] == "new"
    _write(root / "templates/patterns/four-copy.yml", _wf(FOUR_NODE, FOUR_EDGES))
    v = catalog.check_file(on_shelf, shelf=True, root=root)
    assert v["verdict"] == "dup" and v["match"] == "templates/patterns/four-copy.yml"

"""Spec 022 D4/D6/D7: provenance header parsing, staleness classification, license hygiene.

Covers the promoted-template machinery: parse/format round-trip, the comment-header-vs-reserialization
hazard (why the writer must run last), current/stale/orphan classification, license gating, and that
the one real promoted template (templates/library/seo-slug-generator.yml) is `current`.
"""
import sys
from pathlib import Path

import pytest
import yaml

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE / "tools" / "dify_base"))

import provenance  # noqa: E402
import check_provenance as cp  # noqa: E402
from sources import load_sources  # noqa: E402

TEMPLATE = BASE / "templates" / "library" / "seo-slug-generator.yml"


def test_parse_real_template_header():
    f = provenance.parse_header(TEMPLATE)
    assert f is not None
    assert f["source"] == "awesome-dify-workflow-en"
    assert f["license"] == "MIT"
    assert f["file"] == "Workflow-Store/SEO Slug Generator.yml"   # quoted value w/ spaces preserved
    assert len(f["orig_sha256"]) == 64


def test_format_parse_round_trip(tmp_path):
    fields = {
        "source": "s", "repo": "https://e/r.git", "commit": "abc1234",
        "file": "DSL/a b.yml", "orig_sha256": "f" * 64, "promoted": "2026-06-22", "license": "MIT",
    }
    p = tmp_path / "t.yml"
    p.write_text(provenance.format_header(fields, preamble=["Title here"]) + "app: {}\n", encoding="utf-8")
    assert provenance.parse_header(p) == fields


def test_parse_returns_none_without_header(tmp_path):
    p = tmp_path / "plain.yml"
    p.write_text("# just a comment\napp:\n  name: x\n", encoding="utf-8")
    assert provenance.parse_header(p) is None


def test_comment_header_does_not_survive_yaml_reserialization():
    """The hazard motivating inject-last (spec 022 D4): PyYAML strips the comment on dump."""
    data = yaml.safe_load(TEMPLATE.read_text(encoding="utf-8"))
    dumped = yaml.safe_dump(data)
    assert "x-provenance" not in dumped
    # ...but the on-disk file (written last, never reserialized) still carries it:
    assert provenance.parse_header(TEMPLATE) is not None


def test_real_template_classifies_current():
    sbn = {s["name"]: s for s in load_sources()}
    f = provenance.parse_header(TEMPLATE)
    # Only meaningful when the upstream clone is present (skip in clone-less environments).
    if not (BASE / "corpus" / f["source"] / f["file"]).exists():
        pytest.skip("upstream clone not present")
    status, _ = cp.classify(f, sbn)
    assert status == "current"


def test_classify_stale_and_orphan():
    sbn = {s["name"]: s for s in load_sources()}
    base = {"source": "awesome-dify-workflow-en", "file": "Workflow-Store/SEO Slug Generator.yml",
            "orig_sha256": "0" * 64, "license": "MIT"}
    if (BASE / "corpus" / base["source"] / base["file"]).exists():
        assert cp.classify(base, sbn)[0] == "stale"          # file present, hash differs
    assert cp.classify({**base, "source": "no-such-source"}, sbn)[0] == "orphan"
    assert cp.classify({"source": "original"}, sbn)[0] == "current"


def test_license_hygiene():
    sbn = {s["name"]: s for s in load_sources()}
    assert cp.license_problems({"source": "original", "license": "MIT"}, sbn) == []
    assert cp.license_problems({"source": "original", "license": ""}, sbn)          # missing
    assert cp.license_problems({"source": "original", "license": "GPL-3.0"}, sbn)   # non-permissive


def test_strict_mode_fails_on_non_permissive(tmp_path):
    fields = {"source": "original", "repo": "", "commit": "", "file": "",
              "orig_sha256": "", "promoted": "2026-06-22", "license": "GPL-3.0"}
    (tmp_path / "bad.yml").write_text(provenance.format_header(fields) + "app: {}\n", encoding="utf-8")
    assert cp.main(["--dir", str(tmp_path)]) == 0            # warn-only
    assert cp.main(["--strict", "--dir", str(tmp_path)]) == 1  # gated


def test_library_template_passes_strict():
    """The real promoted template must keep the curated tier clean under --strict (AC4/AC6)."""
    f = provenance.parse_header(TEMPLATE)
    if not (BASE / "corpus" / f["source"] / f["file"]).exists():
        pytest.skip("upstream clone not present")
    assert cp.main(["--strict"]) == 0

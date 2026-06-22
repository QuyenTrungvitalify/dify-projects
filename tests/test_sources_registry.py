"""Spec 022 D1–D3: the source registry (corpus/sources.yml) and its two readers.

Covers: the Python reader (sources.py), the bash shim (scripts/lib/sources.sh), that the two agree,
and that build_index.py turns the registry into `corpus:<name>` scan targets + the new `library` tier.
"""
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE / "tools" / "dify_base"))

from sources import load_sources, validate, PERMISSIVE_LICENSES  # noqa: E402


def _shim(yml_path):
    """Run the bash shim and return its pipe-delimited lines."""
    sh = BASE / "scripts" / "lib" / "sources.sh"
    out = subprocess.run(
        ["bash", "-c", f'. "{sh}"; sources_list "{yml_path}"'],
        capture_output=True, text=True, check=True,
    )
    return [ln for ln in out.stdout.splitlines() if ln.strip()]


def test_registry_has_awesome_source():
    srcs = load_sources()
    by_name = {s["name"]: s for s in srcs}
    assert "awesome-dify-workflow" in by_name
    a = by_name["awesome-dify-workflow"]
    assert a["license"] == "MIT"
    assert a["sparse"] == ["DSL"]
    assert a["ref"] == "main"
    assert a["dsl_glob"].endswith("*.yml")


def test_registry_is_clean_and_permissive():
    srcs = load_sources()
    assert list(validate(srcs)) == []
    for s in srcs:
        assert s["license"] in PERMISSIVE_LICENSES


def test_bash_shim_matches_python_reader():
    lines = _shim(BASE / "corpus" / "sources.yml")
    py = load_sources()
    assert len(lines) == len(py)
    for line, s in zip(lines, py):
        name, repo, ref, sparse, glob, license = line.split("|")
        assert name == s["name"]
        assert repo == s["repo"]
        assert ref == s["ref"]
        assert sparse == ",".join(s["sparse"])
        assert glob == s["dsl_glob"]
        assert license == s["license"]


def test_bash_shim_handles_multiple_sources(tmp_path):
    """The shim must parse N sources, multi-dir sparse, and strip inline comments — the AC2 mechanism."""
    yml = tmp_path / "sources.yml"
    yml.write_text(
        "sources:\n"
        "  - name: one\n"
        "    repo: https://example.com/one.git\n"
        "    ref: main                 # inline comment stripped\n"
        "    sparse: [DSL]\n"
        '    dsl_glob: "DSL/**/*.yml"\n'
        "    license: MIT\n"
        "  - name: two\n"
        "    repo: https://example.com/two.git\n"
        "    ref: v1.0\n"
        "    sparse: [workflows, assets]\n"
        '    dsl_glob: "workflows/**/*.yml"\n'
        "    license: Apache-2.0\n",
        encoding="utf-8",
    )
    lines = _shim(yml)
    assert len(lines) == 2
    one = lines[0].split("|")
    two = lines[1].split("|")
    assert one == ["one", "https://example.com/one.git", "main", "DSL", "DSL/**/*.yml", "MIT"]
    assert two == ["two", "https://example.com/two.git", "v1.0", "workflows,assets",
                   "workflows/**/*.yml", "Apache-2.0"]


def test_validate_flags_non_permissive_license():
    bad = [{"name": "x", "repo": "https://e/x.git", "license": "GPL-3.0"}]
    problems = list(validate(bad))
    assert any("permissive" in p for p in problems)


def test_build_index_scan_targets_are_registry_driven():
    import build_index
    targets = build_index.scan_targets()
    tags = [tag for _dir, tag, _glob in targets]
    assert "corpus:awesome-dify-workflow" in tags   # per-source provenance tag
    assert "library" in tags                          # new curated tier (spec 022 Q5)
    assert "corpus" not in tags                       # old flat tag is gone


def test_gitignored_clones_are_indexed_including_ascii_names():
    """Regression (spec 022, 2026-06-22): corpus/ and skills/ are gitignored-by-design clones we DO
    want indexed. The gitignore filter is scoped to projects/ only; before the fix it silently dropped
    every ASCII-named file (non-ASCII survived only via git check-ignore's octal quoting).

    Scans live disk via collect_entries() (no reliance on the gitignored index.json), and guards each
    assertion on the clone being present so it stays green where corpus/skills aren't cloned."""
    import build_index
    entries, _ = build_index.collect_entries()
    files = {e["file"] for e in entries}
    sources = {e["source"] for e in entries}
    if (BASE / "corpus" / "awesome-dify-workflow" / "DSL" / "json-repair.yml").exists():
        assert "json-repair.yml" in files, "ASCII-named corpus file dropped — _filter_gitignored over-filtered"
    if (BASE / "skills" / "mango-svip" / "assets").exists():
        assert "skill-assets" in sources, "gitignored skills/ clone not indexed"

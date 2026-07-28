"""Spec 022 D1–D3: the source registry (corpus/sources.yml) and its two readers.

Covers: the Python reader (sources.py), the bash shim (scripts/lib/sources.sh), that the two agree,
and that build_index.py turns the registry into `corpus:<name>` scan targets + the new `library` tier.
"""
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE / "tools" / "dify_base"))

from sources import (  # noqa: E402
    load_sources, validate, PERMISSIVE_LICENSES,
    license_problems, missing_field_problems,
)


def _shim(yml_path):
    """Run the bash shim and return its pipe-delimited lines."""
    sh = BASE / "scripts" / "lib" / "sources.sh"
    out = subprocess.run(
        ["bash", "-c", f'. "{sh}"; sources_list "{yml_path}"'],
        capture_output=True, text=True, check=True,
    )
    return [ln for ln in out.stdout.splitlines() if ln.strip()]


def test_registry_has_en_source():
    srcs = load_sources()
    by_name = {s["name"]: s for s in srcs}
    assert "awesome-dify-workflow-en" in by_name      # English-only registry
    a = by_name["awesome-dify-workflow-en"]
    assert a["license"] == "MIT"
    assert a["sparse"] == ["Workflow-Store"]
    assert a["ref"] == "main"
    assert a["dsl_glob"].endswith("*.yml")
    assert a["indexed"] is True                       # default; the Chinese intake source was removed
    assert "awesome-dify-workflow" not in by_name     # Chinese source fully removed from the registry


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
    assert "library" in tags                          # new curated tier (spec 022 Q5)
    assert "corpus" not in tags                       # old flat tag is gone
    assert "corpus:awesome-dify-workflow-en" in tags  # an indexed source IS a scan target


# ── spec 023: intake-only sources (`indexed: false`) ──────────────────────────────────────────────


def test_indexed_defaults_true_and_flag_is_parsed(tmp_path):
    """A missing/true `indexed` → True; `indexed: false` → False (AC4 default + the new switch)."""
    yml = tmp_path / "sources.yml"
    yml.write_text(
        "sources:\n"
        "  - name: default-key\n"          # no indexed: key → defaults True
        "    repo: https://e/a.git\n"
        "    license: MIT\n"
        "  - name: hidden\n"
        "    repo: https://e/b.git\n"
        "    license: MIT\n"
        "    indexed: false\n"
        "  - name: explicit-true\n"
        "    repo: https://e/c.git\n"
        "    license: MIT\n"
        "    indexed: true\n",
        encoding="utf-8",
    )
    by_name = {s["name"]: s for s in load_sources(yml)}
    assert by_name["default-key"]["indexed"] is True
    assert by_name["hidden"]["indexed"] is False
    assert by_name["explicit-true"]["indexed"] is True


def test_hidden_source_excluded_from_scan_targets(monkeypatch):
    """AC1: an `indexed: false` source produces NO `corpus:<name>` scan target; an indexed one does."""
    import build_index
    fake = [
        {"name": "shown", "indexed": True, "dsl_glob": "DSL/**/*.yml"},
        {"name": "hidden", "indexed": False, "dsl_glob": "DSL/**/*.yml"},
    ]
    monkeypatch.setattr(build_index, "load_sources", lambda *a, **k: fake)
    tags = [tag for _dir, tag, _glob in build_index.scan_targets()]
    assert "corpus:shown" in tags
    assert "corpus:hidden" not in tags


def test_real_registry_yields_en_scan_target():
    """End-to-end against the real (English-only) registry: EN is a scan target; the Chinese source,
    fully removed, is absent. (The `indexed: false` exclusion itself is covered by the synthetic
    test_hidden_source_excluded_from_scan_targets above.)"""
    import build_index
    tags = [tag for _dir, tag, _glob in build_index.scan_targets()]
    assert "corpus:awesome-dify-workflow-en" in tags
    assert "corpus:awesome-dify-workflow" not in tags   # Chinese source removed from the registry


def test_bash_shim_ignores_indexed(tmp_path):
    """D3/AC1: the `indexed:` line never reaches the bash shim — it still emits exactly 6 fields,
    so setup.sh / update_corpus.sh clone + fetch the source unconditionally."""
    yml = tmp_path / "sources.yml"
    yml.write_text(
        "sources:\n"
        "  - name: hidden\n"
        "    repo: https://example.com/h.git\n"
        "    ref: main\n"
        "    sparse: [DSL]\n"
        '    dsl_glob: "DSL/**/*.yml"\n'
        "    license: MIT\n"
        "    indexed: false\n",
        encoding="utf-8",
    )
    lines = _shim(yml)
    assert len(lines) == 1
    fields = lines[0].split("|")
    assert fields == ["hidden", "https://example.com/h.git", "main", "DSL", "DSL/**/*.yml", "MIT"]
    assert "false" not in fields and "indexed" not in lines[0]   # flag did not leak into the output


# ── spec 075 S3: validate() split (block license / warn field) reaches the build runtime ───────────


def test_license_and_field_problems_are_separable():
    """S3 rests on splitting validate() into a BLOCK subset (license) and a WARN subset (fields)."""
    bad_license = {"name": "a", "repo": "r", "license": "GPL-3.0"}   # all fields present, bad license
    missing_repo = {"name": "b", "license": "MIT"}                    # permissive, but no repo
    assert any("GPL-3.0" in p for p in license_problems([bad_license]))
    assert list(license_problems([missing_repo])) == []
    assert any("missing required 'repo'" in p for p in missing_field_problems([missing_repo]))
    assert list(missing_field_problems([bad_license])) == []
    # validate() still exposes BOTH (CLI/back-compat) — the parity + CLI tests depend on this.
    assert len(list(validate([bad_license, missing_repo]))) == 2


def test_build_index_blocks_non_permissive_license(monkeypatch, capsys):
    """S3: a copyleft source in the registry fails the build HARD (exit != 0), reason verbatim, and
    returns BEFORE any index file is written."""
    import build_index
    monkeypatch.setattr(build_index, "load_sources",
                        lambda *a, **k: [{"name": "bad", "repo": "https://e/b.git", "license": "GPL-3.0"}])
    rc = build_index.main()
    assert rc == 1, "non-permissive license must block the build"
    err = capsys.readouterr().err
    assert "GPL-3.0" in err and "permissive" in err


def test_build_index_warns_missing_field_but_still_builds(monkeypatch, capsys, tmp_path):
    """S3: a missing required field WARNS but does not block — the build completes (exit 0). BASE is
    redirected to tmp_path so the real INDEX.md / index.json are never touched."""
    import build_index
    # missing 'repo'; `indexed` present because write_markdown reads it (real load_sources fills it).
    monkeypatch.setattr(build_index, "load_sources",
                        lambda *a, **k: [{"name": "incomplete", "license": "MIT", "indexed": True}])
    monkeypatch.setattr(build_index, "collect_entries", lambda: ([], []))
    monkeypatch.setattr(build_index, "BASE", tmp_path)
    rc = build_index.main()
    assert rc == 0, "a missing field must warn, not block"
    err = capsys.readouterr().err
    assert "missing required 'repo'" in err


# ── spec 075 S4: broken YAML is NAMED, not folded into an anonymous count ──────────────────────────


def test_build_index_names_broken_yaml(monkeypatch, capsys, tmp_path):
    """S4: a genuinely broken YAML in a scan target has its NAME surfaced; a valid non-workflow YAML is
    skipped silently; the build still completes (intake is reference-only, warn-not-gate)."""
    import build_index
    (tmp_path / "broken.yml").write_text("key: [unclosed\n  bad: : :\n", encoding="utf-8")
    (tmp_path / "not-a-workflow.yml").write_text("- just\n- a\n- list\n", encoding="utf-8")  # valid, non-dict
    (tmp_path / "wf.yml").write_text(
        "app:\n  name: X\n  mode: workflow\nworkflow:\n  graph:\n    nodes: []\n", encoding="utf-8")
    monkeypatch.setattr(build_index, "scan_targets", lambda: [(tmp_path, "corpus:test", "*.yml")])
    monkeypatch.setattr(build_index, "load_sources", lambda *a, **k: [])
    monkeypatch.setattr(build_index, "BASE", tmp_path)
    rc = build_index.main()
    assert rc == 0
    err = capsys.readouterr().err
    assert "broken.yml" in err and "FAILED to parse" in err, "the broken file must be named (S4)"
    assert "not-a-workflow.yml" not in err, "valid non-workflow YAML must NOT be named (no noise)"


def test_build_index_says_zero_when_nothing_broke(monkeypatch, capsys, tmp_path):
    """S4: a clean run reads differently from one that dropped N files — the '0' is explicit."""
    import build_index
    monkeypatch.setattr(build_index, "collect_entries", lambda: ([], []))
    monkeypatch.setattr(build_index, "load_sources", lambda *a, **k: [])
    monkeypatch.setattr(build_index, "BASE", tmp_path)
    rc = build_index.main()
    assert rc == 0
    assert "0 files failed to parse" in capsys.readouterr().out


# ── spec 075 S5: `sources_admin add/doctor` — validate-before-write + the flat-schema trap ─────────


def _seed_registry(path, body="  - name: existing\n    repo: https://e/e.git\n    ref: main\n"
                              '    sparse: [DSL]\n    dsl_glob: "DSL/**/*.yml"\n    license: MIT\n'):
    path.write_text("sources:\n" + body, encoding="utf-8")


def _wire_admin(monkeypatch, tmp_path, yml):
    """Point sources_admin's module globals at a tmp registry (its dup-check + paths read them)."""
    import sources_admin
    monkeypatch.setattr(sources_admin, "SOURCES_YML", yml)
    monkeypatch.setattr(sources_admin, "BASE", tmp_path)
    monkeypatch.setattr(sources_admin, "CORPUS_DIR", tmp_path / "corpus")
    monkeypatch.setattr(sources_admin, "load_sources", lambda *a, **k: load_sources(yml))
    return sources_admin


def test_sources_admin_add_writes_flat_and_shim_reads_it_back(tmp_path, monkeypatch):
    """THE anti-regression for the S5 trap: a valid `add` appends flat text that BOTH parsers read
    identically — proving the writer never reflowed the file into shim-breaking nested YAML."""
    yml = tmp_path / "sources.yml"
    _seed_registry(yml)
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["add", "--name", "new-src", "--repo", "https://e/n.git",
                     "--license", "Apache-2.0", "--sparse", "workflows,assets",
                     "--glob", "workflows/**/*.yml"])
    assert rc == 0
    py = {s["name"]: s for s in load_sources(yml)}
    assert "new-src" in py and py["new-src"]["sparse"] == ["workflows", "assets"]
    assert py["new-src"]["ref"] == "main"  # Open Q4: no SHA pin at add-time
    # the bash shim (bootstrap parser) reads the new entry with all six fields intact…
    got = {ln.split("|")[0]: ln.split("|") for ln in _shim(yml)}
    assert got["new-src"] == ["new-src", "https://e/n.git", "main",
                              "workflows,assets", "workflows/**/*.yml", "Apache-2.0"]
    # …and the two parsers still agree on the whole mutated file (parity holds after the write).
    assert len(_shim(yml)) == len(load_sources(yml))


def test_sources_admin_add_indexed_false_writes_the_flag(tmp_path, monkeypatch):
    yml = tmp_path / "sources.yml"
    _seed_registry(yml)
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["add", "--name", "hidden", "--repo", "https://e/h.git",
                     "--license", "MIT", "--sparse", "DSL", "--indexed", "false"])
    assert rc == 0
    assert {s["name"]: s for s in load_sources(yml)}["hidden"]["indexed"] is False
    # the shim ignores `indexed:` — it must still emit exactly six fields (spec 023 D3).
    assert all(len(ln.split("|")) == 6 for ln in _shim(yml))


def test_sources_admin_add_bad_license_does_not_write(tmp_path, monkeypatch):
    """Validation runs BEFORE any write — a rejected add leaves the file byte-identical."""
    yml = tmp_path / "sources.yml"
    _seed_registry(yml)
    before = yml.read_text(encoding="utf-8")
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["add", "--name", "bad", "--repo", "https://e/b.git", "--license", "GPL-3.0"])
    assert rc == 1
    assert yml.read_text(encoding="utf-8") == before, "a rejected add must not touch the file"


def test_sources_admin_add_rejects_flat_schema_hazards(tmp_path, monkeypatch):
    """A sparse dir with whitespace would be mangled by the awk shim → refuse before writing."""
    yml = tmp_path / "sources.yml"
    yml.write_text("sources:\n", encoding="utf-8")
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["add", "--name", "x", "--repo", "https://e/x.git",
                     "--license", "MIT", "--sparse", "has space"])
    assert rc == 1
    assert yml.read_text(encoding="utf-8") == "sources:\n"


def test_sources_admin_add_refuses_duplicate_name(tmp_path, monkeypatch):
    yml = tmp_path / "sources.yml"
    _seed_registry(yml)
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["add", "--name", "existing", "--repo", "https://e/dup.git", "--license", "MIT"])
    assert rc == 1


def test_sources_admin_doctor_flags_non_permissive_license(tmp_path, monkeypatch, capsys):
    yml = tmp_path / "sources.yml"
    _seed_registry(yml, "  - name: copyleft\n    repo: https://e/c.git\n    ref: main\n"
                        '    sparse: [DSL]\n    dsl_glob: "DSL/**/*.yml"\n    license: GPL-3.0\n')
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["doctor"])
    assert rc == 1
    assert "GPL-3.0" in capsys.readouterr().err


def test_sources_admin_doctor_warns_on_pinned_ref_and_missing_clone(tmp_path, monkeypatch, capsys):
    """A pinned SHA ref and an un-cloned source are WARNINGS (exit 0) — doctor stays a light diagnostic."""
    yml = tmp_path / "sources.yml"
    _seed_registry(yml, "  - name: pinned\n    repo: https://e/p.git\n    ref: " + "a" * 40 + "\n"
                        '    sparse: [DSL]\n    dsl_glob: "DSL/**/*.yml"\n    license: MIT\n')
    admin = _wire_admin(monkeypatch, tmp_path, yml)
    rc = admin.main(["doctor"])
    assert rc == 0, "warnings alone do not fail doctor"
    out = capsys.readouterr().out
    assert "pinned SHA" in out and "not cloned" in out


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
    if (BASE / "corpus" / "awesome-dify-workflow-en" / "Workflow-Store" / "AdvancedSearch.yml").exists():
        assert "AdvancedSearch.yml" in files, "ASCII-named corpus file dropped — _filter_gitignored over-filtered"
    if (BASE / "skills" / "mango-svip" / "assets").exists():
        assert "skill-assets" in sources, "gitignored skills/ clone not indexed"

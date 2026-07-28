"""Spec 077 C1: the reproducibility lockfile (corpus/sources.lock) and its Python read/write surface.

The lock is a SEPARATE JSON file read only by Python post-venv — it never touches the flat awk shim, so
none of the sources.yml dual-parser parity is at stake here. These tests pin the two guarantees that
matter: (1) the serializer is deterministic + idempotent-on-SHA (no timestamp churn on no-op syncs),
and (2) every failure mode degrades to "unlocked" (empty), never an exception — the lock is advisory.
"""
import json
import sys
from pathlib import Path

BASE = Path(__file__).parent.parent
sys.path.insert(0, str(BASE / "tools" / "dify_base"))

from sources import load_lock, read_lock_sha, write_lock  # noqa: E402

SHA_A = "88842fcef7fd44be2ed0aea63c223468ba4c4a1a"
SHA_B = "1234567890abcdef1234567890abcdef12345678"


def test_load_lock_missing_returns_empty(tmp_path):
    assert load_lock(tmp_path / "nope.lock") == {}


def test_write_then_read_roundtrips(tmp_path):
    lock = tmp_path / "sources.lock"
    changed = write_lock("src", SHA_A, "main", updated="2026-07-27T00:00:00Z", path=lock)
    assert changed is True
    assert read_lock_sha("src", path=lock) == SHA_A
    entry = load_lock(lock)["src"]
    assert entry == {"resolved_sha": SHA_A, "ref": "main", "updated": "2026-07-27T00:00:00Z"}


def test_read_lock_sha_absent_returns_empty(tmp_path):
    lock = tmp_path / "sources.lock"
    write_lock("src", SHA_A, "main", updated="t", path=lock)
    assert read_lock_sha("other", path=lock) == ""       # unknown name → unlocked
    assert read_lock_sha("src", path=tmp_path / "x") == ""  # missing file → unlocked


def test_write_is_idempotent_on_same_pin(tmp_path):
    """A no-op sync must NOT rewrite the file — same (sha, ref) → return False, byte-identical file
    (keeps the `updated` timestamp and hence the git diff stable across weekly runs that change nothing)."""
    lock = tmp_path / "sources.lock"
    write_lock("src", SHA_A, "main", updated="2026-07-27T00:00:00Z", path=lock)
    before = lock.read_bytes()
    changed = write_lock("src", SHA_A, "main", updated="2026-07-27T09:99:99Z", path=lock)
    assert changed is False
    assert lock.read_bytes() == before, "idempotent write must not touch the file (no timestamp churn)"


def test_write_updates_on_new_sha(tmp_path):
    lock = tmp_path / "sources.lock"
    write_lock("src", SHA_A, "main", updated="t1", path=lock)
    changed = write_lock("src", SHA_B, "main", updated="t2", path=lock)
    assert changed is True
    assert read_lock_sha("src", path=lock) == SHA_B


def test_write_updates_when_only_ref_changes(tmp_path):
    """Same SHA but a different tracked ref is a real change (e.g. main→v2 branch rename) → rewrite."""
    lock = tmp_path / "sources.lock"
    write_lock("src", SHA_A, "main", updated="t1", path=lock)
    assert write_lock("src", SHA_A, "release", updated="t2", path=lock) is True
    assert load_lock(lock)["src"]["ref"] == "release"


def test_multiple_sources_are_sorted_and_independent(tmp_path):
    lock = tmp_path / "sources.lock"
    write_lock("zebra", SHA_A, "main", updated="t", path=lock)
    write_lock("alpha", SHA_B, "main", updated="t", path=lock)
    payload = json.loads(lock.read_text())
    assert list(payload["sources"].keys()) == ["alpha", "zebra"], "sources must serialize sorted (stable diffs)"
    assert read_lock_sha("zebra", path=lock) == SHA_A


def test_serialization_is_deterministic(tmp_path):
    """Two writes of the same content (built in different insertion orders) produce identical bytes."""
    a, b = tmp_path / "a.lock", tmp_path / "b.lock"
    write_lock("one", SHA_A, "main", updated="t", path=a)
    write_lock("two", SHA_B, "main", updated="t", path=a)
    write_lock("two", SHA_B, "main", updated="t", path=b)
    write_lock("one", SHA_A, "main", updated="t", path=b)
    assert a.read_bytes() == b.read_bytes()
    assert a.read_text().endswith("\n"), "trailing newline (POSIX text file)"


def test_corrupt_lock_degrades_to_empty(tmp_path):
    """A hand-mangled / truncated lock must read as unlocked, never raise (advisory-file contract)."""
    lock = tmp_path / "sources.lock"
    lock.write_text("{ this is not json", encoding="utf-8")
    assert load_lock(lock) == {}
    assert read_lock_sha("src", path=lock) == ""
    # and a subsequent write recovers cleanly (overwrites the garbage)
    assert write_lock("src", SHA_A, "main", updated="t", path=lock) is True
    assert read_lock_sha("src", path=lock) == SHA_A


def test_non_object_json_degrades_to_empty(tmp_path):
    lock = tmp_path / "sources.lock"
    lock.write_text("[1, 2, 3]", encoding="utf-8")   # valid JSON, wrong shape
    assert load_lock(lock) == {}


def test_bare_mapping_shape_is_tolerated(tmp_path):
    """load_lock accepts a bare {name: entry} map (no `sources` wrapper) for forward/back tolerance."""
    lock = tmp_path / "sources.lock"
    lock.write_text(json.dumps({"src": {"resolved_sha": SHA_A, "ref": "main"}}), encoding="utf-8")
    assert read_lock_sha("src", path=lock) == SHA_A


# ── CLI surface (sources_admin.py lock-write / lock-read) — what update_corpus.sh + setup.sh call ──


def test_cli_lock_write_and_read(tmp_path, monkeypatch, capsys):
    """update_corpus.sh calls `lock-write`; setup.sh captures `lock-read` stdout. Exercise both."""
    import sources
    import sources_admin
    monkeypatch.setattr(sources, "SOURCES_LOCK", tmp_path / "sources.lock")
    assert sources_admin.main(["lock-write", "--name", "s", "--sha", SHA_A, "--ref", "main"]) == 0
    capsys.readouterr()
    assert sources_admin.main(["lock-read", "--name", "s"]) == 0
    assert capsys.readouterr().out.strip() == SHA_A
    # unlocked name → exit 0, empty stdout (setup.sh treats empty as "no pin, use tip")
    assert sources_admin.main(["lock-read", "--name", "missing"]) == 0
    assert capsys.readouterr().out.strip() == ""


def test_cli_add_does_not_write_lock(tmp_path, monkeypatch):
    """spec 077 §4 C1 decision: `add` stays clone-free / pure-local — it must NOT create or touch the
    lockfile (the lock is seeded by the first clone/update, not at add-time)."""
    import sources
    import sources_admin
    lock = tmp_path / "sources.lock"
    monkeypatch.setattr(sources, "SOURCES_LOCK", lock)
    yml = tmp_path / "sources.yml"
    yml.write_text("sources:\n", encoding="utf-8")
    monkeypatch.setattr(sources_admin, "SOURCES_YML", yml)
    monkeypatch.setattr(sources_admin, "BASE", tmp_path)
    monkeypatch.setattr(sources_admin, "CORPUS_DIR", tmp_path / "corpus")
    monkeypatch.setattr(sources_admin, "load_sources", lambda *a, **k: [])
    rc = sources_admin.main(["add", "--name", "n", "--repo", "https://e/n.git", "--license", "MIT"])
    assert rc == 0
    assert not lock.exists(), "add must not write the lockfile (spec 077 §4 C1)"


def test_real_lockfile_is_valid_and_tracked_shape():
    """The committed corpus/sources.lock (if present) parses and covers the real registry sources."""
    real = BASE / "corpus" / "sources.lock"
    if not real.exists():
        return
    from sources import load_sources
    lock = load_lock(real)
    for s in load_sources():
        if (BASE / "corpus" / s["name"] / ".git").exists():
            assert s["name"] in lock, f"cloned source {s['name']!r} missing from sources.lock"
            assert len(lock[s["name"]]["resolved_sha"]) == 40, "resolved_sha must be a full git SHA"

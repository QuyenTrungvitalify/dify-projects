#!/usr/bin/env python3
"""Read corpus/sources.yml — the single source registry (spec 022 D1).

Python consumers (build_index.py) import load_sources(); bash consumers use
scripts/lib/sources.sh. Both read the same controlled-subset YAML file.

CLI:
    python3 tools/dify_base/sources.py            # human summary
    python3 tools/dify_base/sources.py --list     # TSV: name<TAB>repo<TAB>ref<TAB>sparse<TAB>dsl_glob<TAB>license
"""
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - only when run outside the venv
    yaml = None

BASE = Path(__file__).parent.parent.parent
SOURCES_YML = BASE / "corpus" / "sources.yml"
# spec 077 C1 — reproducibility lockfile. Records the exact SHA each corpus clone is pinned to.
# Separate JSON file (read only by Python, post-venv): the flat awk shim never touches it, so the
# registry's dual-parser parity is unaffected. NOT gitignored — `.gitignore: corpus/*/` matches only
# subdirectories, so this file at corpus/ is tracked.
SOURCES_LOCK = BASE / "corpus" / "sources.lock"

_REQUIRED = ("name", "repo", "license")

# Permissive SPDX ids accepted at v1 (spec 022 D7). Copyleft / non-commercial are rejected
# because a promoted template is a derivative work (translated + DSL-migrated).
PERMISSIVE_LICENSES = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC",
    "Unlicense", "CC0-1.0", "CC-BY-4.0",
}


def load_sources(path=SOURCES_YML):
    """Return the list of source dicts from the registry (empty list if absent).

    Each dict is normalised to: name, repo, ref, sparse (list), dsl_glob, license, indexed —
    optional keys filled with sensible defaults so consumers need not guard every access.
    `indexed` defaults True (spec 023): false = vendored + promotable but hidden from INDEX/find.
    """
    path = Path(path)
    if not path.exists() or yaml is None:
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    out = []
    for s in (data.get("sources") or []):
        if not isinstance(s, dict) or not s.get("name"):
            continue
        sparse = s.get("sparse") or []
        if isinstance(sparse, str):
            sparse = [sparse]
        out.append({
            "name": s["name"],
            "repo": s.get("repo", ""),
            "ref": s.get("ref", "main") or "main",
            "sparse": list(sparse),
            "dsl_glob": s.get("dsl_glob", "**/*.yml") or "**/*.yml",
            "license": s.get("license", ""),
            # spec 023: truthy default → existing registries index exactly as before.
            "indexed": bool(s.get("indexed", True)),
        })
    return out


def missing_field_problems(sources):
    """Yield 'missing required field' problems only. Spec 075 S3 treats these as WARN at build time
    (an incomplete legacy entry shouldn't turn the whole index build red)."""
    for s in sources:
        for k in _REQUIRED:
            if not s.get(k):
                yield f"source {s.get('name', '?')!r}: missing required '{k}'"


def license_problems(sources):
    """Yield 'non-permissive license' problems only. Spec 075 S3 treats these as a BLOCK: a copyleft/NC
    source is not redistributable as a promoted derivative, so it must fail the build hard (exit != 0)."""
    for s in sources:
        lic = s.get("license")
        if lic and lic not in PERMISSIVE_LICENSES:
            yield (f"source {s.get('name', '?')!r}: license {lic!r} is not in the permissive allowlist "
                   f"(spec 022 D7 — copyleft/NC sources are not redistributable as promoted derivatives)")


def validate(sources):
    """Yield ALL human-readable problems (missing fields + non-permissive license). Empty = clean.
    Kept as the CLI/back-compat view; runtime callers that need the block/warn split use the two
    generators above (spec 075 S3)."""
    yield from missing_field_problems(sources)
    yield from license_problems(sources)


# ── spec 077 C1: reproducibility lockfile (corpus/sources.lock) ────────────────────────────────────
# The lock is a pure optimisation for reproducibility: its absence (or corruption) just means "use the
# branch tip", never an error. `ref` stays a branch in sources.yml (so `git clone --branch` works); the
# lock carries the resolved SHA, fetched separately (git clone --depth=1 can't take a bare SHA, and a
# shallow clone can't `checkout` an arbitrary old SHA — see spec 077 §4 C1). Written ONLY here in Python
# (never hand-rolled in bash): same discipline as spec 075 S5 forbidding yaml.safe_dump on the registry.


def load_lock(path=None):
    """Return the {name: {resolved_sha, ref, updated}} map from corpus/sources.lock.

    Missing / empty / corrupt / wrong-shaped file → {} (degrade, never raise): the lock is advisory."""
    path = Path(path) if path is not None else SOURCES_LOCK
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    inner = data.get("sources", data)  # tolerate both the wrapped and a bare {name: entry} shape
    return inner if isinstance(inner, dict) else {}


def read_lock_sha(name, path=None):
    """Return the pinned SHA for `name`, or '' if unlocked. The CLI surface setup.sh consumes."""
    entry = load_lock(path).get(name) or {}
    return entry.get("resolved_sha", "") if isinstance(entry, dict) else ""


def write_lock(name, sha, ref, updated=None, path=None):
    """Record that corpus/<name> is pinned at `sha` (tracked at `ref`). Returns True iff the file changed.

    Idempotent on (sha, ref): if the entry already records the same pin, do NOT rewrite — that keeps the
    `updated` timestamp (and hence the git diff) stable across no-op sync runs. Serialisation is sorted
    + newline-terminated so repeated writes are byte-deterministic."""
    path = Path(path) if path is not None else SOURCES_LOCK
    lock = load_lock(path)
    existing = lock.get(name)
    if isinstance(existing, dict) and existing.get("resolved_sha") == sha and existing.get("ref") == ref:
        return False
    if updated is None:
        from datetime import datetime, timezone
        updated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    lock[name] = {"resolved_sha": sha, "ref": ref, "updated": updated}
    payload = {
        "_comment": ("Auto-generated corpus pin for reproducible setup (spec 077 C1). Each entry freezes "
                     "corpus/<name> to a SHA; scripts/setup.sh fetches it so a fresh clone rebuilds the "
                     "exact corpus. Written by scripts/update_corpus.sh — do not hand-edit."),
        "sources": {k: lock[k] for k in sorted(lock)},
    }
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return True


def main(argv):
    sources = load_sources()
    if "--list" in argv:
        for s in sources:
            print("\t".join([
                s["name"], s["repo"], s["ref"],
                ",".join(s["sparse"]), s["dsl_glob"], s["license"],
            ]))
        return 0
    if yaml is None:
        print("PyYAML not available — cannot read registry", file=sys.stderr)
        return 1
    print(f"{len(sources)} source(s) in {SOURCES_YML.relative_to(BASE)}:\n")
    for s in sources:
        print(f"  {s['name']:24} {s['license']:12} {s['repo']}")
        print(f"  {'':24} ref={s['ref']} sparse={s['sparse']} glob={s['dsl_glob']}")
    problems = list(validate(sources))
    if problems:
        print("\n⚠ registry problems:")
        for p in problems:
            print(f"  - {p}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

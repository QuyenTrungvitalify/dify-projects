#!/usr/bin/env python3
"""Read corpus/sources.yml — the single source registry (spec 022 D1).

Python consumers (build_index.py) import load_sources(); bash consumers use
scripts/lib/sources.sh. Both read the same controlled-subset YAML file.

CLI:
    python3 tools/dify_base/sources.py            # human summary
    python3 tools/dify_base/sources.py --list     # TSV: name<TAB>repo<TAB>ref<TAB>sparse<TAB>dsl_glob<TAB>license
"""
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - only when run outside the venv
    yaml = None

BASE = Path(__file__).parent.parent.parent
SOURCES_YML = BASE / "corpus" / "sources.yml"

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


def validate(sources):
    """Yield human-readable problems (missing required fields, non-permissive license). Empty = clean."""
    for s in sources:
        for k in _REQUIRED:
            if not s.get(k):
                yield f"source {s.get('name', '?')!r}: missing required '{k}'"
        lic = s.get("license")
        if lic and lic not in PERMISSIVE_LICENSES:
            yield (f"source {s.get('name', '?')!r}: license {lic!r} is not in the permissive allowlist "
                   f"(spec 022 D7 — copyleft/NC sources are not redistributable as promoted derivatives)")


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

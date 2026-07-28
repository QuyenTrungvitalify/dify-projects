#!/usr/bin/env python3
"""Spec 075 S5 — safe admin helper for the source registry (corpus/sources.yml).

Four subcommands, all thin and read-mostly:

    add         validate a candidate (license + required fields + flat-schema safety) BEFORE writing,
                refuse on any problem, then APPEND it as flat text and print the clone + index commands.
    doctor      read-only scan of the existing registry: non-permissive license, missing field, a `ref`
                that is not a branch (pinned SHA/tag), and a source declared-but-not-cloned.
    lock-write  spec 077 C1 — record corpus/<name> pinned at <sha> in corpus/sources.lock (called by
                scripts/update_corpus.sh; the ONE Python surface that serialises the lock).
    lock-read   spec 077 C1 — print the pinned SHA for <name> (scripts/setup.sh reads it post-venv).

Note (spec 077 §4 C1): `add` deliberately does NOT resolve or write a lock SHA — it stays clone-free /
pure-local (no network). The lock is seeded by the first clone/update run, not at add-time.

Usage:
    python3 tools/dify_base/sources_admin.py add \\
        --name my-corpus --repo https://github.com/acme/wf.git --license MIT \\
        [--ref main] [--sparse DSL,assets] [--glob "DSL/**/*.yml"] [--indexed false]
    python3 tools/dify_base/sources_admin.py doctor

🚨 THE TRAP (spec 075 §4 S5): the registry is a FLAT, awk-parseable subset of YAML
(scripts/lib/sources.sh reads it WITHOUT a venv at bootstrap). `add` therefore writes flat text by
hand — it never `yaml.safe_dump`s the file, which would reflow it into nested/multiline YAML and break
the bash parser. `doctor` only READS; it never reserializes. See corpus/sources.yml's header.
"""
import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from sources import (  # noqa: E402
    BASE, SOURCES_YML, load_sources, license_problems, missing_field_problems,
    read_lock_sha, write_lock,
)

CORPUS_DIR = BASE / "corpus"

# A single-line scalar must not carry a newline nor an inline-comment marker (" #…"): the awk shim
# strips everything from the first whitespace-preceded '#', so such a value would parse wrong.
_INLINE_COMMENT = re.compile(r"\s#")
# A sparse item lands in a single-line `[a, b]` list; the shim strips brackets/whitespace and splits
# on commas, so an item may not contain commas, brackets, whitespace, or a comment marker.
_BAD_SPARSE_CHAR = re.compile(r"[,\[\]#\s]")
_SHA_LIKE = re.compile(r"^[0-9a-f]{7,40}$")


def _flat_scalar_error(field, value):
    """Return a human message if `value` can't be written as a flat single-line scalar, else None."""
    if "\n" in value or "\r" in value:
        return f"{field} {value!r}: must be a single-line scalar (contains a newline)"
    if _INLINE_COMMENT.search(value):
        return f"{field} {value!r}: contains ' #' — the flat awk parser would truncate it as a comment"
    return None


def _candidate(args):
    """Build a normalised source dict from `add` args (same shape load_sources yields)."""
    sparse = [p.strip() for p in (args.sparse or "").split(",") if p.strip()]
    return {
        "name": args.name.strip(),
        "repo": args.repo.strip(),
        "ref": (args.ref or "main").strip(),
        "sparse": sparse,
        "dsl_glob": (args.glob or "**/*.yml").strip(),
        "license": args.license.strip(),
        "indexed": args.indexed,
    }


def _flat_problems(src):
    """Flat-schema safety problems for a candidate (on top of license/field validation)."""
    problems = []
    for field in ("name", "repo", "ref", "dsl_glob", "license"):
        err = _flat_scalar_error(field, src[field])
        if err:
            problems.append(err)
    for item in src["sparse"]:
        if _BAD_SPARSE_CHAR.search(item):
            problems.append(f"sparse item {item!r}: no commas, brackets, whitespace, or '#' "
                            "(the flat list is single-line and awk-split on commas)")
    return problems


def _format_entry(src):
    """Render ONE registry entry as flat text (exactly the shape the awk shim + load_sources expect).
    Manual text — never yaml.safe_dump (that reflow is the S5 trap)."""
    lines = [
        f"  - name: {src['name']}",
        f"    repo: {src['repo']}",
        f"    ref: {src['ref']}",
        f"    sparse: [{', '.join(src['sparse'])}]",
        f'    dsl_glob: "{src["dsl_glob"]}"',
        f"    license: {src['license']}",
    ]
    if not src["indexed"]:  # `true` is the default → omit, matching the existing entries' style
        lines.append("    indexed: false")
    return "\n".join(lines) + "\n"


def cmd_add(args):
    src = _candidate(args)

    # 1. Validate BEFORE touching the file — license blocks, and here (a NEW entry) a missing required
    #    field blocks too: we won't write an incomplete source. Flat-schema safety blocks unconditionally.
    problems = list(license_problems([src])) + list(missing_field_problems([src])) + _flat_problems(src)
    if problems:
        print(f"✗ refusing to add {src['name']!r} — fix these first:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    # 2. No duplicate names (name = the corpus/ dir + the corpus:<name> index tag).
    if any(s["name"] == src["name"] for s in load_sources()):
        print(f"✗ a source named {src['name']!r} already exists in {SOURCES_YML.relative_to(BASE)}",
              file=sys.stderr)
        return 1

    if not SOURCES_YML.exists():
        print(f"✗ no registry at {SOURCES_YML} — run ./scripts/setup.sh first", file=sys.stderr)
        return 1
    text = SOURCES_YML.read_text(encoding="utf-8")
    if "sources:" not in text:
        print(f"✗ {SOURCES_YML.relative_to(BASE)} has no `sources:` key — refusing to guess where to append",
              file=sys.stderr)
        return 1

    # 3. Append flat text — preserve every existing byte, add exactly one entry.
    if not text.endswith("\n"):
        text += "\n"
    SOURCES_YML.write_text(text + _format_entry(src), encoding="utf-8")
    print(f"✓ added {src['name']!r} to {SOURCES_YML.relative_to(BASE)}")

    # 4. Print (never run — permission) the clone + index commands, mirroring scripts/setup.sh.
    sparse_dirs = " ".join(src["sparse"]) or "."
    branch = f'--branch "{src["ref"]}" ' if src["ref"] else ""
    print("\nNext (run these yourself — this helper never clones):")
    print(f"  git clone --depth=1 {branch}--filter=blob:none --sparse {src['repo']} corpus/{src['name']}")
    if src["sparse"]:
        print(f"  git -C corpus/{src['name']} sparse-checkout set --cone {sparse_dirs}")
    print("  .venv/bin/python tools/dify_base/build_index.py   # rebuild INDEX with the new source")
    return 0


def cmd_doctor(_args):
    """Read-only registry health check. ERROR (exit 1): non-permissive license / missing field.
    WARN (exit 0-neutral): a pinned non-branch ref, or a declared-but-not-cloned source."""
    sources = load_sources()
    if not sources:
        print("no sources registered (or PyYAML unavailable) — nothing to check")
        return 0

    errors, warns = [], []
    for s in sources:
        errors.extend(license_problems([s]))
        errors.extend(missing_field_problems([s]))
        ref = s.get("ref", "main")
        if _SHA_LIKE.match(ref):
            warns.append(f"source {s['name']!r}: ref {ref!r} looks like a pinned SHA, not a branch — "
                         "update_corpus.sh --check tracks refs/heads/<branch> and will skip it")
        clone = CORPUS_DIR / s["name"] / ".git"
        if not clone.exists():
            warns.append(f"source {s['name']!r}: not cloned at corpus/{s['name']} — run ./scripts/setup.sh")

    print(f"{len(sources)} source(s) in {SOURCES_YML.relative_to(BASE)}")
    for w in warns:
        print(f"  ! {w}")
    for e in errors:
        print(f"  ✗ {e}", file=sys.stderr)
    if errors:
        print(f"\n{len(errors)} problem(s) must be fixed.", file=sys.stderr)
        return 1
    print("registry is clean" + (f" ({len(warns)} warning(s) above)" if warns else ""))
    return 0


def cmd_lock_write(args):
    """spec 077 C1 — record corpus/<name> pinned at <sha>. Called by scripts/update_corpus.sh (bash)
    via $PY after each `reset --hard`, so the lock is always written through this one Python surface."""
    changed = write_lock(args.name.strip(), args.sha.strip(), args.ref.strip())
    if changed:
        print(f"✓ locked {args.name.strip()!r} at {args.sha.strip()[:10]}")
    return 0


def cmd_lock_read(args):
    """spec 077 C1 — print the pinned SHA for <name> (nothing if unlocked). scripts/setup.sh captures
    stdout to decide whether to fetch+checkout a frozen SHA post-venv."""
    sha = read_lock_sha(args.name.strip())
    if sha:
        print(sha)
    return 0


def _str2bool(v):
    if isinstance(v, bool):
        return v
    if v.lower() in ("true", "1", "yes"):
        return True
    if v.lower() in ("false", "0", "no"):
        return False
    raise argparse.ArgumentTypeError(f"expected a boolean, got {v!r}")


def main(argv):
    parser = argparse.ArgumentParser(description="Safe admin for corpus/sources.yml (spec 075 S5).")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add", help="validate + append a source (flat text, never reserialized)")
    p_add.add_argument("--name", required=True)
    p_add.add_argument("--repo", required=True)
    p_add.add_argument("--license", required=True, help="SPDX id — must be permissive (spec 022 D7)")
    p_add.add_argument("--ref", default="main", help="branch (default main). SHA/tag pinning is track C.")
    p_add.add_argument("--sparse", default="", help="comma-separated subdirs, e.g. DSL,assets")
    p_add.add_argument("--glob", default="**/*.yml", help="dsl_glob (default **/*.yml)")
    p_add.add_argument("--indexed", type=_str2bool, default=True,
                       help="false = vendored + promotable but hidden from INDEX/find (spec 023)")
    p_add.set_defaults(func=cmd_add)

    p_doc = sub.add_parser("doctor", help="read-only registry health check")
    p_doc.set_defaults(func=cmd_doctor)

    p_lw = sub.add_parser("lock-write", help="record corpus/<name> pinned at <sha> (spec 077 C1)")
    p_lw.add_argument("--name", required=True)
    p_lw.add_argument("--sha", required=True)
    p_lw.add_argument("--ref", required=True, help="branch the SHA was resolved from (stays in sources.yml)")
    p_lw.set_defaults(func=cmd_lock_write)

    p_lr = sub.add_parser("lock-read", help="print the pinned SHA for <name>, empty if unlocked (spec 077 C1)")
    p_lr.add_argument("--name", required=True)
    p_lr.set_defaults(func=cmd_lock_read)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

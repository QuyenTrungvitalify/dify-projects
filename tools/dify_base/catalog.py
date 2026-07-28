#!/usr/bin/env python3
"""Spec 078 S1 — fingerprint catalog + collection memory (`collected.json`).

The shelf's anti-duplicate memory. Two ideas:

  * **fingerprint** — a stable shape string: the node-type MULTISET (count per type, helper nodes
    dropped exactly like build_index.analyze) plus the edge count AFTER the helper filter, e.g.
    ``agent:1|end:1|start:1/e:2``. Invariant under rename/translation (titles/prompts are ignored),
    so it catches near-dups that a sha256 misses.
  * **collected.json** — the tracked memory of everything seen: what is already in the house
    (seeded from the same scan roots as build_index), plus every hunt decision
    (vendored/promoted/rewritten/rejected/study) and a hunt journal.

⚠ Fingerprint is a WEAK signal for shapes under 4 nodes (spec 078 v2.1): a dozen legitimate
translate/chat workflows share ``end:1|llm:1|start:1`` and differ only in prompts — which the
fingerprint ignores by design. A fingerprint match therefore NEVER yields ``dup``; ``dup`` is
sha256-only, and a <4-node fingerprint match is reported as ``near-dup`` with a weak-signal caveat.

`collected.json` is written ONLY through this module (spec 078 §2 — one helper, no hand-rolls);
builder turns cannot write it (denied by `Write(tools/**)` in apps/builder/headless-settings.json).

Usage:
    python3 tools/dify_base/catalog.py fingerprint <file> [--json]
    python3 tools/dify_base/catalog.py seed                     # idempotent; every tier incl. skill-assets
    python3 tools/dify_base/catalog.py check <file> [--shelf] [--json]
    python3 tools/dify_base/catalog.py record <file> --decision rejected --reason "..." [--url ...]
    python3 tools/dify_base/catalog.py hunt-log --query "..." [--new N] [--dup N] [--rejected N]
    python3 tools/dify_base/catalog.py doctor

`check` modes (spec 078 S1/S2 — deliberately different comparison sets):
  * default    — against the WHOLE collected.json memory (every tier + recorded decisions). This is
                 the `/scout` vetting mode; a sha match also replays any prior decision + reason.
  * ``--shelf`` — LIVE parse of templates/patterns/ + templates/library/ at call time, collected.json
                 is NOT read. This is the S2 nudge mode: `finalizePromotion` rebuilds the index but
                 never refreshes collected.json, so reading the seed here would keep nudging a shape
                 that was already promoted (broken self-quench). Parse-live is self-correcting.
"""
import argparse
import hashlib
import json
import subprocess
import sys
from collections import Counter
from datetime import date
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).parent))
from sources import load_sources  # noqa: E402

# dify-projects/tools/dify_base/catalog.py -> parent.parent.parent = repo root
BASE = Path(__file__).parent.parent.parent
CATALOG_PATH = Path(__file__).parent / "collected.json"

# Same helper-node filter as build_index.analyze() (build_index.py:98-100) — keep in sync.
HELPER_NODE_TYPES = ("iteration-start", "loop-start", "custom-iteration-start", "custom-loop-start")

# Under this node count a fingerprint match is a weak signal (spec 078 v2.1 — see module docstring).
WEAK_SHAPE_NODES = 4

# Mirrors build_index.STATIC_SCAN as ROOT-RELATIVE pairs, so seed/doctor can run against a test tree.
# Corpus roots are registry-driven (see scan_targets below). Deliberately NOT importing STATIC_SCAN:
# its entries are absolute-BASE paths, and spec 078 §3 says derive every path from the root, never
# trust a stored absolute path (index.json's `path` field is machine-specific).
STATIC_TIERS = (
    ("templates/patterns", "patterns"),
    ("templates/library", "library"),
    ("templates/_base", "starter"),
    ("examples", "example"),
    ("skills/mango-svip/assets", "skill-assets"),
    ("skills/Tomatio13/example", "skill-assets"),
    ("projects", "project"),
)

# The curated shelf — the ONLY comparison set for the S2 nudge (`check --shelf`) and the only tier
# where doctor expects zero duplicates (spec 078 §5-c).
CURATED_TIERS = ("templates/patterns", "templates/library")

VALID_DECISIONS = ("vendored", "promoted", "rewritten", "rejected", "study", "shelf")


# ── fingerprint ───────────────────────────────────────────────────────────────────────────────────

def fingerprint_file(path):
    """Return {'fingerprint', 'node_count', 'sha256'} for a workflow YAML, or None when the file is
    valid YAML but not a workflow (no graph nodes) — mirroring build_index.analyze's silent skip.
    Raises on unreadable/broken YAML (callers decide whether that is an error or a skip)."""
    raw = Path(path).read_bytes()
    data = yaml.safe_load(raw.decode("utf-8"))
    if not isinstance(data, dict):
        return None
    graph = (data.get("workflow") or {}).get("graph") or {}
    nodes = graph.get("nodes") or []

    kept_ids, types = set(), []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        ntype = (n.get("data") or {}).get("type") or ""
        if not ntype or ntype in HELPER_NODE_TYPES:
            continue
        types.append(ntype)
        kept_ids.add(str(n.get("id")))
    if not types:
        return None  # valid YAML, not a workflow (or an empty graph) — never fingerprint noise

    # Edge count AFTER the helper filter (spec 078 v2.2): helper nodes carry edges in graph.edges,
    # so a raw count would make two same-shape files differ by ± their helper edges.
    edges = graph.get("edges") or []
    edge_count = sum(
        1 for e in edges
        if isinstance(e, dict) and str(e.get("source")) in kept_ids and str(e.get("target")) in kept_ids
    )
    counter = Counter(types)
    fp = "|".join(f"{t}:{c}" for t, c in sorted(counter.items())) + f"/e:{edge_count}"
    return {
        "fingerprint": fp,
        "node_count": len(types),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


# ── collected.json — the ONE read/write surface (spec 078 §2) ────────────────────────────────────

def load_catalog(catalog_path=CATALOG_PATH):
    if not Path(catalog_path).exists():
        return {"entries": {}, "hunts": []}
    data = json.loads(Path(catalog_path).read_text(encoding="utf-8"))
    data.setdefault("entries", {})
    data.setdefault("hunts", [])
    return data


def save_catalog(data, catalog_path=CATALOG_PATH):
    """Stable serialization (sorted keys, trailing newline) so reruns produce byte-identical diffs."""
    Path(catalog_path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


# ── scanning (seed / doctor) ─────────────────────────────────────────────────────────────────────

def scan_targets(root=BASE):
    """(dir, tier, glob) triples — the same roots build_index scans, derived from `root`.
    Corpus roots come from the registry; a source whose clone is absent under `root` is skipped
    (also what makes a tmp-root test tree work: no clones there, no corpus targets)."""
    targets = [(Path(root) / rel, tier, "*.yml") for rel, tier in STATIC_TIERS]
    for s in load_sources():
        d = Path(root) / "corpus" / s["name"]
        if d.exists():
            # Dedupe must cover read-only clones too, so `indexed: false` sources are NOT skipped
            # here (unlike build_index) — "toàn bộ, kể cả cái đã có trong clone" (spec 078 S1).
            targets.append((d, f"corpus:{s['name']}", s["dsl_glob"]))
    return targets


def _filter_gitignored(root, paths):
    """Mirror of build_index._filter_gitignored: drop paths git would ignore, so the tracked
    collected.json mirrors the repo (the index's shelf-set), never local scratch — the builder
    writes each QA run to gitignored projects/ dirs (spec 011 R2). Fallback: git missing/error →
    keep all (a test tmp-tree has no repo; the seed is then no worse than the scan)."""
    if not paths:
        return paths
    try:
        proc = subprocess.run(
            ["git", "-C", str(root), "-c", "core.quotePath=false", "check-ignore", "--stdin"],
            input="\n".join(str(p) for p in paths),
            capture_output=True, text=True,
        )
    except Exception:
        return paths
    if proc.returncode not in (0, 1):  # 0 = some ignored, 1 = none ignored, >1 = error
        return paths
    ignored = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
    return [p for p in paths if str(p) not in ignored]


def scan_files(root=BASE, tiers=None):
    """Yield (rel_path_str, tier, info) for every fingerprintable workflow under the scan roots.
    `tiers` = optional allow-list of ROOT-RELATIVE static dirs (e.g. CURATED_TIERS)."""
    root = Path(root)
    for scan_dir, tier, pattern in scan_targets(root):
        if tiers is not None and str(scan_dir.relative_to(root)) not in tiers:
            continue
        if not scan_dir.exists():
            continue
        matches = sorted(scan_dir.glob(pattern) if "/" in pattern else scan_dir.rglob(pattern))
        # Only the project tier: corpus/skills are gitignored-by-design clones we DO want
        # (build_index draws the same line — its comment explains the silent-drop bug otherwise).
        if tier == "project":
            matches = _filter_gitignored(root, matches)
        for yml in matches:
            try:
                info = fingerprint_file(yml)
            except Exception:
                continue  # broken YAML → build_index/doctor territory, not the catalog's
            if info:
                yield str(yml.relative_to(root)), tier, info


# ── commands ─────────────────────────────────────────────────────────────────────────────────────

def cmd_fingerprint(args):
    info = fingerprint_file(args.file)
    if info is None:
        print(f"✗ {args.file}: valid YAML but not a workflow (no graph nodes)", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(info))
    else:
        print(f"{info['fingerprint']}  (nodes: {info['node_count']}, sha256: {info['sha256'][:12]})")
    return 0


def seed(root=BASE, catalog_path=CATALOG_PATH):
    """Build the shelf-set from EVERY tier (incl. skill-assets + corpus clones) into collected.json.
    Idempotent: an existing key is left untouched (its decision/reason are history, not scan output)."""
    cat = load_catalog(catalog_path)
    added = skipped = 0
    for rel, tier, info in scan_files(root):
        key = info["sha256"][:12]
        if key in cat["entries"]:
            skipped += 1
            continue
        cat["entries"][key] = {
            "key": key,
            "name": Path(rel).name,
            "path": rel,
            "tier": tier,
            "sha256": info["sha256"],
            "fingerprint": info["fingerprint"],
            "node_count": info["node_count"],
            "decision": "shelf",  # "already in the house" — distinct from the hunt decisions
            "reason": f"seeded from {tier}",
            "date": date.today().isoformat(),
        }
        added += 1
    save_catalog(cat, catalog_path)
    return added, skipped


def cmd_seed(args):
    added, skipped = seed()
    print(f"✓ seeded {added} new entr{'y' if added == 1 else 'ies'} "
          f"({skipped} already present) → {CATALOG_PATH.relative_to(BASE)}")
    return 0


def check_file(path, shelf=False, root=BASE, catalog_path=CATALOG_PATH):
    """Return the verdict dict for one candidate file. See module docstring for the two modes."""
    info = fingerprint_file(path)
    if info is None:
        return None

    if shelf:
        # LIVE curated-shelf parse — collected.json deliberately NOT read (self-quench, spec 078 S2).
        candidates = [
            {"sha256": i["sha256"], "fingerprint": i["fingerprint"], "node_count": i["node_count"],
             "match": rel, "decision": None, "reason": None}
            for rel, _tier, i in scan_files(root, tiers=CURATED_TIERS)
        ]
    else:
        candidates = [
            {"sha256": e["sha256"], "fingerprint": e["fingerprint"], "node_count": e.get("node_count"),
             "match": e.get("path") or e.get("url") or e["key"],
             "decision": e.get("decision"), "reason": e.get("reason")}
            for e in load_catalog(catalog_path)["entries"].values()
        ]

    verdict = {
        "verdict": "new", "match": None, "prior_decision": None, "prior_reason": None,
        "fingerprint": info["fingerprint"], "node_count": info["node_count"],
        "sha256": info["sha256"], "weak": info["node_count"] < WEAK_SHAPE_NODES,
    }
    # dup is sha256-ONLY (spec 078 v2.1 hard rule) — a fingerprint match never upgrades to dup.
    for c in candidates:
        if c["sha256"] == info["sha256"]:
            verdict.update(verdict="dup", match=c["match"],
                           prior_decision=c["decision"], prior_reason=c["reason"])
            return verdict
    for c in candidates:
        if c["fingerprint"] == info["fingerprint"]:
            verdict.update(verdict="near-dup", match=c["match"],
                           prior_decision=c["decision"], prior_reason=c["reason"])
            return verdict
    return verdict


def cmd_check(args):
    v = check_file(args.file, shelf=args.shelf)
    if v is None:
        print(f"✗ {args.file}: valid YAML but not a workflow (no graph nodes)", file=sys.stderr)
        return 2
    if args.json:
        print(json.dumps(v))
        return 0
    line = f"{v['verdict']}"
    if v["match"]:
        line += f" of {v['match']}"
    line += f"  [{v['fingerprint']}]"
    if v["verdict"] == "near-dup" and v["weak"]:
        line += (f"  ⚠ weak signal: shape has <{WEAK_SHAPE_NODES} nodes — many legitimate workflows "
                 "share it and differ only in prompts")
    if v["prior_decision"] and v["prior_decision"] != "shelf":
        line += f"\n  prior decision: {v['prior_decision']} — {v['prior_reason'] or '(no reason recorded)'}"
    print(line)
    return 0


def record(path, decision, reason, url=None, name=None, license_=None, tier=None,
           catalog_path=CATALOG_PATH):
    """Upsert one decision entry, keyed by the file's sha12. Returns the entry."""
    info = fingerprint_file(path)
    if info is None:
        raise ValueError(f"{path}: valid YAML but not a workflow (no graph nodes)")
    cat = load_catalog(catalog_path)
    key = info["sha256"][:12]
    entry = cat["entries"].get(key, {})
    entry.update({
        "key": key,
        "name": name or entry.get("name") or Path(path).name,
        "sha256": info["sha256"],
        "fingerprint": info["fingerprint"],
        "node_count": info["node_count"],
        "decision": decision,
        "reason": reason,
        "date": date.today().isoformat(),
    })
    if url:
        entry["url"] = url
    if license_:
        entry["license"] = license_
    if tier:
        entry["tier"] = tier
    cat["entries"][key] = entry
    save_catalog(cat, catalog_path)
    return entry


def cmd_record(args):
    try:
        entry = record(args.file, args.decision, args.reason,
                       url=args.url, name=args.name, license_=args.license, tier=args.tier)
    except ValueError as e:
        print(f"✗ {e}", file=sys.stderr)
        return 2
    print(f"✓ recorded {entry['key']} ({entry['name']}): {entry['decision']} — {entry['reason']}")
    return 0


def hunt_log(query, new=0, dup=0, rejected=0, note=None, catalog_path=CATALOG_PATH):
    cat = load_catalog(catalog_path)
    entry = {"date": date.today().isoformat(), "query": query,
             "new": new, "dup": dup, "rejected": rejected}
    if note:
        entry["note"] = note
    cat["hunts"].append(entry)
    save_catalog(cat, catalog_path)
    return entry


def cmd_hunt_log(args):
    entry = hunt_log(args.query, new=args.new, dup=args.dup, rejected=args.rejected, note=args.note)
    print(f"✓ hunt logged: {entry['date']} query={entry['query']!r} "
          f"new={entry['new']} dup={entry['dup']} rejected={entry['rejected']}"
          f" ({len(load_catalog().get('hunts', []))} hunts total)")
    return 0


def doctor(root=BASE):
    """Scan for internal duplicates. Returns (curated_problems, house_notes) — only the former
    should gate anything: on the curated shelf 0 dups is the expectation (spec 078 §5-c); across the
    whole house, same-shape 3-node workflows are legitimate and reported as weak-signal info only."""
    def collisions(rows):
        by_sha, by_fp = {}, {}
        for rel, _tier, info in rows:
            by_sha.setdefault(info["sha256"], []).append(rel)
            by_fp.setdefault((info["fingerprint"], info["node_count"]), []).append(rel)
        sha_dups = [paths for paths in by_sha.values() if len(paths) > 1]
        # exclude byte-identical groups from the shape report: they're already sha dups
        sha_dup_set = {p for grp in sha_dups for p in grp}
        fp_strong = [(fp, n, paths) for (fp, n), paths in by_fp.items()
                     if len(paths) > 1 and n >= WEAK_SHAPE_NODES
                     and not all(p in sha_dup_set for p in paths)]
        fp_weak = [(fp, n, paths) for (fp, n), paths in by_fp.items()
                   if len(paths) > 1 and n < WEAK_SHAPE_NODES
                   and not all(p in sha_dup_set for p in paths)]
        return sha_dups, fp_strong, fp_weak

    curated = list(scan_files(root, tiers=CURATED_TIERS))
    house = list(scan_files(root))

    problems, notes = [], []
    c_sha, c_strong, c_weak = collisions(curated)
    for grp in c_sha:
        problems.append(f"curated sha256 dup: {' == '.join(grp)}")
    for fp, _n, grp in c_strong:
        problems.append(f"curated shape collision [{fp}]: {' ~ '.join(grp)}")
    for fp, _n, grp in c_weak:
        notes.append(f"curated weak-signal shape ({fp}): {' ~ '.join(grp)} — verify by hand, not auto-dup")

    h_sha, h_strong, h_weak = collisions(house)
    for grp in h_sha:
        if not all(any(p == c for c, _t, _i in curated) for p in grp):
            notes.append(f"house sha256 dup: {' == '.join(grp)}")
    for fp, _n, grp in h_strong:
        notes.append(f"house shape collision [{fp}]: {' ~ '.join(grp)}")
    if h_weak:
        notes.append(f"house weak-signal shape collisions (<{WEAK_SHAPE_NODES} nodes, expected — "
                     f"prompts differ, shape can't): {len(h_weak)} group(s)")
    return problems, notes


def cmd_doctor(_args):
    problems, notes = doctor()
    for n in notes:
        print(f"  ! {n}")
    for p in problems:
        print(f"  ✗ {p}", file=sys.stderr)
    if problems:
        print(f"\n{len(problems)} curated-shelf problem(s) — the curated tier expects 0 dups (spec 078 §5-c).",
              file=sys.stderr)
        return 1
    print("curated shelf is dup-free" + (f" ({len(notes)} house note(s) above)" if notes else ""))
    return 0


def main(argv):
    parser = argparse.ArgumentParser(description="Fingerprint catalog + collection memory (spec 078 S1).")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_fp = sub.add_parser("fingerprint", help="print the shape fingerprint of one workflow YAML")
    p_fp.add_argument("file")
    p_fp.add_argument("--json", action="store_true")
    p_fp.set_defaults(func=cmd_fingerprint)

    p_seed = sub.add_parser("seed", help="seed collected.json from every scan tier (idempotent)")
    p_seed.set_defaults(func=cmd_seed)

    p_chk = sub.add_parser("check", help="verdict for a candidate: new / dup-of / near-dup")
    p_chk.add_argument("file")
    p_chk.add_argument("--shelf", action="store_true",
                       help="compare against a LIVE parse of templates/patterns+library (S2 nudge mode)")
    p_chk.add_argument("--json", action="store_true")
    p_chk.set_defaults(func=cmd_check)

    p_rec = sub.add_parser("record", help="record a hunt decision for a candidate file")
    p_rec.add_argument("file")
    p_rec.add_argument("--decision", required=True, choices=[d for d in VALID_DECISIONS if d != "shelf"])
    p_rec.add_argument("--reason", required=True)
    p_rec.add_argument("--url")
    p_rec.add_argument("--name")
    p_rec.add_argument("--license")
    p_rec.add_argument("--tier", choices=["A", "B"])
    p_rec.set_defaults(func=cmd_record)

    p_hl = sub.add_parser("hunt-log", help="append one hunt-journal entry")
    p_hl.add_argument("--query", required=True)
    p_hl.add_argument("--new", type=int, default=0)
    p_hl.add_argument("--dup", type=int, default=0)
    p_hl.add_argument("--rejected", type=int, default=0)
    p_hl.add_argument("--note")
    p_hl.set_defaults(func=cmd_hunt_log)

    p_doc = sub.add_parser("doctor", help="scan the shelf for internal duplicates")
    p_doc.set_defaults(func=cmd_doctor)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

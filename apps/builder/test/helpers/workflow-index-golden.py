#!/usr/bin/env python3
"""Regenerate the workflow-index calibration golden (spec 098, R-calib).

`server/lib/workflow-index.ts` reads Dify YAML WITHOUT a YAML parser — the builder server ships one
runtime dependency (fastify) on purpose. A hand-rolled scan can be wrong while looking confident, and a
wrong node map makes the model answer about nodes that do not exist. So the scan is calibrated against a
REAL parser, and the answer is frozen here as a golden the test suite checks on every run — no python at
test time.

Run this (from the repo root) whenever `workflow-index.ts` changes, or when a pinned workflow below is
edited on purpose:

    python3 apps/builder/test/helpers/workflow-index-golden.py

Then read the diff: a changed count you did not intend IS the regression this file exists to catch.
"""
import glob
import json
import pathlib
import sys

try:
    import yaml
except ImportError:
    sys.exit("PyYAML required: pip install pyyaml")

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / "apps/builder/test/fixtures/workflow-index-golden.json"

# Real, committed workflows in the shapes the builder actually meets: curated patterns (several with
# iteration bodies), a promoted library template, a shipped example, a promote fixture.
PATTERNS = [
    "templates/patterns/*.yml",
    "templates/library/*.yml",
    "examples/*/workflows/main.yml",
    "tests/fixtures/promote/*.yml",
]


def ground_truth(path: pathlib.Path):
    doc = yaml.safe_load(path.read_text(encoding="utf8"))
    graph = ((doc or {}).get("workflow") or {}).get("graph") or {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    ids = [str(n["id"]) for n in nodes if isinstance(n, dict) and "id" in n]
    pairs = [
        f"{e['source']} -> {e['target']}"
        for e in edges
        if isinstance(e, dict) and e.get("source") is not None and e.get("target") is not None
    ]
    types = {
        str(n["id"]): str((n.get("data") or {}).get("type"))
        for n in nodes
        if isinstance(n, dict) and "id" in n and isinstance(n.get("data"), dict) and n["data"].get("type") is not None
    }
    parents = {
        str(n["id"]): str(n["parentId"])
        for n in nodes
        if isinstance(n, dict) and "id" in n and n.get("parentId") is not None
    }
    return {"ids": ids, "edges": pairs, "types": types, "parents": parents}


golden = {}
for pat in PATTERNS:
    for f in sorted(glob.glob(str(ROOT / pat))):
        p = pathlib.Path(f)
        rel = str(p.relative_to(ROOT))
        try:
            g = ground_truth(p)
        except Exception as e:  # a file the parser itself rejects is not a calibration specimen
            print(f"skip (unparseable): {rel} — {type(e).__name__}")
            continue
        if not g["ids"]:
            print(f"skip (no nodes): {rel}")
            continue
        golden[rel] = g

OUT.write_text(json.dumps(golden, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf8")
print(f"wrote {OUT.relative_to(ROOT)} — {len(golden)} workflows")

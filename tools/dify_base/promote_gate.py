#!/usr/bin/env python3
"""Promotion quality gate (spec 050 D3) + linter-candidate channel (D2a).

Promotion is the moment a mistake becomes CONTAGIOUS — a broken build promoted to
templates/patterns|library/ teaches the break to every future build. This gate decides
*eligibility* (a human still decides promotion, per the template-promote skill):

  1. All 4 linters exit 0 on the SOURCE — and on the DISTILLED OUTPUT when given (the
     placeholder transform is the one step that can silently break a ref/schema; re-linting
     the output is what carries the source's import guarantee forward — spec 050 D3.1 r3).
  2. Import-probe on the SOURCE against the real Dify (push → capture → delete; the 049
     orphan lesson applies: Dify commits the app row BEFORE validating, so a FAILED push is
     name-swept). The source is probed because it carries the real model/plugin surface; a
     blanked-model seed is independently known to import (spec 050 r4 empirical note).
     No creds → `skipped` (never block field promotion on missing creds — 037/049 degrade).
  3. Model wiring on the SOURCE: every `type: llm` node must carry a PRESENT provider+name —
     an empty model means the LLM step was never wired, so "proven" is false (D3.3 r2).
     The distilled output deliberately resets to the ''+TODO template convention — not re-gated.

D2a — `candidate` subcommand: append a mechanical-rule note to docs/linter-candidates.md,
deduped on the exact rule statement (the D2b match-key discipline), so two promotions that
surface the same lesson merge instead of duplicating.

Usage:
  python3 tools/dify_base/promote_gate.py check <source.yml> [--distilled <out.yml>] [--json] [--skip-probe]
  python3 tools/dify_base/promote_gate.py candidate --rule "<statement>" --citation "<vendor/dify-src path>"
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

BASE = Path(__file__).parent.parent.parent
PYTHON = BASE / ".venv" / "bin" / "python"
LINTERS = ("validate_workflow.py", "lint_refs.py", "lint_plugin_hashes.py", "lint_node_bodies.py")
CANDIDATES_MD = BASE / "docs" / "linter-candidates.md"
DIFY_TAG = BASE / ".dify-tag"

CANDIDATES_HEADER = """# Linter-rule candidates (spec 050 D2a)

Mechanical, checkable rules surfaced by promotions/incidents, waiting to be folded into an
EXISTING linter (013/049 discipline — never a new script). One bullet per rule; dedup key is
the exact rule statement. When a rule ships, move its bullet to the shipping spec's log.
"""


def run_cmd(args: list[str], cwd: Path = BASE) -> tuple[int, str, str]:
    """Default subprocess runner — tests inject a fake with the same signature."""
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=120)
    return p.returncode, p.stdout, p.stderr


def check_lint(path: Path, run=run_cmd) -> list[str]:
    """Reasons (empty = clean) — all 4 linters, the shared 013 contract."""
    reasons = []
    for script in LINTERS:
        code, out, err = run([str(PYTHON), str(BASE / "tools" / "dify_base" / script), str(path)])
        if code != 0:
            tail = (out + "\n" + err).strip().splitlines()[-1] if (out or err).strip() else ""
            reasons.append(f"{script} exit {code} on {path.name}: {tail}")
    return reasons


def check_model_wiring(path: Path) -> list[str]:
    """D3.3 — every `type: llm` node in the SOURCE must have a present provider+name."""
    reasons = []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    nodes = (((data.get("workflow") or {}).get("graph") or {}).get("nodes")) or []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        d = node.get("data") or {}
        if d.get("type") != "llm":
            continue
        model = d.get("model") or {}
        if not model.get("provider") or not model.get("name"):
            reasons.append(
                f"llm node {node.get('id')} has an empty model (provider/name) — an unwired LLM "
                f"step means this build never actually ran; a 'proven build' must carry the real "
                f"model (the distilled output resets to '' by convention AFTER the gate)")
    return reasons


def _last_json(stdout: str) -> dict | None:
    for line in reversed([ln.strip() for ln in stdout.splitlines() if ln.strip()]):
        if line.startswith("{"):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                continue
    return None


def probe_source(path: Path, run=run_cmd) -> tuple[str, str]:
    """D3.2 — real-Dify import probe on the SOURCE: ('ok'|'failed'|'skipped', detail)."""
    if not (os.environ.get("DIFY_CONSOLE_URL") and os.environ.get("DIFY_CONSOLE_TOKEN")):
        return "skipped", "no Dify creds — lint-only gate (probe: skipped provenance stamp)"
    sync = str(BASE / "tools" / "dify_base" / "sync.py")
    try:
        rel = path.resolve().relative_to(BASE)
    except ValueError:
        return "skipped", f"source outside the repo root ({path}) — sync.py --src-file needs a repo-relative path"
    probe_name = f"[promote-gate] {path.stem}"
    code, out, err = run([
        str(PYTHON), sync, "push", "--project", "_drafts",
        "--src-file", str(rel), "--name", probe_name, "--yes", "--json-out",
    ])
    obj = _last_json(out) or {}
    app_id = obj.get("app_id") or obj.get("id")
    if code == 0 and app_id:
        run([str(PYTHON), sync, "delete", "--app-id", str(app_id)])
        return "ok", f"Dify accepted the source DSL (probe app deleted)"
    if code == 0 and obj.get("status") == "pending":
        return "skipped", "Dify parked the import as 'pending' (DSL version vs server mismatch) — inconclusive"
    # FAILED — sweep the possible orphan (Dify commits the app row BEFORE validating; 049 r3).
    lcode, lout, _ = run([str(PYTHON), sync, "list"])
    if lcode == 0:
        for line in lout.splitlines():
            parts = line.split()
            if probe_name.split()[-1] in line and parts:
                run([str(PYTHON), sync, "delete", "--app-id", parts[0]])
                break
    tail = (err or out).strip().splitlines()[-1] if (err or out).strip() else "no detail captured"
    return "failed", tail


def gate(source: Path, distilled: Path | None = None, run=run_cmd, skip_probe: bool = False) -> dict:
    """The D3 eligibility verdict. `eligible` is False on ANY lint/model failure or a probe FAILURE
    (OQ1 resolved: hard on the source probe); a `skipped` probe degrades to lint-only, still eligible."""
    reasons = check_lint(source, run=run)
    reasons += check_model_wiring(source)
    if distilled is not None:
        reasons += check_lint(distilled, run=run)
    probe_status, probe_detail = ("skipped", "probe skipped by flag") if skip_probe else probe_source(source, run=run)
    if probe_status == "failed":
        reasons.append(f"import-probe FAILED on the source: {probe_detail}")
    return {
        "eligible": not reasons,
        "reasons": reasons,
        "probe": probe_status,
        "probe_detail": probe_detail,
        "known_good_dify": DIFY_TAG.read_text(encoding="utf-8").strip()
        if probe_status == "ok" and DIFY_TAG.exists() else None,
    }


def add_candidate(rule: str, citation: str, log_path: Path = CANDIDATES_MD) -> bool:
    """D2a — append a linter-rule candidate, deduped on the exact rule statement. True = added."""
    rule = rule.strip()
    if not log_path.exists():
        log_path.write_text(CANDIDATES_HEADER + "\n", encoding="utf-8")
    body = log_path.read_text(encoding="utf-8")
    if rule in body:
        return False  # the match-key dedup (D2b note): same lesson twice → one bullet
    with log_path.open("a", encoding="utf-8") as f:
        f.write(f"- {rule} — cite: `{citation}`\n")
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Promotion quality gate + linter-candidate channel (spec 050)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    chk = sub.add_parser("check", help="D3 eligibility gate on a proven-build candidate")
    chk.add_argument("source")
    chk.add_argument("--distilled", help="the distilled output pattern (re-linted, D3.1 r3)")
    chk.add_argument("--json", action="store_true")
    chk.add_argument("--skip-probe", action="store_true")
    cand = sub.add_parser("candidate", help="D2a linter-rule candidate note (deduped)")
    cand.add_argument("--rule", required=True)
    cand.add_argument("--citation", required=True)
    args = ap.parse_args(argv)

    if args.cmd == "candidate":
        added = add_candidate(args.rule, args.citation)
        print("added" if added else "deduped (rule statement already recorded)")
        return 0

    verdict = gate(Path(args.source), Path(args.distilled) if args.distilled else None,
                   skip_probe=args.skip_probe)
    if args.json:
        print(json.dumps(verdict, ensure_ascii=False, indent=2))
    else:
        mark = "✓ ELIGIBLE" if verdict["eligible"] else "✗ BLOCKED"
        print(f"{mark} — probe: {verdict['probe']} ({verdict['probe_detail']})")
        for r in verdict["reasons"]:
            print(f"  - {r}")
    return 0 if verdict["eligible"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

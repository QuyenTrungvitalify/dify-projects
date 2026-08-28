#!/usr/bin/env python3
"""phase_timing.py — per-phase wall-clock for a Builder run (spec 028 measurement, no stopwatch).

Given a taskId, reads `apps/builder/.runs/<taskId>/task.json` -> `sessionIds` {analyze, spec, implement},
locates each phase's Claude session transcript (`~/.claude/projects/*/<sessionId>.jsonl`), and computes
`(last - first)` of the ISO-8601 `timestamp` field per phase. This is the metric spec 028 §Acceptance
defines. Phase (4) Test is backend-run (no transcript), so it is not timed here.

Two totals are reported:
  - compute  = SUM of the per-phase spans  → the build's actual work (excludes human gate pauses).
  - wall     = first-ever -> last-ever ts  → includes think/gate pauses (only meaningful for `auto`).

A FAST build (spec 028) has NO `analyze` session — the merged Analyze+Spec turn is stored under
`spec` — so its `analyze` row shows `—`; that absence is the merge, visible at a glance.

Usage:
  python3 .claude/skills/report/phase_timing.py                 # list recent runs (pick a taskId)
  python3 .claude/skills/report/phase_timing.py <taskId> [<taskId> ...]   # time + compare
  python3 .claude/skills/report/phase_timing.py --repo <root> <taskId>
  python3 .claude/skills/report/phase_timing.py --json <taskId>
"""
import json, os, sys, glob
from datetime import datetime

PHASES = ("analyze", "spec", "implement")


def find_transcript(sid):
    if not sid:
        return None
    hits = glob.glob(os.path.join(os.path.expanduser("~/.claude/projects"), "*", f"{sid}.jsonl"))
    return hits[0] if hits else None


def parse_ts(s):
    if not isinstance(s, str):
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def phase_span(path):
    """(first, last, seconds) over every line's top-level `timestamp`, or None if none found."""
    first = last = None
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line:
            continue
        try:
            o = json.loads(line)
        except Exception:
            continue
        dt = parse_ts(o.get("timestamp"))
        if dt is None:
            continue
        if first is None or dt < first:
            first = dt
        if last is None or dt > last:
            last = dt
    if first is None or last is None:
        return None
    return (first, last, (last - first).total_seconds())


def measure(repo, task_id):
    tp = os.path.join(repo, "apps/builder/.runs", task_id, "task.json")
    if not os.path.exists(tp):
        return {"taskId": task_id, "error": f"task.json not found: {tp}"}
    task = json.load(open(tp))
    sessions = task.get("sessionIds", {}) or {}
    spans, secs = {}, {}
    all_first = all_last = None
    for ph in PHASES:
        path = find_transcript(sessions.get(ph))
        span = phase_span(path) if path else None
        spans[ph] = span
        secs[ph] = round(span[2], 1) if span else None
        if span:
            f, l, _ = span
            all_first = f if all_first is None or f < all_first else all_first
            all_last = l if all_last is None or l > all_last else all_last
    compute = round(sum(s[2] for s in spans.values() if s), 1)
    wall = round((all_last - all_first).total_seconds(), 1) if all_first and all_last else None
    return {
        "taskId": task_id,
        "fastMode": bool(task.get("fastMode")),
        "status": task.get("status"),
        "phase": task.get("phase"),
        "requirement": (task.get("requirement") or "")[:60],
        "phases": secs,
        "compute_s": compute,
        "wall_s": wall,
    }


def list_runs(repo):
    root = os.path.join(repo, "apps/builder/.runs")
    rows = []
    for f in glob.glob(os.path.join(root, "*", "task.json")):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        rows.append((d.get("taskId", ""), bool(d.get("fastMode")), d.get("status"), (d.get("requirement") or "")[:44]))
    rows.sort(key=lambda r: r[0], reverse=True)
    print(f"{'taskId':<15} {'fast':<5} {'status':<16} requirement")
    print("-" * 78)
    for tid, fast, st, req in rows[:20]:
        print(f"{tid:<15} {'⚡' if fast else '·':<5} {str(st):<16} {req}")
    print("\nTime one:  python3 .claude/skills/report/phase_timing.py <taskId> [<taskId> ...]")


def fmt(v):
    return f"{v:>7.1f}s" if isinstance(v, (int, float)) else f"{'—':>8}"


def print_table(results):
    print(f"{'taskId':<15} {'mode':<6} {'analyze':>9} {'spec':>9} {'implement':>10} {'compute':>9} {'wall':>8}  status")
    print("-" * 92)
    for r in results:
        if r.get("error"):
            print(f"{r['taskId']:<15} ERROR: {r['error']}")
            continue
        p = r["phases"]
        print(
            f"{r['taskId']:<15} {'⚡fast' if r['fastMode'] else 'std':<6}"
            f"{fmt(p['analyze']):>10}{fmt(p['spec']):>10}{fmt(p['implement']):>11}"
            f"{fmt(r['compute_s']):>10}{fmt(r['wall_s']):>9}  {r['status']}"
        )
    # fast-vs-standard delta when exactly one of each is present
    fast = [r for r in results if not r.get("error") and r["fastMode"]]
    std = [r for r in results if not r.get("error") and not r["fastMode"]]
    if fast and std:
        fc = sum(r["compute_s"] for r in fast) / len(fast)
        sc = sum(r["compute_s"] for r in std) / len(std)
        d = sc - fc
        pct = (d / sc * 100) if sc else 0
        print("-" * 92)
        print(f"compute mean:  ⚡fast {fc:.1f}s  vs  std {sc:.1f}s   →   Δ {d:+.1f}s ({pct:+.1f}%)"
              f"   [n_fast={len(fast)}, n_std={len(std)}]")
        if len(fast) < 3 or len(std) < 3:
            print("note: n<3 per group — run more builds of the SAME prompt for a median that clears run-to-run variance.")


def main():
    args = sys.argv[1:]
    repo = "."
    if "--repo" in args:
        i = args.index("--repo")
        repo = args[i + 1]
        del args[i:i + 2]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]

    if not args:
        list_runs(repo)
        return
    results = [measure(repo, tid) for tid in args]
    if as_json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        print_table(results)


if __name__ == "__main__":
    main()

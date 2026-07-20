#!/usr/bin/env python3
"""campaign.py — manifest utilities for a /campaign test run (spec 073).

A campaign lives in one directory (docs/prompts/gen/<id>/): a `campaign.yml` manifest plus the
generated prompt files (G##-*.md). This tool owns every machine-checkable step of the lifecycle so
the orchestrating session (and the background runner) never re-implement them ad hoc:

    lint <dir>              charter check on every prompt file (blocklist + anatomy)
    approve <dir>           re-lint, then flip manifest status draft -> approved
    verify <dir>            run-precondition: status approved AND builder version unchanged
    next <dir>              JSON of the first pending prompt (exit 3 when none left)
    record <dir> <file> --task-id N   harvest one run's result into the manifest
    status <dir>            human summary table

Design constraints inherited from the v0.1.0 campaign lessons:
- The runner must never compare turns (denied calls are the thrash oracle) — so `record` harvests
  denied-call counts per phase from the transcripts, exactly like e2e_check's predicate.
- Version is pinned twice: `plan` writes builder_version; `verify` re-checks it at run time so a
  campaign can never silently test a different Builder than it planned (exit 2 on drift — the
  human decides whether to retarget or abandon).
- An error run may lack report.json/cost — `record` stores whatever exists and never crashes on a
  partial run dir (the artifact rule: nothing here may fail a build, and nothing here may fail on
  a failed build either).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
RUNS_DIR = Path(__file__).resolve().parents[1] / ".runs"
PKG_JSON = Path(__file__).resolve().parents[1] / "package.json"

# ── charter blocklists (docs/prompts/CHARTER.md is the human-facing source of these) ────────────
# Latin terms match on word boundary, case-insensitive; JP terms match as substrings.
HARD_LATIN = [
    "webhook", "workflow", "node", "trigger", "DSL", "dataset", "knowledge base", "LLM",
    "plugin", "endpoint", "payload", "cron", "iteration", "if-else", "http-request",
]
HARD_JP = ["ワークフロー", "ノード", "トリガー", "プラグイン", "データセット", "ペイロード"]
WARN_LATIN = ["API", "JSON", "prompt"]
WARN_JP = ["スプレッドシート連携"]

REQUIRED_HEADINGS = ["## Bối cảnh", "## Trục", "## Hình dạng", "## Bẫy", "## MANUAL"]

FENCE_RE = re.compile(r"^```[^\n]*\n(.*?)\n```", re.DOTALL | re.MULTILINE)


def extract_prompt(text: str) -> str | None:
    """The first fenced block, which must appear before any `##` heading (CHARTER anatomy)."""
    m = FENCE_RE.search(text)
    if not m:
        return None
    first_heading = text.find("\n## ")
    if first_heading != -1 and m.start() > first_heading:
        return None  # fenced block exists but not where the đề belongs
    return m.group(1)


def lint_prompt_file(path: Path) -> tuple[list[str], list[str]]:
    """→ (hard violations, warnings) for one prompt file."""
    text = path.read_text(encoding="utf-8")
    hard: list[str] = []
    warn: list[str] = []
    prompt = extract_prompt(text)
    if prompt is None:
        hard.append("thiếu khối đề fenced đứng trước mọi heading ## (CHARTER §Giải phẫu)")
        prompt = ""
    for h in REQUIRED_HEADINGS:
        if not re.search(rf"^{re.escape(h)}", text, re.MULTILINE):
            hard.append(f"thiếu mục '{h}…'")
    for term in HARD_LATIN:
        if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(term)}(?![A-Za-z0-9_-])", prompt, re.IGNORECASE):
            hard.append(f"đề chứa từ-nghề (HARD): {term!r}")
    for term in HARD_JP:
        if term in prompt:
            hard.append(f"đề chứa từ-nghề (HARD): {term!r}")
    for term in WARN_LATIN:
        if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(term)}(?![A-Za-z0-9_-])", prompt, re.IGNORECASE):
            warn.append(f"đề chứa từ cần người duyệt xem lại (WARN): {term!r}")
    for term in WARN_JP:
        if term in prompt:
            warn.append(f"đề chứa từ cần người duyệt xem lại (WARN): {term!r}")
    return hard, warn


# ── manifest I/O ─────────────────────────────────────────────────────────────────────────────────

def load_manifest(cdir: Path) -> dict:
    mf = cdir / "campaign.yml"
    if not mf.exists():
        sys.exit(f"❌ {mf}: not found — chạy `/campaign plan` trước")
    data = yaml.safe_load(mf.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("prompts"), list):
        sys.exit(f"❌ {mf}: manifest hỏng (cần mapping với danh sách `prompts`)")
    return data


def save_manifest(cdir: Path, data: dict) -> None:
    (cdir / "campaign.yml").write_text(
        yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )


def prompt_files(cdir: Path, data: dict) -> list[Path]:
    return [cdir / p["file"] for p in data["prompts"]]


# ── subcommands ──────────────────────────────────────────────────────────────────────────────────

def cmd_lint(cdir: Path) -> int:
    data = load_manifest(cdir)
    any_hard = False
    for path in prompt_files(cdir, data):
        if not path.exists():
            print(f"❌ {path.name}: file khai trong manifest nhưng không tồn tại")
            any_hard = True
            continue
        hard, warn = lint_prompt_file(path)
        for v in hard:
            print(f"❌ {path.name}: {v}")
        for v in warn:
            print(f"⚠️  {path.name}: {v}")
        if hard:
            any_hard = True
        elif not warn:
            print(f"✅ {path.name}")
    return 2 if any_hard else 0


def cmd_approve(cdir: Path) -> int:
    data = load_manifest(cdir)
    if data.get("status") != "draft":
        sys.exit(f"❌ status là {data.get('status')!r}, chỉ approve được từ 'draft'")
    if cmd_lint(cdir) != 0:
        sys.exit("❌ lint chưa sạch — không approve")
    data["status"] = "approved"
    data["approved_on"] = date.today().isoformat()
    save_manifest(cdir, data)
    shown = cdir.relative_to(ROOT) if cdir.is_relative_to(ROOT) else cdir
    print(f"✅ approved — commit {shown} để đóng băng đề")
    return 0


def current_builder_version() -> str:
    return str(json.loads(PKG_JSON.read_text(encoding="utf-8")).get("version", "?"))


def cmd_verify(cdir: Path) -> int:
    data = load_manifest(cdir)
    if data.get("status") != "approved":
        sys.exit(f"❌ status là {data.get('status')!r} — cần 'approved' (duyệt ở gate trước)")
    pinned = str(data.get("builder_version", "?"))
    cur = current_builder_version()
    if pinned != cur:
        sys.exit(
            f"❌ version lệch: plan ghim Builder {pinned}, hiện tại {cur}.\n"
            f"   Người quyết: test tiếp trên {cur} (sửa builder_version trong campaign.yml) hay hủy plan."
        )
    print(f"✅ approved · Builder {cur}")
    return 0


def cmd_next(cdir: Path) -> int:
    data = load_manifest(cdir)
    for p in data["prompts"]:
        if p.get("status", "pending") == "pending":
            text = (cdir / p["file"]).read_text(encoding="utf-8")
            prompt = extract_prompt(text)
            if prompt is None:
                sys.exit(f"❌ {p['file']}: không trích được khối đề")
            print(json.dumps({
                "file": p["file"],
                "prompt": prompt,
                "mode": p.get("mode", "auto"),
                "project": p.get("project"),
                "workflow": p.get("workflow"),
                "attempt": len(p.get("task_ids", [])) + 1,
            }, ensure_ascii=False))
            return 0
    return 3  # nothing pending — runner treats this as "campaign settled"


def _denied_calls(run_dir: Path, phase: str) -> int | None:
    """Reuse e2e_check's transcript-based denied-call counter (the spec-071 oracle) verbatim."""
    spec = importlib.util.spec_from_file_location("e2e_check", Path(__file__).parent / "e2e_check.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    try:
        return mod._denied_calls(run_dir, phase)
    except Exception:
        return None


def cmd_record(cdir: Path, fname: str, task_id: str) -> int:
    data = load_manifest(cdir)
    entry = next((p for p in data["prompts"] if p["file"] == fname), None)
    if entry is None:
        sys.exit(f"❌ {fname}: không có trong manifest")
    run_dir = RUNS_DIR / task_id
    task_json = run_dir / "task.json"
    if not task_json.exists():
        sys.exit(f"❌ {task_json}: không tồn tại — task chưa chạy?")
    task = json.loads(task_json.read_text(encoding="utf-8"))

    result: dict = {"task_id": task_id, "task_status": task.get("status")}
    cost = task.get("cost") or {}
    result["phases"] = {
        ph: {
            "model": (c or {}).get("model"),
            "turns": (c or {}).get("numTurns"),
            "denied_calls": _denied_calls(run_dir, ph),
        }
        for ph, c in cost.items()
    }
    report_json = run_dir / "report.json"
    if report_json.exists():  # an error run may legitimately lack it — record what exists
        report = json.loads(report_json.read_text(encoding="utf-8"))
        result["lint"] = report.get("lint")
        result["workflow_file"] = report.get("workflow_file")
    if task.get("status") == "error":
        result["error"] = task.get("error")

    entry.setdefault("task_ids", []).append(task_id)
    entry["status"] = "done" if task.get("status") == "done" else "error"
    entry.setdefault("results", []).append(result)
    save_manifest(cdir, data)
    print(f"✅ {fname}: {entry['status']} (task {task_id}, attempt {len(entry['task_ids'])})")
    return 0


def cmd_status(cdir: Path) -> int:
    data = load_manifest(cdir)
    counts: dict[str, int] = {}
    print(f"campaign {data.get('id')} · Builder {data.get('builder_version')} · {data.get('status')}")
    for p in data["prompts"]:
        st = p.get("status", "pending")
        counts[st] = counts.get(st, 0) + 1
        ids = ",".join(p.get("task_ids", [])) or "—"
        print(f"  {st:8} {p['file']}  [{ids}]")
    print("  " + " · ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="campaign.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("lint", "approve", "verify", "next", "status"):
        s = sub.add_parser(name)
        s.add_argument("dir", type=Path)
    s = sub.add_parser("record")
    s.add_argument("dir", type=Path)
    s.add_argument("file")
    s.add_argument("--task-id", required=True)
    a = ap.parse_args(argv)
    cdir = a.dir.resolve()
    if a.cmd == "lint":
        return cmd_lint(cdir)
    if a.cmd == "approve":
        return cmd_approve(cdir)
    if a.cmd == "verify":
        return cmd_verify(cdir)
    if a.cmd == "next":
        return cmd_next(cdir)
    if a.cmd == "record":
        return cmd_record(cdir, a.file, a.task_id)
    if a.cmd == "status":
        return cmd_status(cdir)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

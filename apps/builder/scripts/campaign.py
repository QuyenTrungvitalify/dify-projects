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
    summary <dir> [--json]  spec 086: ONE mechanical Pass line (4 linters + probe + override) for CAMPAIGNS.md

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
import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
# Env override exists for the runner drill tests (tests/test_campaign.py) — production never sets it.
RUNS_DIR = Path(os.environ.get("CAMPAIGN_RUNS_DIR", Path(__file__).resolve().parents[1] / ".runs"))
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

def cmd_init(cdir: Path) -> int:
    """Skeleton manifest from the prompt files already in <dir> — safe-dumped from the start, so
    the hand-authoring class of bugs (a bare `#6` silently becoming a YAML comment) cannot recur."""
    mf = cdir / "campaign.yml"
    if mf.exists():
        sys.exit(f"❌ {mf}: đã tồn tại — init chỉ tạo mới, không ghi đè")
    files = sorted(p.name for p in cdir.glob("*.md") if re.match(r"^[GP]\d\d-", p.name))
    if not files:
        sys.exit(f"❌ {cdir}: không có file đề (G##-*.md / P##-*.md) — viết đề trước, init sau")
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                             capture_output=True, text=True, check=True).stdout.strip()
    except Exception:
        sha = "?"
    data = {
        "id": cdir.name,
        "request": "TODO: nguyên văn yêu cầu đợt test",
        "builder_version": current_builder_version(),
        "git_sha": sha,
        "status": "draft",
        "prompts": [
            {"file": f, "axis": "TODO", "why": "TODO", "mode": "auto",
             "project": None, "workflow": None, "status": "pending", "task_ids": []}
            for f in files
        ],
    }
    save_manifest(cdir, data)
    print(f"✅ campaign.yml sinh cho {len(files)} đề — điền request/axis/why rồi lint")
    return 0


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


# ── ✗ classification (S5-2) ─────────────────────────────────────────────────────────────────────
# The transcript's "### Tool calls" section marks failures with ✗ but records no reason, so a raw
# count conflates two very different things: a gate-DENIAL (search thrash — the spec-071 oracle's
# target) and a command that RAN and failed (e.g. a linter reporting findings during the normal
# self-correct loop). Run 1784522395970 proved the cost: 11✗ in ③ read as "thrash 11" when 4 of
# them were legitimate lint iterations. Classification mirrors the permission-gate's own allowlist
# (apps/builder/server/hooks/permission-gate.ts): a call the gate would ALLOW that still shows ✗
# must have errored; a call the gate would DENY is a denial. Heuristic — transcript lines truncate
# (~80 chars), so a metacharacter past the cut is invisible; treat the split as an estimate.

_ALLOWED_PY = re.compile(
    r"^\.venv/bin/python3? tools/dify_base/"
    r"(find|validate_workflow|lint_refs|lint_plugin_hashes|lint_node_bodies)\.py\b"
)
_ALLOWED_SIMPLE = re.compile(r"^(ls|cat|head|tail|pwd|wc|echo|true|git (status|diff))\b")
_METACHAR = re.compile(r"[|;&><`*$]")
_CALL_LINE = re.compile(r"^- (\w+) {2}(.*?) {2}[✓✗]\s*$")


def classify_failed_calls(run_dir: Path, phase: str) -> dict | None:
    """→ {'denied': n, 'errored': n} (estimate) for one phase's ✗ lines, or None without transcript."""
    t = run_dir / "transcripts" / f"{phase}.md"
    if not t.exists():
        return None
    denied = errored = 0
    in_calls = False
    for line in t.read_text(encoding="utf-8").splitlines():
        if line.startswith("### Tool calls"):
            in_calls = True
            continue
        if in_calls and line.startswith("### "):
            in_calls = False
        if not in_calls or "✗" not in line:
            continue
        m = _CALL_LINE.match(line)
        if not m:
            continue
        tool, cmd = m.group(1), m.group(2)
        if tool != "Bash":
            # Grep-tool errors, Edit misses, … — tool-level failures, not gate denials. (A
            # forbidden-path deny on Read/Edit is possible but rare; accepted imprecision.)
            errored += 1
        elif _METACHAR.search(cmd):
            denied += 1  # the gate rejects any shell metacharacter outright
        elif _ALLOWED_PY.match(cmd) or _ALLOWED_SIMPLE.match(cmd):
            errored += 1  # gate would allow → it ran and failed (self-correct loop, bad args, …)
        else:
            denied += 1  # deny-verbs (grep/find/…), non-allowlisted scripts, python -c, …
    return {"denied": denied, "errored": errored}


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
            "failed_split": classify_failed_calls(run_dir, ph),
        }
        for ph, c in cost.items()
    }
    report_json = run_dir / "report.json"
    if report_json.exists():  # an error run may legitimately lack it — record what exists
        report = json.loads(report_json.read_text(encoding="utf-8"))
        result["lint"] = report.get("lint")
        result["workflow_file"] = report.get("workflow_file")
        # Spec 086 S1: the structured probe verdict + the human accept-override — the two report
        # fields `summary` needs beyond lint. Absent on pre-086 report.json → stays None (n/a).
        result["probe"] = report.get("probe")
        result["accepted_lint_failure"] = report.get("accepted_lint_failure")
        # A build may write MORE yml files than the one ④ reports (observed: monthly_summary.yml
        # beside main.yml, never linted, never mentioned in notes). Surface every sibling so the
        # report stage cannot inherit ④'s single-file blindness.
        wf = report.get("workflow_file")
        if wf:
            wf_path = Path(wf) if Path(wf).is_absolute() else ROOT / wf
            if wf_path.parent.is_dir():
                siblings = sorted(p.name for p in wf_path.parent.glob("*.yml"))
                result["workflow_files"] = siblings
                extras = [s for s in siblings if s != wf_path.name]
                if extras:
                    result["extra_workflow_files_unlinted"] = extras
    if task.get("status") == "error":
        result["error"] = task.get("error")

    # Idempotent per task_id: recording the same run twice (e.g. a stray second runner, or a manual
    # record after the runner already logged it) must not duplicate the attempt — that corrupts the
    # denied-call/attempt counts the report reads. Re-recording refreshes the stored result in place.
    if task_id in entry.setdefault("task_ids", []):
        entry["results"] = [r for r in entry.get("results", []) if r.get("task_id") != task_id]
        entry.setdefault("results", []).append(result)
        entry["status"] = "done" if task.get("status") == "done" else "error"
        save_manifest(cdir, data)
        print(f"↺ {fname}: task {task_id} đã có — cập nhật tại chỗ (không nhân bản attempt)")
        return 0
    entry["task_ids"].append(task_id)
    entry["status"] = "done" if task.get("status") == "done" else "error"
    entry.setdefault("results", []).append(result)
    save_manifest(cdir, data)
    print(f"✅ {fname}: {entry['status']} (task {task_id}, attempt {len(entry['task_ids'])})")
    return 0


def _fold_timeline(run_dir: Path) -> dict:
    """events.jsonl → {phase: workingMs} — mirror of report-analysis.ts summarizeTimeline (spec 075).
    phase_start opens a phase; the FIRST gate_reached after it closes the working span. Missing → {}."""
    ev_file = run_dir / "events.jsonl"
    if not ev_file.exists():
        return {"phases": [], "total_ms": None}
    starts: dict[str, int] = {}
    phases: list[dict] = []
    first_ts = last_gate = None
    for line in ev_file.read_text(encoding="utf-8").splitlines():
        try:
            ev = json.loads(line)
        except Exception:
            continue
        ts, kind, ph = ev.get("ts"), ev.get("kind"), ev.get("phase") or "(none)"
        if first_ts is None:
            first_ts = ts
        if kind == "phase_start":
            starts.setdefault(ph, ts)
        elif kind == "gate_reached":
            if not any(p["phase"] == ph for p in phases):
                st = starts.get(ph)
                phases.append({"phase": ph, "working_ms": (ts - st) if st is not None else None,
                               "outcome": ev.get("detail")})
            last_gate = ts
    return {"phases": phases, "total_ms": (last_gate - first_ts) if first_ts and last_gate else None}


def _read_json(p: Path) -> dict:
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {}


def cmd_journey(task_id: str) -> int:
    """Emit the run as a USER-JOURNEY JSON (spec 075 S2): per phase — how long the user waited, the
    text they READ (digest/criteria/diff/notes), the model, and denied/errored calls. The skill
    renders this as prose; keeping extraction here (tested, deterministic) is the S073 split."""
    run_dir = RUNS_DIR / task_id
    task = _read_json(run_dir / "task.json")
    if not task:
        sys.exit(f"❌ {run_dir}/task.json: không đọc được")
    tl = {p["phase"]: p for p in _fold_timeline(run_dir).get("phases", [])}
    cost = task.get("cost") or {}
    analyze = _read_json(run_dir / "analyze.json")
    criteria = _read_json(run_dir / "criteria.json").get("criteria", [])
    report = _read_json(run_dir / "report.json")
    diff_txt = _read_json(run_dir / "diff.json").get("diff", "")
    added = sum(1 for ln in diff_txt.splitlines() if ln.startswith("+") and not ln.startswith("+++"))
    removed = sum(1 for ln in diff_txt.splitlines() if ln.startswith("-") and not ln.startswith("---"))
    is_new = "(empty — new workflow)" in diff_txt

    def phase_meta(ph: str) -> dict:
        c = cost.get(ph) or {}
        fs = classify_failed_calls(run_dir, ph) or {}
        return {"model": c.get("model"), "turns": c.get("numTurns"),
                "working_ms": (tl.get(ph) or {}).get("working_ms"),
                "denied": fs.get("denied"), "errored": fs.get("errored")}

    journey = {
        "task_id": task_id, "status": task.get("status"), "requirement": task.get("requirement", "")[:400],
        "phases": {
            "analyze": {**phase_meta("analyze"), "user_read": analyze.get("overview", "")},
            "spec": {**phase_meta("spec"), "acceptance_criteria": criteria},
            "implement": {**phase_meta("implement"),
                          "change": ("workflow mới" if is_new else f"+{added}/-{removed} dòng")},
            "test": {"user_read": report.get("notes", ""),
                     "criteria_check": report.get("criteria_check"),
                     "lint": report.get("lint")},
        },
        "total_ms": _fold_timeline(run_dir).get("total_ms"),
    }
    print(json.dumps(journey, ensure_ascii=False, indent=2))
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


LINT_KEYS = ("validate", "lint_refs", "lint_plugin_hashes", "lint_node_bodies")

# Spec 086 S2: linter key → fail category, the Chat2Workflow taxonomy approximation so campaign
# numbers can be compared to published ones. Deliberately mechanical: `consistency` (workflow vs
# user intent) is NOT mappable from linters — that stays /report's job, never counted here.
FAIL_CATEGORY = {
    "validate": "format",           # schema envelope
    "lint_refs": "graph",           # dangling ref / edge / var
    "lint_plugin_hashes": "semantic",
    "lint_node_bodies": "semantic",
}


def _summarize_run(result: dict) -> dict:
    """Spec 086 S2 — one run's mechanical verdict. PURE function of the recorded manifest result
    (never reads .runs/ — survives run-dir cleanup). PASS ⇔ task done AND all 4 linters 0 AND not
    a human accept-override AND the probe did not reject. probe ∈ {ok, skipped, unknown_version,
    None} does NOT block: absence of the oracle is not failure; `unknown_version` is an env
    mismatch, counted separately, never a Builder fail."""
    cats: list[str] = []
    if result.get("task_status") != "done":
        cats.append("build-error")
    lint = result.get("lint")
    if result.get("task_status") == "done":
        if not isinstance(lint, dict):
            cats.append("build-error")  # done without lint codes = partial record — never guess PASS
        else:
            for k in LINT_KEYS:
                if lint.get(k) != 0:
                    cats.append(FAIL_CATEGORY[k])
    if result.get("probe") == "failed":
        cats.append("import")
    accepted = bool(result.get("accepted_lint_failure"))
    if accepted and "accepted-override" not in cats:
        cats.append("accepted-override")  # counts as FAIL + surfaced separately (086 Open Q2 default)
    # dedup, keep order
    seen: set[str] = set()
    cats = [c for c in cats if not (c in seen or seen.add(c))]
    return {"passed": not cats, "categories": cats, "probe": result.get("probe", None)}


def cmd_summary(cdir: Path, as_json: bool) -> int:
    """Spec 086 S2 — aggregate the campaign's recorded runs into ONE mechanical Pass line.
    Reads ONLY campaign.yml (durable); per-prompt verdict = the LAST recorded attempt (matches how
    SUMMARY grades — 086 Open Q1 default). Never crashes on a partial manifest."""
    data = load_manifest(cdir)
    rows: list[dict] = []
    for p in data.get("prompts", []):
        results = p.get("results") or []
        if not results:
            rows.append({"file": p["file"], "passed": False, "categories": ["not-run"], "probe": None})
            continue
        rows.append({"file": p["file"], **_summarize_run(results[-1])})
    total = len(rows)
    passed = sum(1 for r in rows if r["passed"])
    fails = [(r["file"], "+".join(r["categories"])) for r in rows if not r["passed"]]
    probe_counts: dict[str, int] = {}
    for r in rows:
        key = r["probe"] if r["probe"] is not None else "n/a"
        probe_counts[key] = probe_counts.get(key, 0) + 1
    overrides = sum(1 for r in rows if "accepted-override" in r["categories"])
    fail_part = f" · fail: {', '.join(f'{f}({c})' for f, c in fails)}" if fails else ""
    probe_part = " · probe " + "/".join(f"{v} {k}" for k, v in sorted(probe_counts.items()))
    line = f"Pass {passed}/{total}{fail_part}{probe_part} · accepted-override {overrides}"
    if as_json:
        print(json.dumps({"pass": passed, "total": total, "rows": rows, "line": line}, ensure_ascii=False))
        return 0
    for r in rows:
        mark = "✅" if r["passed"] else "❌"
        cats = "" if r["passed"] else f"  [{'+'.join(r['categories'])}]"
        probe = f"  probe={r['probe']}" if r["probe"] else ""
        print(f"  {mark} {r['file']}{cats}{probe}")
    print(f"\n{line}")
    print("(Pass = 4 linter sạch + không accept-override + probe không fail — tầng CẤU TRÚC, "
          "không phải chất lượng nội dung)")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="campaign.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("init", "lint", "approve", "verify", "next", "status"):
        s = sub.add_parser(name)
        s.add_argument("dir", type=Path)
    s = sub.add_parser("record")
    s.add_argument("dir", type=Path)
    s.add_argument("file")
    s.add_argument("--task-id", required=True)
    sj = sub.add_parser("journey")
    sj.add_argument("task_id")
    ss = sub.add_parser("summary")
    ss.add_argument("dir", type=Path)
    ss.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "journey":
        return cmd_journey(a.task_id)
    cdir = a.dir.resolve()
    if a.cmd == "init":
        return cmd_init(cdir)
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
    if a.cmd == "summary":
        return cmd_summary(cdir, a.json)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

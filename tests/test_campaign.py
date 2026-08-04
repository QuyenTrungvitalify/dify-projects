"""Tests for apps/builder/scripts/campaign.py — the /campaign manifest utilities (spec 073).

What must hold: the charter lint rejects solution-jargon in the đề (and ONLY in the đề — grader
sections may use it freely) and missing anatomy; approve is impossible on a dirty or non-draft
manifest; verify blocks a version drift between plan-time and run-time; next/record round-trip a
prompt through pending → done with the denied-call oracle harvested per phase; and record survives
an error run whose dir lacks report.json (nothing in the harness may crash on a failed build).
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import yaml

SCRIPT = Path(__file__).parent.parent / "apps" / "builder" / "scripts" / "campaign.py"


def _load():
    spec = importlib.util.spec_from_file_location("campaign", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


cp = _load()

CLEAN_PROMPT = """# G01 — đối chiếu công nợ

```
毎月、売掛金の一覧と入金の一覧を目で突き合わせています。
まだ入金されていない会社を洗い出して、一覧にしてほしいです。
金額は絶対に書き換えないでください。
```

## Bối cảnh giả định
Kế toán tổng hợp, làm tay mỗi cuối tháng.

## Trục năng lực được thử
2-file input · so khớp bằng code.

## Hình dạng build tốt
start file-list → code so khớp → end. (webhook không liên quan — từ-nghề ở mục chấm là hợp lệ.)

## Bẫy đã biết
LLM không được đụng số.

## MANUAL dự kiến
Chạy với 2 file Excel thật.
"""


def _mk_campaign(tmp_path: Path, prompt_text: str = CLEAN_PROMPT, status: str = "draft",
                 version: str = "0.2.0") -> Path:
    cdir = tmp_path / "2026-07-25-test"
    cdir.mkdir()
    (cdir / "G01-congno.md").write_text(prompt_text, encoding="utf-8")
    (cdir / "campaign.yml").write_text(yaml.safe_dump({
        "id": "2026-07-25-test",
        "request": "test",
        "builder_version": version,
        "git_sha": "abc1234",
        "status": status,
        "prompts": [{"file": "G01-congno.md", "axis": "2-file", "why": "t", "mode": "auto",
                     "status": "pending", "task_ids": []}],
    }, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return cdir


# ── lint ─────────────────────────────────────────────────────────────────────────────────────────

def test_lint_clean_passes(tmp_path):
    assert cp.cmd_lint(_mk_campaign(tmp_path)) == 0


def test_lint_hard_jargon_in_prompt_fails(tmp_path):
    dirty = CLEAN_PROMPT.replace("洗い出して", "webhookで洗い出して")
    assert cp.cmd_lint(_mk_campaign(tmp_path, dirty)) == 2


def test_lint_jp_jargon_fails(tmp_path):
    dirty = CLEAN_PROMPT.replace("一覧にしてほしい", "ワークフローにしてほしい")
    assert cp.cmd_lint(_mk_campaign(tmp_path, dirty)) == 2


def test_lint_jargon_in_grader_sections_is_fine(tmp_path):
    # CLEAN_PROMPT already says "webhook" inside «Hình dạng build tốt» — must NOT trip the lint.
    assert cp.cmd_lint(_mk_campaign(tmp_path)) == 0


def test_lint_word_boundary_no_false_positive(tmp_path):
    # "nodes" as part of a larger word must not match "node"... but "trigger-webhook" style compounds
    # in the đề are still user-impossible; the boundary rule only protects innocent containments.
    ok = CLEAN_PROMPT.replace("会社を洗い出して", "Nodemaster社の一覧を洗い出して")
    assert cp.cmd_lint(_mk_campaign(tmp_path, ok)) == 0


def test_lint_missing_section_fails(tmp_path):
    broken = CLEAN_PROMPT.replace("## MANUAL dự kiến\nChạy với 2 file Excel thật.\n", "")
    assert cp.cmd_lint(_mk_campaign(tmp_path, broken)) == 2


def test_lint_missing_fence_fails(tmp_path):
    no_fence = CLEAN_PROMPT.replace("```", "")
    assert cp.cmd_lint(_mk_campaign(tmp_path, no_fence)) == 2


def test_lint_warn_terms_do_not_fail(tmp_path, capsys):
    warned = CLEAN_PROMPT.replace("一覧にしてほしいです。", "一覧にしてほしいです。APIでもいいです。")
    assert cp.cmd_lint(_mk_campaign(tmp_path, warned)) == 0
    assert "WARN" in capsys.readouterr().out


# ── approve / verify ─────────────────────────────────────────────────────────────────────────────

def test_approve_flips_draft_to_approved(tmp_path):
    cdir = _mk_campaign(tmp_path)
    assert cp.cmd_approve(cdir) == 0
    assert cp.load_manifest(cdir)["status"] == "approved"


def test_approve_refuses_dirty_lint(tmp_path):
    cdir = _mk_campaign(tmp_path, CLEAN_PROMPT.replace("洗い出して", "webhookで"))
    try:
        cp.cmd_approve(cdir)
        raise AssertionError("approve trên lint bẩn phải chết")
    except SystemExit:
        pass
    assert cp.load_manifest(cdir)["status"] == "draft"


def test_approve_refuses_non_draft(tmp_path):
    cdir = _mk_campaign(tmp_path, status="approved")
    try:
        cp.cmd_approve(cdir)
        raise AssertionError("approve lần hai phải chết")
    except SystemExit:
        pass


def test_verify_blocks_version_drift(tmp_path):
    cdir = _mk_campaign(tmp_path, status="approved", version="0.0.0-not-current")
    try:
        cp.cmd_verify(cdir)
        raise AssertionError("verify phải chặn version lệch")
    except SystemExit as e:
        assert "version lệch" in str(e.code)


def test_verify_blocks_draft(tmp_path):
    cdir = _mk_campaign(tmp_path, status="draft", version=cp.current_builder_version())
    try:
        cp.cmd_verify(cdir)
        raise AssertionError("verify phải chặn draft")
    except SystemExit:
        pass


def test_verify_passes_when_pinned_matches(tmp_path):
    cdir = _mk_campaign(tmp_path, status="approved", version=cp.current_builder_version())
    assert cp.cmd_verify(cdir) == 0


# ── next / record round-trip ─────────────────────────────────────────────────────────────────────

def test_next_emits_pending_prompt(tmp_path, capsys):
    assert cp.cmd_next(_mk_campaign(tmp_path)) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["file"] == "G01-congno.md"
    assert "売掛金" in out["prompt"]
    assert out["attempt"] == 1


def test_next_exit3_when_settled(tmp_path):
    cdir = _mk_campaign(tmp_path)
    data = cp.load_manifest(cdir)
    data["prompts"][0]["status"] = "done"
    cp.save_manifest(cdir, data)
    assert cp.cmd_next(cdir) == 3


def _mk_run(tmp_path: Path, task_id: str, status: str, with_report: bool) -> None:
    run = tmp_path / "runs" / task_id
    (run / "transcripts").mkdir(parents=True)
    task = {"status": status,
            "cost": {"implement": {"model": "claude-haiku-4-5", "numTurns": 20}}}
    if status == "error":
        task["error"] = "API connection closed"
    (run / "task.json").write_text(json.dumps(task), encoding="utf-8")
    (run / "transcripts" / "implement.md").write_text(
        "### Tool calls\n- Bash  grep x  ✗\n- Bash  ls  ✓\n### Result\n", encoding="utf-8")
    if with_report:
        (run / "report.json").write_text(json.dumps(
            {"lint": {"validate": 0}, "workflow_file": "projects/_drafts/x/workflows/main.yml"}),
            encoding="utf-8")


def test_record_done_harvests_model_denied_lint(tmp_path, monkeypatch):
    cdir = _mk_campaign(tmp_path)
    _mk_run(tmp_path, "111", "done", with_report=True)
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    assert cp.cmd_record(cdir, "G01-congno.md", "111") == 0
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["status"] == "done" and p["task_ids"] == ["111"]
    r = p["results"][0]
    assert r["phases"]["implement"]["model"] == "claude-haiku-4-5"
    assert r["phases"]["implement"]["denied_calls"] == 1
    assert r["lint"] == {"validate": 0}


def test_record_error_run_without_report_survives(tmp_path, monkeypatch):
    cdir = _mk_campaign(tmp_path)
    _mk_run(tmp_path, "222", "error", with_report=False)
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    assert cp.cmd_record(cdir, "G01-congno.md", "222") == 0
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["status"] == "error"
    assert p["results"][0]["error"] == "API connection closed"
    assert "lint" not in p["results"][0]


def test_record_same_task_id_twice_is_idempotent(tmp_path, monkeypatch):
    """Recording the same run twice (stray runner / manual re-record) must not duplicate the attempt."""
    cdir = _mk_campaign(tmp_path)
    _mk_run(tmp_path, "111", "done", with_report=True)
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    cp.cmd_record(cdir, "G01-congno.md", "111")
    cp.cmd_record(cdir, "G01-congno.md", "111")   # again — same task
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["task_ids"] == ["111"]                # not ["111", "111"]
    assert len(p["results"]) == 1


def test_record_retry_keeps_both_task_ids(tmp_path, monkeypatch):
    cdir = _mk_campaign(tmp_path)
    _mk_run(tmp_path, "222", "error", with_report=False)
    _mk_run(tmp_path, "333", "done", with_report=True)
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    cp.cmd_record(cdir, "G01-congno.md", "222")
    cp.cmd_record(cdir, "G01-congno.md", "333")
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["task_ids"] == ["222", "333"]      # both attempts preserved (spec 073 S2)
    assert p["status"] == "done"                # verdict = the retry
    assert len(p["results"]) == 2


# ── S5-4: init ───────────────────────────────────────────────────────────────────────────────────

def test_init_builds_skeleton_from_prompt_files(tmp_path):
    cdir = tmp_path / "2026-08-01-x"
    cdir.mkdir()
    (cdir / "G01-a.md").write_text(CLEAN_PROMPT, encoding="utf-8")
    (cdir / "G02-b.md").write_text(CLEAN_PROMPT, encoding="utf-8")
    (cdir / "notes.md").write_text("not a prompt", encoding="utf-8")
    assert cp.cmd_init(cdir) == 0
    d = cp.load_manifest(cdir)
    assert d["status"] == "draft" and d["id"] == "2026-08-01-x"
    assert [p["file"] for p in d["prompts"]] == ["G01-a.md", "G02-b.md"]  # notes.md ignored
    assert d["builder_version"] == cp.current_builder_version()


def test_init_refuses_overwrite(tmp_path):
    cdir = _mk_campaign(tmp_path)
    try:
        cp.cmd_init(cdir)
        raise AssertionError("init đè manifest phải chết")
    except SystemExit:
        pass


# ── S5-1: multi-file harvest ─────────────────────────────────────────────────────────────────────

def test_record_surfaces_unlinted_sibling_workflows(tmp_path, monkeypatch):
    cdir = _mk_campaign(tmp_path)
    proj = tmp_path / "proj" / "workflows"
    proj.mkdir(parents=True)
    (proj / "main.yml").write_text("x: 1", encoding="utf-8")
    (proj / "monthly_summary.yml").write_text("x: 2", encoding="utf-8")
    run = tmp_path / "runs" / "444"
    (run / "transcripts").mkdir(parents=True)
    (run / "task.json").write_text(json.dumps({"status": "done", "cost": {}}), encoding="utf-8")
    (run / "report.json").write_text(json.dumps(
        {"lint": {"validate": 0}, "workflow_file": str(proj / "main.yml")}), encoding="utf-8")
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    cp.cmd_record(cdir, "G01-congno.md", "444")
    r = cp.load_manifest(cdir)["prompts"][0]["results"][0]
    assert r["workflow_files"] == ["main.yml", "monthly_summary.yml"]
    assert r["extra_workflow_files_unlinted"] == ["monthly_summary.yml"]


# ── S5-2: ✗ classification (gate-deny vs ran-and-failed) ─────────────────────────────────────────

TRANSCRIPT = """## implement

### Tool calls
- Bash  grep -n "x" templates/tool-catalog.json  ✗
- Bash  .venv/bin/python tools/dify_base/marketplace.py resolve a/b  ✗
- Bash  .venv/bin/python tools/dify_base/find.py --list-features 2>&1 | head -60  ✗
- Bash  .venv/bin/python tools/dify_base/lint_refs.py projects/x/main.yml  ✗
- Bash  .venv/bin/python tools/dify_base/validate_workflow.py projects/x/main.yml  ✗
- Grep  docs  ✗
- Bash  ls projects/x  ✓
- Edit  /abs/projects/x/main.yml  ✓

### Result
done
"""


def test_classify_failed_calls_splits_denied_from_errored(tmp_path):
    run = tmp_path / "r"
    (run / "transcripts").mkdir(parents=True)
    (run / "transcripts" / "implement.md").write_text(TRANSCRIPT, encoding="utf-8")
    got = cp.classify_failed_calls(run, "implement")
    # denied: grep (deny-verb) + marketplace.py (not in allow-set) + find.py|head (metachar)
    # errored: lint_refs + validate_workflow (allowed scripts that ran and failed) + Grep tool
    assert got == {"denied": 3, "errored": 3}


def test_classify_missing_transcript_is_none(tmp_path):
    assert cp.classify_failed_calls(tmp_path, "implement") is None


# ── S5-5: runner error-path drill — retry, double-error STOP, resume (no real turns burned) ──────

RUNNER = Path(__file__).parent.parent / "apps" / "builder" / "scripts" / "campaign-run.sh"

STUB_E2E = """#!/usr/bin/env bash
# Stub e2e-run.sh for the drill: `fire` mints task ids T1, T2, … via a counter file; `wait` is a
# no-op (task.json fixtures are pre-seeded by the test); everything else fails loudly.
case "$1" in
  fire)
    n=$(cat "$STUB_DIR/counter" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$STUB_DIR/counter"
    echo "{\\"taskId\\":\\"T$n\\",\\"phase\\":\\"analyze\\",\\"status\\":\\"running\\"}" ;;
  wait) exit 0 ;;
  *) echo "stub: unexpected $1" >&2; exit 99 ;;
esac
"""


def _seed_task(runs: Path, tid: str, status: str) -> None:
    d = runs / tid
    (d / "transcripts").mkdir(parents=True, exist_ok=True)
    task = {"status": status, "cost": {}}
    if status == "error":
        task["error"] = "stub failure"
    (d / "task.json").write_text(json.dumps(task), encoding="utf-8")


def _drill_env(tmp_path: Path) -> dict:
    import os
    stub_dir = tmp_path / "stub"
    stub_dir.mkdir(exist_ok=True)
    stub = stub_dir / "e2e-stub.sh"
    stub.write_text(STUB_E2E, encoding="utf-8")
    stub.chmod(0o755)
    env = dict(os.environ)
    env["CAMPAIGN_E2E"] = str(stub)
    env["CAMPAIGN_RUNS_DIR"] = str(tmp_path / "runs")
    env["STUB_DIR"] = str(stub_dir)
    return env


def test_drill_double_error_stops_and_resume_completes(tmp_path):
    """The paths the acceptance campaign never exercised: error → flip-to-pending retry → second
    error → STOP with the rest left pending; then a plain re-run (resume) finishes the campaign."""
    import subprocess
    cdir = _mk_campaign(tmp_path, status="approved", version=cp.current_builder_version())
    (cdir / "G02-extra.md").write_text(CLEAN_PROMPT, encoding="utf-8")
    d = cp.load_manifest(cdir)
    d["prompts"].append({"file": "G02-extra.md", "axis": "x", "why": "x", "mode": "auto",
                         "status": "pending", "task_ids": []})
    cp.save_manifest(cdir, d)
    runs = tmp_path / "runs"
    _seed_task(runs, "T1", "error")   # G01 attempt 1 → error
    _seed_task(runs, "T2", "error")   # G01 attempt 2 (retry) → error → must STOP the run
    env = _drill_env(tmp_path)

    r1 = subprocess.run(["bash", str(RUNNER), str(cdir)], env=env, capture_output=True, text=True)
    assert r1.returncode == 1, r1.stdout + r1.stderr
    assert "DỪNG CẢ ĐỢT" in r1.stdout + r1.stderr
    d = cp.load_manifest(cdir)
    assert d["prompts"][0]["status"] == "error"
    assert d["prompts"][0]["task_ids"] == ["T1", "T2"]          # both attempts kept
    assert d["prompts"][1]["status"] == "pending"               # rest untouched — no quota burn

    # "resume = re-run the script": G02 completes; the double-errored G01 is NOT re-fired.
    _seed_task(runs, "T3", "done")
    r2 = subprocess.run(["bash", str(RUNNER), str(cdir)], env=env, capture_output=True, text=True)
    assert r2.returncode == 0, r2.stdout + r2.stderr
    d = cp.load_manifest(cdir)
    assert d["prompts"][1]["status"] == "done"
    assert d["prompts"][1]["task_ids"] == ["T3"]
    assert d["prompts"][0]["task_ids"] == ["T1", "T2"]          # error entry left alone


def test_drill_single_error_then_success_retries_in_place(tmp_path):
    import subprocess
    cdir = _mk_campaign(tmp_path, status="approved", version=cp.current_builder_version())
    runs = tmp_path / "runs"
    _seed_task(runs, "T1", "error")   # attempt 1 fails …
    _seed_task(runs, "T2", "done")    # … retry succeeds → campaign settles cleanly
    env = _drill_env(tmp_path)
    r = subprocess.run(["bash", str(RUNNER), str(cdir)], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["status"] == "done" and p["task_ids"] == ["T1", "T2"]


# Stub whose `fire` exits 4 (turn-lock 409) on the FIRST call, then succeeds — mirrors another build
# holding the lock. Guards the bug found live in round 5: `if ! fire_one; then RC=$?` left RC=0
# because the `!` negation consumed the exit status, so the busy-wait branch was dead code and a 409
# aborted the whole run ("exit 0"). The earlier drills only ever had fire exit 0, so they missed it.
STUB_E2E_BUSY_ONCE = """#!/usr/bin/env bash
case "$1" in
  fire)
    if [ ! -f "$STUB_DIR/hit" ]; then touch "$STUB_DIR/hit"; echo "turn lock BUSY — holder: X" >&2; exit 4; fi
    echo "{\\"taskId\\":\\"T1\\",\\"phase\\":\\"analyze\\",\\"status\\":\\"running\\"}" ;;
  wait) exit 0 ;;
  *) echo "stub: unexpected $1" >&2; exit 99 ;;
esac
"""


def test_drill_busy_lock_waits_then_retries_not_aborts(tmp_path):
    """A 409 (another build holds the lock) must WAIT and retry the same prompt, not stop the run."""
    import subprocess
    cdir = _mk_campaign(tmp_path, status="approved", version=cp.current_builder_version())
    runs = tmp_path / "runs"
    _seed_task(runs, "T1", "done")
    env = _drill_env(tmp_path)
    stub = Path(env["CAMPAIGN_E2E"])
    stub.write_text(STUB_E2E_BUSY_ONCE, encoding="utf-8")
    stub.chmod(0o755)
    env["CAMPAIGN_BUSY_WAIT"] = "0"   # don't actually sleep 120s in a test
    r = subprocess.run(["bash", str(RUNNER), str(cdir)], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr           # did NOT abort on the 409
    assert "turn busy" in r.stdout + r.stderr               # took the wait branch
    p = cp.load_manifest(cdir)["prompts"][0]
    assert p["status"] == "done" and p["task_ids"] == ["T1"]  # same prompt fired on retry


# ── S2: journey — the run as a user-facing per-phase narrative (spec 075 S2) ─────────────────────

def _mk_journey_run(runs: Path, tid: str) -> None:
    """A fuller run dir than _mk_run: analyze/criteria/diff/events so journey has all four phases."""
    d = runs / tid
    (d / "transcripts").mkdir(parents=True)
    (d / "task.json").write_text(json.dumps({
        "status": "done", "requirement": "毎日の売上をまとめて",
        "cost": {
            "analyze": {"model": "claude-haiku-4-5", "numTurns": 5},
            "spec": {"model": "claude-opus-4-8", "numTurns": 9},
            "implement": {"model": "claude-haiku-4-5", "numTurns": 20},
        },
    }), encoding="utf-8")
    (d / "analyze.json").write_text(json.dumps({"overview": "毎日の売上を集計する要約"}), encoding="utf-8")
    (d / "criteria.json").write_text(json.dumps({"criteria": ["合計を出す", "前日比を出す"]}), encoding="utf-8")
    (d / "diff.json").write_text(json.dumps({"diff": "--- (empty — new workflow)\n+++ new/x\n+app:\n+  name: y\n"}), encoding="utf-8")
    (d / "report.json").write_text(json.dumps({
        "notes": "The workflow file passed every automated check.",
        "lint": {"validate": 0}, "criteria_check": [{"text": "合計を出す", "status": "manual", "basis": "x"}],
    }), encoding="utf-8")
    for ph in ("analyze", "spec", "implement"):
        (d / "transcripts" / f"{ph}.md").write_text("### Tool calls\n- Bash  ls  ✓\n### Result\n", encoding="utf-8")
    (d / "events.jsonl").write_text("\n".join(json.dumps(e) for e in [
        {"ts": 1000, "kind": "phase_start", "phase": "analyze"},
        {"ts": 1100, "kind": "gate_reached", "phase": "analyze", "detail": "success"},
        {"ts": 1100, "kind": "phase_start", "phase": "spec"},
        {"ts": 1250, "kind": "gate_reached", "phase": "spec", "detail": "success"},
        {"ts": 1250, "kind": "phase_start", "phase": "implement"},
        {"ts": 1600, "kind": "gate_reached", "phase": "implement", "detail": "success"},
    ]) + "\n", encoding="utf-8")


def test_journey_emits_per_phase_narrative(tmp_path, monkeypatch, capsys):
    runs = tmp_path / "runs"
    _mk_journey_run(runs, "J1")
    monkeypatch.setattr(cp, "RUNS_DIR", runs)
    assert cp.cmd_journey("J1") == 0
    j = json.loads(capsys.readouterr().out)
    assert j["status"] == "done"
    assert j["total_ms"] == 600                                  # 1600 - 1000
    a = j["phases"]["analyze"]
    assert a["model"] == "claude-haiku-4-5" and a["working_ms"] == 100
    assert a["user_read"] == "毎日の売上を集計する要約"           # the digest the user reads at ①
    assert j["phases"]["spec"]["acceptance_criteria"] == ["合計を出す", "前日比を出す"]
    assert j["phases"]["implement"]["change"] == "workflow mới"  # diff = new workflow
    assert j["phases"]["test"]["user_read"].startswith("The workflow")
    assert len(j["phases"]["test"]["criteria_check"]) == 1


def test_journey_missing_task_exits(tmp_path, monkeypatch):
    monkeypatch.setattr(cp, "RUNS_DIR", tmp_path / "runs")
    try:
        cp.cmd_journey("NOPE")
        raise AssertionError("journey trên task không tồn tại phải chết")
    except SystemExit:
        pass


def test_journey_edit_existing_shows_line_delta(tmp_path, monkeypatch, capsys):
    runs = tmp_path / "runs"
    _mk_journey_run(runs, "J2")
    # overwrite diff to an EDIT (not a new workflow)
    (runs / "J2" / "diff.json").write_text(
        json.dumps({"diff": "--- old\n+++ new\n@@ -1,2 +1,3 @@\n context\n+added line\n-removed line\n"}),
        encoding="utf-8")
    monkeypatch.setattr(cp, "RUNS_DIR", runs)
    cp.cmd_journey("J2")
    j = json.loads(capsys.readouterr().out)
    assert j["phases"]["implement"]["change"] == "+1/-1 dòng"    # edit, not "workflow mới"


# ---------------------------------------------------------------------------
# summary — spec 086 S2: ONE mechanical Pass line, pure function of the manifest
# ---------------------------------------------------------------------------

CLEAN_LINT = {"validate": 0, "lint_refs": 0, "lint_plugin_hashes": 0, "lint_node_bodies": 0}


def _mk_summary_campaign(tmp_path: Path, results_by_file: dict) -> Path:
    cdir = tmp_path / "c"
    cdir.mkdir(parents=True, exist_ok=True)
    prompts = []
    for fname, results in results_by_file.items():
        (cdir / fname).write_text("x", encoding="utf-8")
        prompts.append({"file": fname, "status": "done", "task_ids": ["t"], "results": results})
    (cdir / "campaign.yml").write_text(yaml.safe_dump({
        "id": "sum-test", "status": "approved", "builder_version": "0.0.0", "prompts": prompts,
    }), encoding="utf-8")
    return cdir


def test_summary_all_pass(tmp_path, capsys):
    cdir = _mk_summary_campaign(tmp_path, {
        "G01.md": [{"task_status": "done", "lint": dict(CLEAN_LINT), "probe": "ok",
                    "accepted_lint_failure": False}],
    })
    assert cp.cmd_summary(cdir, as_json=True) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["pass"] == 1 and out["total"] == 1
    assert out["line"].startswith("Pass 1/1")


def test_summary_fail_categories_map_to_taxonomy(tmp_path, capsys):
    # validate→format, lint_refs→graph, node_bodies/plugin_hashes→semantic, probe failed→import,
    # error run→build-error. Last-attempt rule: only results[-1] counts.
    cdir = _mk_summary_campaign(tmp_path, {
        "G01.md": [{"task_status": "done", "lint": {**CLEAN_LINT, "validate": 2}, "probe": None}],
        "G02.md": [{"task_status": "done", "lint": {**CLEAN_LINT, "lint_refs": 1}, "probe": None}],
        "G03.md": [{"task_status": "done", "lint": {**CLEAN_LINT, "lint_node_bodies": 1},
                    "probe": "failed"}],
        "G04.md": [{"task_status": "error", "error": "boom"}],
        "G05.md": [{"task_status": "error"},  # first attempt failed…
                   {"task_status": "done", "lint": dict(CLEAN_LINT), "probe": "ok"}],  # …retry passed
    })
    assert cp.cmd_summary(cdir, as_json=True) == 0
    out = json.loads(capsys.readouterr().out)
    by_file = {r["file"]: r for r in out["rows"]}
    assert by_file["G01.md"]["categories"] == ["format"]
    assert by_file["G02.md"]["categories"] == ["graph"]
    assert by_file["G03.md"]["categories"] == ["semantic", "import"]
    assert by_file["G04.md"]["categories"] == ["build-error"]
    assert by_file["G05.md"]["passed"] is True          # last attempt wins (086 Open Q1)
    assert out["pass"] == 1 and out["total"] == 5


def test_summary_accept_override_counts_as_fail(tmp_path, capsys):
    cdir = _mk_summary_campaign(tmp_path, {
        "G01.md": [{"task_status": "done", "lint": {**CLEAN_LINT, "validate": 3}, "probe": None,
                    "accepted_lint_failure": True}],
    })
    assert cp.cmd_summary(cdir, as_json=True) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["pass"] == 0
    assert "accepted-override 1" in out["line"]


def test_summary_never_crashes_on_partial_manifest(tmp_path, capsys):
    # pre-086 manifest: no probe/accepted keys, a done run missing lint, and a never-run prompt.
    cdir = _mk_summary_campaign(tmp_path, {
        "G01.md": [{"task_status": "done", "lint": dict(CLEAN_LINT)}],   # no probe → n/a, still PASS
        "G02.md": [{"task_status": "done"}],                             # done but no lint → build-error
        "G03.md": [],                                                    # not run
    })
    assert cp.cmd_summary(cdir, as_json=True) == 0
    out = json.loads(capsys.readouterr().out)
    by_file = {r["file"]: r for r in out["rows"]}
    assert by_file["G01.md"]["passed"] is True and by_file["G01.md"]["probe"] is None
    assert by_file["G02.md"]["categories"] == ["build-error"]
    assert by_file["G03.md"]["categories"] == ["not-run"]

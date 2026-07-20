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

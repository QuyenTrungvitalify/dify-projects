"""Spec 050 — proven-build → pattern promotion: the D3 gate, the D2a candidate channel, the
distilled worked example (AC 1/3/5), and the D5 version-staleness axis.

The gate is the immune system: promotion is the moment a mistake becomes contagious, so a broken
source (failing lint, import-rejected) must be BLOCKED before it can teach the break. (An empty LLM
model is only a WARNING — spec 054: under B5 it is auto-filled at deploy, not a "never ran" signal.)
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "dify_base"))
import promote_gate as pg  # noqa: E402
import check_provenance as cp  # noqa: E402
import provenance  # noqa: E402
from build_index import analyze  # noqa: E402

BASE = Path(__file__).parent.parent
FIXTURE = BASE / "tests" / "fixtures" / "promote" / "per_row_notify.yml"
PATTERN = BASE / "templates" / "patterns" / "per-row-notify.yml"


def fake_run_factory(calls, responses):
    """Injectable runner: records argv, answers by matching the sync.py subcommand (push/list/
    delete) or the linter script basename; default = clean exit."""
    def run(args, cwd=None):
        calls.append(args)
        for key, resp in responses.items():
            if any(key in a for a in args):
                return resp
        return (0, "", "")
    return run


# ── D3 gate ──────────────────────────────────────────────────────────────────────────────────────

def test_gate_green_end_to_end_with_probe(monkeypatch):
    """Clean source + probe completed → eligible, probe app deleted, known_good_dify stamped."""
    monkeypatch.setenv("DIFY_CONSOLE_URL", "http://localhost/console/api")
    monkeypatch.setenv("DIFY_CONSOLE_TOKEN", "tok-test")
    calls = []
    run = fake_run_factory(calls, {"push": (0, '{"status": "completed", "app_id": "app-1"}', "")})
    verdict = pg.gate(FIXTURE, distilled=PATTERN, run=run)
    assert verdict["eligible"], verdict
    assert verdict["probe"] == "ok"
    assert verdict["known_good_dify"] == (BASE / ".dify-tag").read_text().strip()
    deletes = [c for c in calls if "delete" in c]
    assert deletes and "app-1" in deletes[0], "probe app deleted immediately"


def test_empty_model_is_advisory_not_blocking(tmp_path, monkeypatch):
    """Spec 054: an empty LLM model (provider''/name'') is a WARNING, not a block. Under the Builder's B5
    convention the model is auto-filled at deploy/live-test, so an empty model is the NORMAL state of a
    valid build — blocking on it would false-negative every from-scratch LLM build."""
    monkeypatch.delenv("DIFY_CONSOLE_URL", raising=False)
    monkeypatch.delenv("DIFY_CONSOLE_TOKEN", raising=False)
    wf = yaml.safe_load(FIXTURE.read_text())
    for n in wf["workflow"]["graph"]["nodes"]:
        if n.get("data", {}).get("type") == "llm":
            n["data"]["model"]["provider"] = ""
            n["data"]["model"]["name"] = ""
    p = tmp_path / "unwired.yml"
    p.write_text(yaml.safe_dump(wf), encoding="utf-8")
    # check_model_wiring still REPORTS the empty model (it feeds the advisory) ...
    assert "empty model" in pg.check_model_wiring(p)[0]
    assert pg.check_model_wiring(FIXTURE) == []  # a WIRED source produces no warning
    # ... but gate() no longer BLOCKS on it — eligible, with the empty model surfaced as a warning.
    verdict = pg.gate(p, run=fake_run_factory([], {}))
    assert verdict["eligible"], verdict
    assert verdict["warnings"] and "empty model" in verdict["warnings"][0]


def test_gate_blocks_probe_failure_and_sweeps_orphan(monkeypatch):
    """AC 4 red: import-probe FAILED → blocked + verbatim detail + orphan swept by probe name
    (Dify commits the app row BEFORE validating — 049 r3, verified live)."""
    monkeypatch.setenv("DIFY_CONSOLE_URL", "http://localhost/console/api")
    monkeypatch.setenv("DIFY_CONSOLE_TOKEN", "tok-test")
    calls = []
    run = fake_run_factory(calls, {
        "push": (1, "", 'import_app failed: HTTP 400 — {"error":"missing name"}'),
        "list": (0, "  abcd-1234   workflow       [promote-gate] per_row_notify", ""),
    })
    verdict = pg.gate(FIXTURE, run=run)
    assert not verdict["eligible"]
    assert any("missing name" in r for r in verdict["reasons"]), verdict["reasons"]
    deletes = [c for c in calls if "delete" in c]
    assert deletes and "abcd-1234" in deletes[0], "the committed-before-validation orphan is swept"


def test_gate_pending_is_inconclusive_not_failed(monkeypatch):
    monkeypatch.setenv("DIFY_CONSOLE_URL", "http://localhost/console/api")
    monkeypatch.setenv("DIFY_CONSOLE_TOKEN", "tok-test")
    run = fake_run_factory([], {"push": (0, '{"status": "pending", "app_id": null}', "")})
    verdict = pg.gate(FIXTURE, run=run)
    assert verdict["probe"] == "skipped"
    assert verdict["eligible"], "a version park never blocks (inconclusive, not a rejection)"


def test_gate_no_creds_degrades_to_lint_only(monkeypatch):
    """AC 4: no creds → probe skipped, promotion NOT blocked (037/049 degrade precedent)."""
    monkeypatch.delenv("DIFY_CONSOLE_URL", raising=False)
    monkeypatch.delenv("DIFY_CONSOLE_TOKEN", raising=False)
    calls = []
    verdict = pg.gate(FIXTURE, run=fake_run_factory(calls, {}))
    assert verdict["probe"] == "skipped"
    assert "no Dify creds" in verdict["probe_detail"]
    assert verdict["eligible"]
    assert not any("sync.py" in " ".join(c) and "push" in c for c in calls), "no push attempted"


def test_gate_real_linters_pass_on_fixture_and_pattern():
    """AC 1/2 integration: the committed fixture AND the distilled pattern lint clean for real."""
    verdict = pg.gate(FIXTURE, distilled=PATTERN, skip_probe=True)
    assert verdict["eligible"], verdict["reasons"]


# ── D2a candidate channel ────────────────────────────────────────────────────────────────────────

def test_candidate_dedup_on_rule_statement(tmp_path):
    """AC 2: the note is produced with its citation; the same rule twice merges (match key)."""
    log = tmp_path / "linter-candidates.md"
    rule = "environment_variables entries must use 'name:' — Dify import 400s 'missing name'"
    assert pg.add_candidate(rule, "api/factories/variable_factory.py", log_path=log) is True
    assert pg.add_candidate(rule, "api/factories/variable_factory.py", log_path=log) is False
    body = log.read_text()
    assert body.count(rule) == 1 and "variable_factory.py" in body


def test_seeded_candidates_log_carries_the_049_witness():
    body = (BASE / "docs" / "linter-candidates.md").read_text()
    assert "missing name" in body and "variable_factory.py" in body


# ── AC 1/3: the distilled pattern is generic + self-documenting ──────────────────────────────────

def test_pattern_is_domain_generic_and_self_documenting():
    body = PATTERN.read_text(encoding="utf-8")
    assert "api.chatwork.com" not in body, "instance stripped (AC 1)"
    assert "X-ChatWorkToken" not in body, "instance stripped (AC 1)"
    for section in ("# Pattern:", "# Use case:", "# Flow:", "# Customization points"):
        assert section in body, f"header convention: {section}"
    assert body.count("# GOTCHA:") >= 3, "D2b: today-injection + custom-header + non-idempotence"
    assert "today" in body and "no-auth" in body
    assert "# TODO:" in body


def test_fixture_carries_all_five_node_types_and_the_wired_model():
    """AC 1 pin: the fixture must exercise iteration+http+if-else+code+llm AND a present model."""
    wf = yaml.safe_load(FIXTURE.read_text())
    types = {n["data"]["type"] for n in wf["workflow"]["graph"]["nodes"] if isinstance(n, dict)}
    assert {"iteration", "http-request", "if-else", "code", "llm"} <= types
    llm = next(n for n in wf["workflow"]["graph"]["nodes"] if n["data"]["type"] == "llm")
    assert llm["data"]["model"]["provider"] and llm["data"]["model"]["name"]


# ── AC 5: retrievability ─────────────────────────────────────────────────────────────────────────

def test_pattern_index_features_and_frontloaded_description():
    info = analyze(PATTERN)
    for key in ("has_iteration", "has_http_request", "has_if_else", "has_code", "has_llm"):
        assert info.get(key), f"{key} must auto-derive (AC 5)"
    desc = info["description"]
    assert "per-row" in desc.lower() and "notify" in desc.lower().replace("notification", "notify")
    # the [:50] table cut and the [:100] search cut both keep the problem-shape keywords:
    assert "per-row" in desc[:50].lower()


# ── AC 6: D5 version-staleness axis ─────────────────────────────────────────────────────────────

def test_known_good_dify_behind_pin_flags_stale():
    fields = provenance.parse_header(PATTERN)
    assert fields.get("known_good_dify"), "the promotion stamps the probed Dify version"
    cur = (BASE / ".dify-tag").read_text().strip()
    status, detail = cp.classify(fields, {}, dify_tag=cur)
    assert status == "current", detail
    status2, detail2 = cp.classify(fields, {}, dify_tag="9.99.0")
    assert status2 == "stale" and "re-probe" in detail2
    # back-compat: no tag passed → the axis is off (022 callers unchanged)
    assert cp.classify(fields, {})[0] == "current"


def test_original_source_promotion_has_no_license_noise():
    fields = provenance.parse_header(PATTERN)
    assert cp.license_problems(fields, {}) == []


# ── Spec 081 — share-scan (advisory leak scan at publish time) ──────────────────────────────────

def test_share_scan_flags_credential_shapes():
    text = "\n".join([
        "url: https://example.com/hook",
        "headers: 'Authorization: Bearer abcdef0123456789abcdef'",
        "api_key: sk-proj-abcdefghijklmnopqrstuv",
        "aws: AKIAIOSFODNN7EXAMPLE",
    ])
    kinds = {f["kind"] for f in pg.share_scan_text(text)}
    assert "bearer token" in kinds and "provider key" in kinds
    lines = {f["line"] for f in pg.share_scan_text(text)}
    assert 1 not in lines, "example.com is an allowed placeholder host"


def test_share_scan_flags_urls_emails_and_internal_hosts():
    text = "\n".join([
        "url: https://api.mycompany.co.jp/v1/notify",
        "contact: alice@vitalify.jp",
        "host: gitlab.corp",
        "ip: 192.168.10.20",
    ])
    kinds = [f["kind"] for f in pg.share_scan_text(text)]
    assert kinds.count("non-placeholder url") == 1
    assert "email address" in kinds and "internal host/ip" in kinds


def test_share_scan_placeholder_context_is_exempt_but_credentials_are_not():
    text = "\n".join([
        "url: https://your-service.example.com/webhook  # TODO: set your endpoint",
        "url: '{{#env.SERVICE_URL#}}/notify'",
        "token: '{{#env.API_TOKEN#}}'",
        "secret: changeme-placeholder",
        "# TODO: rotate — old key was Bearer abcdef0123456789abcdef",
    ])
    findings = pg.share_scan_text(text)
    assert [f["kind"] for f in findings] == ["bearer token"], findings
    assert findings[0]["line"] == 5, "a real credential is reported even in TODO context"


def test_share_scan_clean_on_the_committed_pattern_and_cli_exit_zero(capsys):
    """The committed distilled pattern must scan clean, and the CLI is advisory (exit 0) even
    when findings exist — the contributor decides at the confirm gate, never this tool."""
    result = pg.share_scan(PATTERN)
    assert result["clean"], result["findings"]
    assert pg.main(["share-scan", str(PATTERN)]) == 0
    assert "clean" in capsys.readouterr().out
    dirty = BASE / "tests" / "fixtures" / "promote" / "per_row_notify.yml"
    assert pg.main(["share-scan", str(dirty), "--json"]) == 0, "findings never change the exit code"


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))

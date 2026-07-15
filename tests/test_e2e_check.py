"""Tests for apps/builder/scripts/e2e_check.py — the e2e harness predicate evaluator (spec 058).

The three-bucket contract (r3) is the thing under test: every predicate lands in exactly one of
AUTO-PASS / AUTO-FAIL / MANUAL, an unknown key degrades to MANUAL (never crashes), a missing
artifact is AUTO-FAIL, and the exit-equivalent (`auto_ok`) is true iff zero AUTO-FAIL. This keeps
the runner's promise — "auto-test as much as possible, report the rest" — enforceable on any clone,
since `.runs/` and `projects/_drafts/` are gitignored (AC5: sanitized fixtures instead).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path

FIX = Path(__file__).parent / "fixtures" / "e2e"
SCRIPT = Path(__file__).parent.parent / "apps" / "builder" / "scripts" / "e2e_check.py"


def _load():
    spec = importlib.util.spec_from_file_location("e2e_check", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(mod)
    return mod


ec = _load()


def _buckets(rows):
    out = {"AUTO-PASS": [], "AUTO-FAIL": [], "MANUAL": []}
    for r in rows:
        out[r["bucket"]].append(r["check"])
    return out


def _artifacts(*, analyze=None, workflow=None, report=None):
    return {"analyze": analyze, "workflow": workflow, "report": report}


# ── the happy path: a trigger entry passes every mechanical check ─────────────

def test_trigger_entry_all_auto_pass():
    entry = {
        "id": "t",
        "expect": {
            "analyze": {"features_include": ["trigger"], "pattern": "scheduled-fetch-notify"},
            "workflow": {"grep_present": ["type: trigger-schedule", "timezone: Asia/Tokyo"],
                         "grep_absent": ["type: start"]},
            "report": {"notes_include": ["all linters passed"]},
        },
        "manual": ["enable the trigger by hand"],
    }
    rows = ec.evaluate_entry(entry, _artifacts(
        analyze=FIX / "analyze.json", workflow=FIX / "main-trigger.yml", report=FIX / "report.json"))
    b = _buckets(rows)
    assert not b["AUTO-FAIL"], b
    assert b["AUTO-PASS"], "expected mechanical passes"
    assert any("manual" == r["check"] for r in rows), "manual item must be echoed as MANUAL"


def test_negative_no_trigger_passes_on_start_fixture():
    entry = {
        "id": "n",
        "expect": {
            "analyze": {"features_exclude": ["trigger"]},
            "workflow": {"grep_present": ["type: start"], "grep_absent": ["type: trigger-schedule"]},
        },
    }
    # analyze fixture DOES include trigger, so features_exclude[trigger] must AUTO-FAIL here —
    # proving the predicate actually discriminates (a fixture with no trigger is the start one).
    rows = ec.evaluate_entry(entry, _artifacts(
        analyze=FIX / "analyze.json", workflow=FIX / "main-start.yml"))
    b = _buckets(rows)
    # workflow checks pass on the start fixture; the analyze exclude fails on the trigger fixture.
    assert any("features_exclude" in c for c in b["AUTO-FAIL"]), b
    assert any("workflow.grep_present" in c for c in b["AUTO-PASS"]), b


# ── the contract edges ────────────────────────────────────────────────────────

def test_unknown_section_degrades_to_manual():
    entry = {"id": "u", "expect": {"runtime": {"latency_under_ms": 500}}}
    rows = ec.evaluate_entry(entry, _artifacts())
    b = _buckets(rows)
    assert b["MANUAL"] and not b["AUTO-FAIL"] and not b["AUTO-PASS"], b


def test_unknown_predicate_key_degrades_to_manual():
    entry = {"id": "u2", "expect": {"analyze": {"features_include": ["llm"], "vibes": ["good"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(analyze=FIX / "analyze.json"))
    checks = _buckets(rows)
    assert any("vibes" in c for c in checks["MANUAL"]), checks
    # the known key next to it still evaluates mechanically
    assert any("features_include" in c for c in (checks["AUTO-PASS"] + checks["AUTO-FAIL"]))


def test_missing_artifact_is_auto_fail():
    entry = {"id": "m", "expect": {"report": {"notes_include": ["anything"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(report=FIX / "does-not-exist.json"))
    b = _buckets(rows)
    assert b["AUTO-FAIL"] and "missing" in rows[0]["detail"].lower(), rows


def test_features_include_missing_feature_auto_fails():
    entry = {"id": "f", "expect": {"analyze": {"features_include": ["question-classifier"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(analyze=FIX / "analyze.json"))
    assert _buckets(rows)["AUTO-FAIL"], "a feature not in the list must auto-fail"


def test_grep_absent_catches_present_needle():
    entry = {"id": "g", "expect": {"workflow": {"grep_absent": ["type: trigger-schedule"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(workflow=FIX / "main-trigger.yml"))
    assert _buckets(rows)["AUTO-FAIL"], "grep_absent on a present needle must auto-fail"


def test_report_notes_is_substring_not_membership():
    # report.json.notes is ONE string (058 r2) — a substring hit passes.
    entry = {"id": "r", "expect": {"report": {"notes_include": ["ENABLE the trigger"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(report=FIX / "report.json"))
    assert not _buckets(rows)["AUTO-FAIL"], rows


# ── the real suite file loads and every entry is well-formed ──────────────────

# ── timing (compute_timing) ───────────────────────────────────────────────────

def _touch(path: Path, mtime: float):
    path.write_text("x", encoding="utf-8")
    import os
    os.utime(path, (mtime, mtime))


def test_timing_full_run_per_phase_deltas(tmp_path):
    # taskid = fire time in ms; artifacts stamped at +30 / +120 / +300 / +330 s.
    t0_ms = 1_700_000_000_000
    t0 = t0_ms / 1000
    paths = {}
    for key, dt in [("analyze", 30), ("spec", 120), ("implement", 300), ("report", 330)]:
        p = tmp_path / f"{key}.f"
        _touch(p, t0 + dt)
        paths[key] = str(p)
    t = ec.compute_timing(str(t0_ms), paths)
    assert t["complete"] is True
    assert t["total_s"] == 330.0
    deltas = {r["phase"]: r["delta_s"] for r in t["phases"]}
    assert deltas == {"analyze": 30.0, "spec": 90.0, "implement": 180.0, "test": 30.0}


def test_timing_incomplete_run_marks_missing_and_stops_total(tmp_path):
    # analyze + spec present, implement/report missing (errored run) → incomplete, total up to spec.
    t0_ms = 1_700_000_000_000
    t0 = t0_ms / 1000
    a = tmp_path / "a"; _touch(a, t0 + 40)
    s = tmp_path / "s"; _touch(s, t0 + 100)
    t = ec.compute_timing(str(t0_ms), {"analyze": str(a), "spec": str(s), "implement": None, "report": None})
    assert t["complete"] is False
    assert t["total_s"] == 100.0
    incomplete = [r["phase"] for r in t["phases"] if not r["ok"]]
    assert incomplete == ["implement", "test"]


def test_timing_bad_taskid_errors_cleanly():
    t = ec.compute_timing("not-a-number", {"analyze": None})
    assert t.get("error") and t["total_s"] is None


def test_timing_fast_merges_analyze_and_spec(tmp_path):
    # ⚡ fast: one merged draft turn writes analyze.json + SPEC.md; timing must NOT split them into
    # an inflated 'analyze' + a ~0s 'spec'. It reports ONE draft(analyze+spec) row.
    t0_ms = 1_700_000_000_000
    t0 = t0_ms / 1000
    a = tmp_path / "analyze.json"; _touch(a, t0 + 40)   # written first, within the merged turn
    s = tmp_path / "SPEC.md"; _touch(s, t0 + 41)         # 1s later, same turn
    w = tmp_path / "main.yml"; _touch(w, t0 + 200)
    r = tmp_path / "report.json"; _touch(r, t0 + 230)
    t = ec.compute_timing(str(t0_ms), {"analyze": str(a), "spec": str(s), "implement": str(w), "report": str(r)}, fast=True)
    phases = [p["phase"] for p in t["phases"]]
    assert phases == ["draft(analyze+spec)", "implement", "test"], phases
    draft = t["phases"][0]
    assert draft["cum_s"] == 41.0  # to the LATER of the two mtimes, not split
    assert t["total_s"] == 230.0


# ── guards from the adversarial review (never crash / never false-pass) ────────

def test_non_object_artifact_is_auto_fail_not_crash(tmp_path):
    # analyze.json is valid JSON but a top-level ARRAY → must degrade to AUTO-FAIL, not AttributeError.
    bad = tmp_path / "analyze.json"
    bad.write_text('["trigger"]', encoding="utf-8")
    entry = {"id": "x", "expect": {"analyze": {"features_include": ["trigger"]}}}
    rows = ec.evaluate_entry(entry, _artifacts(analyze=bad))
    b = _buckets(rows)
    assert b["AUTO-FAIL"] and not b["AUTO-PASS"], rows
    assert "object" in rows[0]["detail"].lower()


def test_scalar_grep_predicate_does_not_false_pass(tmp_path):
    # grep_present written as a bare string (missing YAML list brackets) must NOT iterate chars into
    # a false AUTO-PASS — it degrades to AUTO-FAIL. This is the contract's 'never silent pass'.
    entry = {"id": "y", "expect": {"workflow": {"grep_present": "type: start"}}}
    rows = ec.evaluate_entry(entry, _artifacts(workflow=FIX / "main-trigger.yml"))
    b = _buckets(rows)
    assert b["AUTO-FAIL"] and not b["AUTO-PASS"], rows
    assert "list" in rows[0]["detail"].lower()


def test_empty_list_predicate_does_not_crash():
    # features_include: (None, i.e. empty YAML value) must not raise TypeError.
    entry = {"id": "z", "expect": {"analyze": {"features_include": None}}}
    rows = ec.evaluate_entry(entry, _artifacts(analyze=FIX / "analyze.json"))
    assert _buckets(rows)["AUTO-FAIL"], rows


def test_shipped_suite_parses_and_emits_fire():
    import subprocess
    suite = SCRIPT.parent / "e2e-suite.yml"
    ids = subprocess.run(
        ["python3", str(SCRIPT), "--suite", str(suite), "--list"],
        capture_output=True, text=True, check=True).stdout.split()
    assert "trigger-schedule" in ids and "negative-no-trigger" in ids, ids
    fire = subprocess.run(
        ["python3", str(SCRIPT), "--suite", str(suite), "--entry", "trigger-schedule", "--emit-fire"],
        capture_output=True, text=True, check=True).stdout
    assert "jsonplaceholder" in fire and "auto" in fire, fire


# ── spec 059: the per-phase cost table (render_cost) ─────────────────────────

def test_render_cost_table_and_cache_pct():
    cost = {
        "implement": {"numTurns": 12, "inputTokens": 10000, "outputTokens": 8000,
                      "cacheReadTokens": 30000},
        "analyze": {"numTurns": 2, "inputTokens": 5000, "outputTokens": 400, "cacheReadTokens": 0},
    }
    out = ec.render_cost(cost)
    assert "per-phase tokens" in out
    # cache% = cacheRead / (cacheRead + input): 30000/40000 = 75%, and 0/5000 = 0%.
    assert "75%" in out, out
    assert "0%" in out, out
    # a phase with no recorded entry is simply omitted, not zero-filled.
    assert "\n  test " not in out and "\n  spec " not in out


def test_render_cost_missing_cells_and_empty_map():
    # a turn that died before a result → duration/turns only; token cells show em-dash, cache% —.
    out = ec.render_cost({"implement": {"numTurns": 1}})
    assert "—" in out and "per-phase tokens" in out
    # a pre-059 run (no .cost) → the explanatory empty-map line, never a crash.
    assert "no per-phase cost recorded" in ec.render_cost({})


def test_timing_json_includes_cost_when_task_json_passed(tmp_path):
    import json as _json
    import subprocess
    tj = tmp_path / "task.json"
    tj.write_text(_json.dumps({"cost": {"implement": {"numTurns": 7, "outputTokens": 123}}}))
    # A numeric taskid so compute_timing yields a total_s (no artifacts → incomplete, still valid).
    out = subprocess.run(
        ["python3", str(SCRIPT), "--timing", "--taskid", "1700000000000",
         "--task-json", str(tj), "--json"],
        capture_output=True, text=True, check=True).stdout
    data = _json.loads(out)
    assert data["cost"]["implement"]["numTurns"] == 7, data

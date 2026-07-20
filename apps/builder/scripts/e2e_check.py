#!/usr/bin/env python3
"""e2e_check.py — structural predicate evaluator for the e2e simulation harness (spec 058).

Three-bucket contract (spec 058 r3 — "auto-test as much as possible, report the rest"):
  AUTO-PASS  — predicate evaluated mechanically and held
  AUTO-FAIL  — predicate evaluated mechanically and failed (a MISSING artifact is AUTO-FAIL:
               the build demonstrably didn't produce what the expectation requires)
  MANUAL     — cannot be auto-tested: the entry's `manual:` items, plus any predicate key the
               vocabulary doesn't know yet (the suite may grow ahead of the runner — degrade,
               never crash). MANUAL never affects the exit code but is ALWAYS printed.

Exit codes: 0 = zero AUTO-FAIL · 1 = at least one AUTO-FAIL · 2 = usage / suite error.

Usage:
  e2e_check.py --suite e2e-suite.yml --entry trigger-schedule \
      [--analyze p] [--workflow p] [--report p] [--json]
  e2e_check.py --suite e2e-suite.yml --list            # print entry ids
  e2e_check.py --suite e2e-suite.yml --entry X --emit-fire   # {prompt,mode,fast,deploy,project}
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

# Vocabulary (spec 058 S2) — kept intentionally tiny; unknown keys degrade to MANUAL.
KNOWN_PREDICATES: dict[str, set[str]] = {
    "analyze": {"features_include", "features_exclude", "pattern"},
    "workflow": {"grep_present", "grep_absent"},
    "report": {"notes_include"},
}
ARTIFACT_KINDS = ("analyze", "workflow", "report")
SETTLED_BUCKETS = ("AUTO-PASS", "AUTO-FAIL", "MANUAL")


def _row(bucket: str, check: str, detail: str) -> dict:
    return {"bucket": bucket, "check": check, "detail": detail}


# ── spec 063: comprehension — the DETERMINISTIC half (objective, regression-safe) ─────────────────
# Technical tokens a non-technical user won't understand, checked against the user-facing text (the
# digest + the notes as the user reads them). A hit → AUTO-FAIL. This is the objective core: a fixed
# list, reproducible run-to-run, no LLM. It catches the untranslated-jargon defect (spec 061) that a
# substring `notes_include` grep never flags as unclear. Both English (escaped localization) and the
# JA katakana equivalents a layperson still won't get are listed. Extend deliberately.
JARGON_BLOCKLIST: tuple[str, ...] = (
    # English technical terms that reach the user when localization doesn't cover them
    "plugin hash", "dependencies", "provider_id", "provider_name", "provider_type",
    "tool_name", "tool_configurations", "# TODO", "deploy=none", "unresolved_plugin_todo",
    "value_selector", "node id",
    # ── spec 066 S1 — the FRAME vocabulary spec 064 left behind ──────────────────────────────────
    # 064 made every blocker DETAIL plain and this oracle scored the result PASS — while the note
    # still read "all linters passed preflight: … Advisory … import-probe: OK — Dify accepted this
    # DSL (probe app deleted)". The oracle was blind, not the note clean. Each token below is bound
    # to the slice that retires it (066 S5 frames · S4 probe tail); do NOT add a token here without
    # the slice that removes it, or the FAIL→PASS proof can never close.
    # ("linter" AND "linters": _jargon_hit is word-boundary, so the singular never matches the plural.)
    "linter", "linters", "preflight", "import-probe", "probe app", "advisory",
    # NOT "dsl": `cloudStudioNote` (report.ts:126) tells a deploy=cloud user to click Dify Studio's
    # literal button — '① Studio → Create app → "Import DSL" → …'. That is an AFFORDANCE the user must
    # find on screen, not jargon; blocklisting it AUTO-FAILed every cloud run forever. A name the user
    # must read off a button is exempt by definition — the point is what THEY can act on.
    # JA katakana jargon. NOTE: the offline check currently scans the ENGLISH report.notes (the JA
    # localize happens browser-side, Chat.tsx). So these tokens only fire once the NOTE_JA port lands
    # (the deferred slice); on a real run today the ENGLISH tokens above are the load-bearing ones.
    "プラグインハッシュ", "リンター", "プリフライト", "アドバイザリ",
)
# Leaked template/id jargon (regex): a raw variable ref or a bare node id the user should never see.
JARGON_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"\{\{#[^}]+#\}\}", "raw {{#…#}} variable ref"),
    (r"\b\d{13}\b", "bare 13-digit node id"),
)


def _jargon_hit(token: str, text: str, low: str) -> bool:
    """Word-boundary for plain-word tokens (so 'dependencies' can't fire inside normal prose); raw
    substring for symbol/non-ASCII tokens (deploy=none, # TODO, katakana) that can't hide in words."""
    if token.isascii() and all(c.isalnum() or c.isspace() for c in token):
        return re.search(r"\b" + re.escape(token.lower()) + r"\b", low) is not None
    return token.lower() in low


def build_userview(digest: str, notes: str) -> str:
    """Spec 063 S1 (pragmatic) — the USER-facing text block from a run's digest + notes, hiding the
    dev view. A reconstruction proxy, NOT the literal Chat.tsx render (full NOTE_JA localization port
    + component contract test are a follow-up slice, AC1). Excludes features/planned_nodes/YAML/lint."""
    d = str(digest or "").strip()
    n = str(notes or "").strip()
    if not d and not n:
        return ""
    return f"— digest —\n{d}\n\n— notes (as the user reads them) —\n{n}".strip()


def evaluate_comprehension(userview_text: str) -> list[dict]:
    """Deterministic jargon check over the user-facing text. AUTO-FAIL per blocklist hit; AUTO-PASS
    when clean; **MANUAL when there is NO user-facing text** (a parked/incomplete/corrupt run — never
    a false AUTO-PASS, matching the harness's missing-artifact contract). Reproducible — no LLM. (The
    open-ended `next_step_clear` LLM proxy is the skill's job, kept OUT of this exit path per S3.)"""
    text = str(userview_text or "").strip()
    if not text:
        return [_row("MANUAL", "comprehension",
                     "no user-facing text captured — run parked/incomplete; nothing to judge")]
    low = text.lower()
    rows = [_row("AUTO-FAIL", f"comprehension.jargon[{t}]",
                 "a non-technical user won't understand this term in the chat")
            for t in JARGON_BLOCKLIST if _jargon_hit(t, text, low)]
    rows += [_row("AUTO-FAIL", f"comprehension.jargon[{desc}]",
                  "a leaked technical reference the user should never see")
             for pat, desc in JARGON_PATTERNS if re.search(pat, text)]
    return rows or [_row("AUTO-PASS", "comprehension.jargon", "no blocklisted jargon in the user-facing text")]


def _load_json(path: Path) -> tuple[dict | None, str | None]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001 — any parse/read failure is one AUTO-FAIL row
        return None, f"unreadable JSON: {e}"
    if not isinstance(data, dict):
        # valid JSON but a top-level array/scalar — the predicates read object keys, so degrade to a
        # FAIL row instead of crashing on data.get() (the 'never crash' three-bucket contract).
        return None, f"expected a JSON object, got {type(data).__name__}"
    return data, None


def evaluate_entry(entry: dict, artifacts: dict[str, Path | None]) -> list[dict]:
    """Evaluate one suite entry against artifact paths. Pure — no network, no suite I/O."""
    rows: list[dict] = []
    expect = entry.get("expect") or {}

    for section, preds in expect.items():
        if section not in KNOWN_PREDICATES:
            rows.append(_row("MANUAL", f"{section}.*",
                             f"unknown expect section '{section}' — not in runner vocabulary yet; verify by hand"))
            continue
        if not isinstance(preds, dict):
            rows.append(_row("AUTO-FAIL", f"{section}", f"expect.{section} must be a mapping, got {type(preds).__name__}"))
            continue

        path = artifacts.get(section)
        if path is None or not Path(path).is_file():
            missing = str(path) if path else "(no path — phase never produced it)"
            for key in preds:
                rows.append(_row("AUTO-FAIL", f"{section}.{key}", f"artifact missing: {missing}"))
            continue
        path = Path(path)

        if section == "workflow":
            text = path.read_text(encoding="utf-8")
            data: dict | None = None
            err = None
        else:
            data, err = _load_json(path)
            text = ""
        if err:
            for key in preds:
                rows.append(_row("AUTO-FAIL", f"{section}.{key}", f"{path.name}: {err}"))
            continue

        for key, arg in preds.items():
            check = f"{section}.{key}"
            if key not in KNOWN_PREDICATES[section]:
                rows.append(_row("MANUAL", check,
                                 f"unknown predicate '{key}' — not in runner vocabulary yet; verify by hand"))
                continue
            # Every predicate except `pattern` takes a LIST. A scalar (missing YAML brackets) would
            # otherwise iterate character-by-character → a false AUTO-PASS on grep_present, or a crash
            # on None. Degrade to AUTO-FAIL so a malformed suite entry never masquerades as green.
            if key != "pattern" and not isinstance(arg, list):
                rows.append(_row("AUTO-FAIL", check,
                                 f"predicate '{key}' expects a list, got {type(arg).__name__} — check the suite YAML brackets"))
                continue

            if section == "analyze":
                assert data is not None
                features = data.get("features") or []
                if key == "features_include":
                    for f in arg:
                        ok = f in features
                        rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", f"{check}[{f}]",
                                         f"features={features}"))
                elif key == "features_exclude":
                    for f in arg:
                        ok = f not in features
                        rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", f"{check}[{f}]",
                                         f"features={features}"))
                elif key == "pattern":
                    got = data.get("pattern")
                    ok = got == arg
                    rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", check,
                                     f"expected '{arg}', got '{got}'"))
            elif section == "workflow":
                for needle in arg:
                    present = needle in text
                    if key == "grep_present":
                        rows.append(_row("AUTO-PASS" if present else "AUTO-FAIL",
                                         f"{check}[{needle}]",
                                         "found" if present else f"'{needle}' not in {path.name}"))
                    else:  # grep_absent
                        rows.append(_row("AUTO-PASS" if not present else "AUTO-FAIL",
                                         f"{check}[{needle}]",
                                         "absent" if not present else f"'{needle}' PRESENT in {path.name}"))
            elif section == "report":
                assert data is not None
                notes = str(data.get("notes") or "")  # report.json.notes is ONE string (058 r2)
                for needle in arg:
                    ok = needle in notes
                    rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", f"{check}[{needle}]",
                                     "found in notes" if ok else f"'{needle}' not in notes"))

    for item in entry.get("manual") or []:
        rows.append(_row("MANUAL", "manual", str(item)))
    return rows


# ── spec 060: cost-regression gating ──────────────────────────────────────────
# The `cost:` block is a TOP-LEVEL entry key (sibling of expect/manual). It gates on task.json.cost
# (059) — NOT a file artifact — so it lives in its own evaluator, not the file-based evaluate_entry.
NORMAL_PHASES = ("analyze", "spec", "implement")   # phases a completed build MUST record
FAST_PHASES = ("spec", "implement")                 # ⚡ (028): merged draft writes under `spec`
DEFAULT_DRIFT_PCT = 40                               # one-sided; only a regression beyond this fails


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _phase_num(cost_map: dict, phase: str, field: str):
    c = cost_map.get(phase)
    return c.get(field) if isinstance(c, dict) else None


def _denied_calls(run_dir, phase: str):
    """Count tool-calls that FAILED (`✗`) in a phase's transcript. Spec 071 S2.

    Why not turns: denied calls compress into few turns, so turn count is the WRONG axis for
    search-thrash (measured 2026-07-18: same-Haiku webhook vs schedule ran 16 vs 22 turns —
    BACKWARDS — while denied greps were 7 vs 2). `✗` = tool_result.is_error (run-transcript.ts),
    which for grep/find/rg IS a hook denial. Returns None when the transcript is absent (pre-capture
    run, or a build that never reached the phase) → the caller emits MANUAL, never a false PASS.
    """
    if not run_dir:
        return None
    from pathlib import Path as _P
    t = _P(run_dir) / "transcripts" / f"{phase}.md"
    if not t.exists():
        return None
    n, in_calls = 0, False
    for line in t.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("### Tool calls"):
            in_calls = True
        elif line.startswith("### ") and in_calls:
            in_calls = False
        elif in_calls and line.startswith("- ") and line.rstrip().endswith("✗"):
            n += 1
    return n


def evaluate_cost(cost_block, cost_map, fast: bool = False, baseline: dict | None = None,
                  run_dir=None) -> list[dict]:
    """Spec 060 — evaluate an entry's `cost:` block against task.json.cost. Pure; three-bucket rows.

    Every missing-data path is decided (never a crash, never a silent green):
      per-phase metric absent → MANUAL · a `total_*` over a build missing an EXPECTED phase → AUTO-FAIL
      (build incomplete) · cache% with denom 0 → MANUAL · wholly missing cost → all MANUAL.

    `denied_calls_max` (spec 071 S2) is the exception that reads the TRANSCRIPT (via run_dir), not
    cost_map — so it is evaluated even on a pre-059 run that has no cost.
    """
    rows: list[dict] = []
    if not isinstance(cost_block, dict):
        return rows
    expected = FAST_PHASES if fast else NORMAL_PHASES
    have_cost = isinstance(cost_map, dict) and any(isinstance(cost_map.get(p), dict) for p in expected)
    drift_pct = cost_block.get("drift_pct", DEFAULT_DRIFT_PCT)
    if not _finite(drift_pct):
        drift_pct = DEFAULT_DRIFT_PCT

    for key, arg in cost_block.items():
        if key == "drift_pct":
            continue  # config, not a predicate
        check = f"cost.{key}"

        # denied_calls_max reads the transcript, not cost — handle BEFORE the have_cost guard and
        # before the `_max` suffix branches below (spec 071 S2).
        if key == "denied_calls_max" or key.endswith("_denied_max"):
            phase = "implement" if key == "denied_calls_max" else key[: -len("_denied_max")]
            if not _finite(arg):
                rows.append(_row("AUTO-FAIL", check, f"expects a number, got {type(arg).__name__}"))
                continue
            n = _denied_calls(run_dir, phase)
            if n is None:
                rows.append(_row("MANUAL", check, f"no transcript for {phase} — cannot count denied calls"))
            elif n <= arg:
                rows.append(_row("AUTO-PASS", check, f"{n} denied ≤ {arg}"))
            else:
                rows.append(_row("AUTO-FAIL", check, f"{n} denied > {arg} — ③ hunting (missing pattern/tool?)"))
            continue

        if not have_cost:
            rows.append(_row("MANUAL", check, "no cost captured — pre-059 run"))
            continue

        if key.endswith("_turns_max"):
            phase = key[: -len("_turns_max")]
            if not _finite(arg):
                rows.append(_row("AUTO-FAIL", check, f"expects a number, got {type(arg).__name__}"))
            elif phase == "total":
                total = 0
                missing = next((p for p in expected if not _finite(_phase_num(cost_map, p, "numTurns"))), None)
                if missing:
                    rows.append(_row("AUTO-FAIL", check, f"build incomplete: phase {missing} has no numTurns"))
                else:
                    total = sum(_phase_num(cost_map, p, "numTurns") for p in expected)
                    ok = total <= arg
                    rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", check, f"{total} {'≤' if ok else '>'} {arg}"))
            else:
                v = _phase_num(cost_map, phase, "numTurns")
                if not _finite(v):
                    rows.append(_row("MANUAL", check, f"no numTurns for phase {phase}"))
                else:
                    ok = v <= arg
                    rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", check, f"{v} {'≤' if ok else '>'} {arg}"))

        elif key == "cache_min_pct":
            if not (_finite(arg) or isinstance(arg, dict)):
                rows.append(_row("AUTO-FAIL", check, f"expects a number or map, got {type(arg).__name__}"))
                continue
            scope = arg if isinstance(arg, dict) else {p: arg for p in expected}
            for p, minpct in scope.items():
                if not _finite(minpct):  # a non-numeric map value (e.g. {implement: null}) must not crash
                    rows.append(_row("AUTO-FAIL", f"{check}[{p}]",
                                     f"threshold must be a number, got {type(minpct).__name__}"))
                    continue
                it, cr = _phase_num(cost_map, p, "inputTokens"), _phase_num(cost_map, p, "cacheReadTokens")
                if not (_finite(it) and _finite(cr)) or (it + cr) == 0:
                    rows.append(_row("MANUAL", f"{check}[{p}]", f"no token data for phase {p}"))
                    continue
                pct = round(cr / (it + cr) * 100)  # cacheCreation NOT counted (measures reuse)
                ok = pct >= minpct
                rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", f"{check}[{p}]",
                                 f"{pct}% {'≥' if ok else '<'} {minpct}%"))

        elif key == "output_tokens_max":
            if not isinstance(arg, dict):
                rows.append(_row("AUTO-FAIL", check, f"expects a map {{phase: max}}, got {type(arg).__name__}"))
                continue
            for p, maxtok in arg.items():
                if not _finite(maxtok):  # a non-numeric map value must not crash the comparison
                    rows.append(_row("AUTO-FAIL", f"{check}[{p}]",
                                     f"max must be a number, got {type(maxtok).__name__}"))
                    continue
                v = _phase_num(cost_map, p, "outputTokens")
                if not _finite(v):
                    rows.append(_row("MANUAL", f"{check}[{p}]", f"no outputTokens for phase {p}"))
                else:
                    ok = v <= maxtok
                    rows.append(_row("AUTO-PASS" if ok else "AUTO-FAIL", f"{check}[{p}]",
                                     f"{v} {'≤' if ok else '>'} {maxtok}"))
        else:
            rows.append(_row("MANUAL", check, f"unknown cost predicate '{key}' — verify by hand"))

    # Drift — only when the entry opts in (has a cost: block, which we're inside) AND a baseline
    # exists. `isinstance` (not truthiness) so a corrupted/hand-edited non-dict baseline entry
    # degrades to no-drift instead of an AttributeError.
    if isinstance(baseline, dict) and have_cost:
        rows.extend(_eval_drift(baseline, cost_map, expected, drift_pct))
    return rows


def _drift_row(check: str, base, new, drift_pct) -> dict:
    if base == 0:
        return _row("MANUAL", check, "baseline is 0 — cannot compute drift")
    pct = round((new - base) / base * 100)
    if pct < 0:
        return _row("AUTO-PASS", check, f"{base} → {new}  ({pct}%)  ↓ faster")
    if pct > drift_pct:
        return _row("AUTO-FAIL", check, f"{base} → {new}  (+{pct}%)  ✗ > +{drift_pct}%")
    return _row("AUTO-PASS", check, f"{base} → {new}  (+{pct}%)  ≤ +{drift_pct}%")


def _eval_drift(baseline: dict, cost_map: dict, expected, drift_pct) -> list[dict]:
    """One-sided numTurns drift vs a saved baseline. Regression > +D% fails; any improvement passes."""
    if not isinstance(baseline, dict):
        return []  # a corrupted baseline entry degrades to no-drift, never an AttributeError
    rows: list[dict] = []
    base_phases = baseline.get("phases") or {}
    for p in expected:
        bv = (base_phases.get(p) or {}).get("numTurns")
        nv = _phase_num(cost_map, p, "numTurns")
        check = f"cost.drift[{p}.numTurns]"
        if not (_finite(bv) and _finite(nv)):
            rows.append(_row("MANUAL", check, f"baseline/current mismatch for phase {p}"))
        else:
            rows.append(_drift_row(check, bv, nv, drift_pct))
    bt = (baseline.get("total") or {}).get("numTurns")
    if bt is not None:
        check = "cost.drift[total.numTurns]"
        if _finite(bt) and all(_finite(_phase_num(cost_map, p, "numTurns")) for p in expected):
            nt = sum(_phase_num(cost_map, p, "numTurns") for p in expected)
            rows.append(_drift_row(check, bt, nt, drift_pct))
        else:
            rows.append(_row("MANUAL", check, "baseline/current mismatch for total"))
    return rows


def build_baseline(cost_map: dict, fast: bool = False) -> dict:
    """Snapshot the numTurns/outputTokens profile for `--save-baseline`. `total` only when complete."""
    expected = FAST_PHASES if fast else NORMAL_PHASES
    phases = {}
    complete = True
    for p in expected:
        c = cost_map.get(p) if isinstance(cost_map, dict) else None
        if isinstance(c, dict) and _finite(c.get("numTurns")):
            phases[p] = {"numTurns": c.get("numTurns"), "outputTokens": c.get("outputTokens")}
        else:
            complete = False
    out: dict = {"phases": phases}
    if complete:
        out["total"] = {"numTurns": sum(v["numTurns"] for v in phases.values())}
    return out


def _read_baselines(path: str | None) -> dict:
    if not path or not Path(path).is_file():
        return {}
    data, _err = _load_json(Path(path))
    return data or {}


def _save_baseline(path: str, entry_id: str, snapshot: dict) -> None:
    # Merge into the committed snapshot file (stable key order, no timestamp → a diff means the
    # numbers actually moved, so a cost regression shows up in review).
    data = _read_baselines(path)
    data[entry_id] = snapshot
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                          encoding="utf-8")


PHASE_ORDER = [("analyze", "analyze"), ("spec", "spec"), ("implement", "implement"), ("test", "report")]


def compute_timing(taskid: str, artifact_paths: dict[str, str | None], fast: bool = False) -> dict:
    """Per-phase + total wall-clock for one run, derived post-hoc — no polling.

    Model (both signals are accurate to ~1s and need no backend):
      - `taskid` is the fire time in EPOCH MILLISECONDS (Builder ids are 13-digit ms timestamps).
      - each phase's artifact mtime is that phase's completion instant (analyze.json, SPEC.md,
        main.yml, report.json in order).
    A phase whose artifact is missing (e.g. an errored/parked run) is marked incomplete; the total
    runs up to the last artifact present. Caveat: re-running `check`/editing an artifact rewrites its
    mtime — measure on a clean single run for before/after comparison.

    `fast=True` (⚡ spec 028): the build has NO separate analyze phase — one merged draft turn writes
    both analyze.json and SPEC.md, so splitting them is meaningless (the 'analyze' delta would absorb
    the whole turn and 'spec' would be a within-turn file-write gap, possibly negative). In that mode
    analyze+spec are reported as ONE `draft(analyze+spec)` row measured to the later of the two mtimes.
    """
    try:
        t0 = int(taskid) / 1000.0
    except (TypeError, ValueError):
        return {"taskid": str(taskid), "error": "taskid is not a numeric ms timestamp", "phases": [], "total_s": None}

    order = PHASE_ORDER
    if fast:
        # Merge analyze+spec: completion = the later mtime of the two (same turn wrote both).
        a, s = artifact_paths.get("analyze"), artifact_paths.get("spec")
        mt = [Path(p).stat().st_mtime for p in (a, s) if p and Path(p).is_file()]
        merged_path = None
        if mt:
            merged_path = a if (a and Path(a).is_file() and Path(a).stat().st_mtime == max(mt)) else s
        order = [("draft(analyze+spec)", "_merged"), ("implement", "implement"), ("test", "report")]
        artifact_paths = {**artifact_paths, "_merged": merged_path}

    rows: list[dict] = []
    prev = t0
    last = t0
    complete = True
    for phase, key in order:
        p = artifact_paths.get(key)
        if p and Path(p).is_file():
            m = Path(p).stat().st_mtime
            # A merged/edited artifact could predate `prev`; never report a negative phase.
            delta = max(0.0, m - prev)
            rows.append({"phase": phase, "delta_s": round(delta, 1), "cum_s": round(m - t0, 1), "ok": True})
            prev = m
            last = m
        else:
            rows.append({"phase": phase, "delta_s": None, "cum_s": None, "ok": False})
            complete = False
    return {"taskid": str(taskid), "total_s": round(last - t0, 1), "complete": complete, "fast": fast, "phases": rows}


def render_timing(t: dict) -> str:
    if t.get("error"):
        return f"timing error: {t['error']}"
    tag = " ⚡fast (analyze+spec merged)" if t.get("fast") else ""
    lines = [f"== e2e timing · run {t['taskid']}{tag} =="]
    for r in t["phases"]:
        if r["ok"]:
            lines.append(f"  {r['phase']:<20} {r['delta_s']:>7.1f}s   (cumulative {r['cum_s']:>7.1f}s)")
        else:
            lines.append(f"  {r['phase']:<20} {'—':>7}    (no artifact — phase incomplete)")
    tag = "" if t.get("complete") else "  [INCOMPLETE — run did not finish all phases]"
    lines.append(f"  {'TOTAL':<12} {t['total_s']:>7.1f}s{tag}")
    return "\n".join(lines)


def render_cost(cost: dict) -> str:
    """Spec 059 — the per-phase token/turn/cache table from task.json `.cost`. The mtime timing above
    answers HOW LONG a phase took; this answers WHY: `numTurns` (internal tool-loop / lint→fix churn),
    `outputTokens` (the slow generation axis), and `cache%` = cacheRead / (cacheRead + input) — the
    cold-start-cache signal (near 0% ⇒ each fresh spawn re-pays full input price). Missing cells show
    `—` (a phase whose turn died before a result records no entry); an empty map ⇒ a pre-059 run."""
    order = [p for (p, _k) in PHASE_ORDER]  # analyze, spec, implement, test
    if not any(isinstance(cost.get(p), dict) for p in order):
        return "== e2e cost · (no per-phase cost recorded — pre-059 run, or turns died before a result) =="
    lines = [
        "== e2e cost · per-phase tokens / turns / cache ==",
        f"  {'phase':<12}{'turns':>6}{'in_tok':>10}{'out_tok':>10}{'cache_rd':>10}{'cache%':>8}",
    ]

    def _s(v: object) -> str:
        return "—" if not isinstance(v, (int, float)) else str(int(v))

    for ph in order:
        c = cost.get(ph)
        if not isinstance(c, dict):
            continue
        it, cr = c.get("inputTokens"), c.get("cacheReadTokens")
        denom = (cr if isinstance(cr, (int, float)) else 0) + (it if isinstance(it, (int, float)) else 0)
        pct = f"{round(100 * (cr or 0) / denom)}%" if denom else "—"
        lines.append(
            f"  {ph:<12}{_s(c.get('numTurns')):>6}{_s(it):>10}"
            f"{_s(c.get('outputTokens')):>10}{_s(cr):>10}{pct:>8}"
        )
    return "\n".join(lines)


def render_table(entry_id: str, rows: list[dict]) -> str:
    counts = {b: sum(1 for r in rows if r["bucket"] == b) for b in SETTLED_BUCKETS}
    lines = [f"== e2e check · entry '{entry_id}' =="]
    for bucket in SETTLED_BUCKETS:
        group = [r for r in rows if r["bucket"] == bucket]
        if not group:
            continue
        lines.append(f"-- {bucket} ({len(group)}) --")
        lines.extend(f"  {r['check']:<44} {r['detail']}" for r in group)
    verdict = "PASS (auto)" if counts["AUTO-FAIL"] == 0 else "FAIL (auto)"
    lines.append(f"verdict: {verdict} — {counts['AUTO-PASS']} auto-pass, "
                 f"{counts['AUTO-FAIL']} auto-fail, {counts['MANUAL']} manual-residue")
    if counts["MANUAL"]:
        lines.append("NOTE: MANUAL rows are unverified surface — report them to the user, never drop them.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--suite")
    ap.add_argument("--entry")
    ap.add_argument("--list", action="store_true", help="print suite entry ids and exit")
    ap.add_argument("--emit-fire", action="store_true",
                    help="print the entry's fire parameters as JSON {prompt,mode,fast,deploy,project}")
    ap.add_argument("--timing", action="store_true",
                    help="per-phase + total wall-clock for a run (needs --taskid + artifact paths); no --suite")
    ap.add_argument("--taskid", help="run id (fire time in ms) — for --timing")
    ap.add_argument("--spec-path", help="SPEC.md path — for --timing")
    ap.add_argument("--task-json", help="task.json path — for --timing: also render the per-phase cost table")
    ap.add_argument("--fast", action="store_true",
                    help="--timing: this was a ⚡ fast build — merge analyze+spec into one draft row")
    ap.add_argument("--analyze")
    ap.add_argument("--workflow")
    ap.add_argument("--report")
    ap.add_argument("--baselines", help="e2e-baselines.json path — for cost drift")
    ap.add_argument("--save-baseline", action="store_true",
                    help="write this run's cost profile into --baselines under the entry id")
    ap.add_argument("--userview", action="store_true",
                    help="print ONLY the user-facing text (digest + notes), hiding the dev view")
    ap.add_argument("--comprehension", action="store_true",
                    help="deterministic jargon check over the user-facing text (needs --analyze/--report)")
    ap.add_argument("--json", action="store_true", help="machine output instead of the table")
    args = ap.parse_args(argv)

    # ── spec 063: userview / comprehension — user-facing text only, no suite ──
    if args.userview or args.comprehension:
        digest = ""
        if args.analyze and Path(args.analyze).is_file():
            aj, _e = _load_json(Path(args.analyze))
            digest = str((aj or {}).get("overview") or "")
        notes = ""
        if args.report and Path(args.report).is_file():
            rj, _e = _load_json(Path(args.report))
            notes = str((rj or {}).get("notes") or "")
        userview = build_userview(digest, notes)
        if args.userview:
            print("== e2e userview · (reconstruction proxy — not the literal Chat.tsx render) ==")
            print(userview or "(no user-facing text found)")
            print("\nNOTE: excludes features/planned_nodes/YAML/lint by design. Localization port + "
                  "Chat.tsx contract test are a follow-up slice (spec 063 AC1).")
            return 0
        # comprehension — scan the EXACT string build_userview produces (one source of truth)
        rows = evaluate_comprehension(userview)
        auto_fail = sum(1 for r in rows if r["bucket"] == "AUTO-FAIL")
        nothing_to_judge = not auto_fail and all(r["bucket"] == "MANUAL" for r in rows)
        print(render_table("comprehension", rows) if not args.json
              else json.dumps({"rows": rows, "auto_ok": auto_fail == 0}, ensure_ascii=False, indent=2))
        print("\nNOTE: DETERMINISTIC jargon half (objective; scans the ENGLISH notes today — the JA "
              "localize + katakana tokens land with the deferred NOTE_JA port). The open-ended "
              "'next_step_clear' judgment is the /e2e skill's quarantined LLM proxy, not this exit code.")
        return 1 if auto_fail else (2 if nothing_to_judge else 0)

    # ── timing mode: no suite needed, pure filesystem ────────────────────────
    if args.timing:
        if not args.taskid:
            print("--timing needs --taskid", file=sys.stderr)
            return 2
        t = compute_timing(args.taskid, {
            "analyze": args.analyze, "spec": args.spec_path,
            "implement": args.workflow, "report": args.report,
        }, fast=args.fast)
        # Spec 059: the WHY table (tokens/turns/cache) rides alongside the mtime timing when a
        # task.json is passed. Read leniently — a pre-059 run (no `.cost`) renders the empty-map line.
        cost = {}
        if args.task_json:
            cj, _err = _load_json(Path(args.task_json))
            cost = (cj or {}).get("cost") or {}
        if args.json:
            t["cost"] = cost
            print(json.dumps(t, ensure_ascii=False, indent=2))
        else:
            print(render_timing(t) + (("\n" + render_cost(cost)) if args.task_json else ""))
        return 0 if t.get("total_s") is not None else 2

    if not args.suite:
        print("--suite is required (except in --timing mode)", file=sys.stderr)
        return 2
    try:
        suite = yaml.safe_load(Path(args.suite).read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"cannot read suite {args.suite}: {e}", file=sys.stderr)
        return 2
    if not isinstance(suite, list):
        print(f"suite {args.suite} must be a YAML list of entries", file=sys.stderr)
        return 2

    if args.list:
        for e in suite:
            print(e.get("id", "?"))
        return 0

    if not args.entry:
        print("--entry is required (or --list)", file=sys.stderr)
        return 2
    entry = next((e for e in suite if e.get("id") == args.entry), None)
    if entry is None:
        ids = ", ".join(str(e.get("id")) for e in suite)
        print(f"entry '{args.entry}' not in suite — have: {ids}", file=sys.stderr)
        return 2

    if args.emit_fire:
        print(json.dumps({
            "prompt": entry.get("prompt", ""),
            "mode": entry.get("mode", "auto"),
            "fast": bool(entry.get("fast", False)),
            "deploy": entry.get("deploy", "none"),
            "project": entry.get("project"),
        }, ensure_ascii=False))
        return 0

    artifacts = {k: Path(v) if (v := getattr(args, k)) else None for k in ARTIFACT_KINDS}
    rows = evaluate_entry(entry, artifacts)

    # Spec 060 — cost gating, opt-in on the entry's `cost:` block (a sibling of expect/manual).
    cost_block = entry.get("cost")
    if isinstance(cost_block, dict):
        cost_map = {}
        run_dir = None
        if args.task_json:
            cj, _err = _load_json(Path(args.task_json))
            cost_map = (cj or {}).get("cost") or {}
            run_dir = Path(args.task_json).parent  # …/.runs/<id>/ → transcripts/ live here (071 S2)
        baselines = _read_baselines(args.baselines)
        rows += evaluate_cost(cost_block, cost_map, fast=args.fast, baseline=baselines.get(args.entry), run_dir=run_dir)
        if args.save_baseline and args.baselines:
            _save_baseline(args.baselines, args.entry, build_baseline(cost_map, fast=args.fast))

    auto_fail = sum(1 for r in rows if r["bucket"] == "AUTO-FAIL")
    if args.json:
        print(json.dumps({"entry": args.entry, "rows": rows,
                          "auto_ok": auto_fail == 0}, ensure_ascii=False, indent=2))
    else:
        print(render_table(args.entry, rows))
    return 0 if auto_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

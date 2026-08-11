"""Tests for tools/dify_base/lint_node_bodies.py (spec 038 P1).

Fixture-driven exit-code tests mirror tests/test_lint_refs.py (subprocess via sys.executable —
the tool is exercised across the process boundary exactly as pre-commit / the builder gate run
it). Drift tests (spec 038 D2) bind TYPE_TO_DEF ↔ the pinned schema ↔ lint_refs.IMPLICIT_OUTPUTS,
and AC 6 pins the root `Node.data` envelope so nobody "helpfully" wires the `$ref`s into a hard
gate mid-rollout.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "lint_node_bodies"
TOOL = Path(__file__).parent.parent / "tools" / "dify_base" / "lint_node_bodies.py"
SCHEMA = Path(__file__).parent.parent / "schemas" / "dify-dsl-0.6.0.json"

sys.path.insert(0, str(Path(__file__).parent.parent / "tools" / "dify_base"))

EXPECTED: dict[str, int] = {
    "valid_real_shape.yml": 0,  # AC 2: undeclared keys (type/selected/isInIteration) pass — open additionalProperties
    "bad_missing_required.yml": 1,  # AC 1: llm without prompt_template
    "bad_nested_ref.yml": 1,  # AC 1b: model missing provider — only the nested ModelConfig $def catches it
    "skip_defless_and_error.yml": 0,  # AC 3: assigner (no def) + http-request (_error stub) warn-skip
    "demoted_required.yml": 1,  # AC 2: required missing → gates by default (see demote test below)
    "bad_malformed_node.yml": 2,  # AC 4: non-dict node → structured error
    "escape_hatch.yml": 0,  # AC 9: column-0 allow-marker suppresses the node's findings
    "escape_forged.yml": 1,  # AC 9: the same marker INDENTED inside a block scalar must NOT suppress
}


def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL), *args], capture_output=True, text=True
    )


@pytest.mark.parametrize("fname,expected_exit", list(EXPECTED.items()))
def test_exit_codes(fname: str, expected_exit: int) -> None:
    result = run_tool(str(FIXTURES_DIR / fname))
    assert result.returncode == expected_exit, (
        f"{fname}: expected exit {expected_exit}, got {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )


def test_missing_required_message_names_node_and_field() -> None:
    """AC 1: the finding carries a path:line prefix, the node id, the type, and the field."""
    result = run_tool(str(FIXTURES_DIR / "bad_missing_required.yml"))
    assert result.returncode == 1
    line = next(l for l in result.stdout.splitlines() if "prompt_template" in l)
    assert "bad_missing_required.yml:" in line, "path prefix present"
    # path:line: — a digit follows the fixture path's colon (the llm node's own line)
    after_path = line.split("bad_missing_required.yml:", 1)[1]
    assert after_path.split(":", 1)[0].isdigit(), f"line number attributed: {line}"
    assert "'1700000000002'" in line and "(llm)" in line, line


def test_nested_ref_finding_has_nested_json_path() -> None:
    """AC 1b: the defect is inside the nested ModelConfig $def — json_path proves the nested
    resolution ran (a top-level-only validator emits no finding at all for this fixture)."""
    result = run_tool(str(FIXTURES_DIR / "bad_nested_ref.yml"))
    assert result.returncode == 1
    assert "$.model" in result.stdout and "provider" in result.stdout, result.stdout


def test_defless_and_error_skips_warn_on_stderr() -> None:
    """AC 3: exactly two skip warnings (assigner def-less, http-request _error), both stderr."""
    result = run_tool(str(FIXTURES_DIR / "skip_defless_and_error.yml"))
    assert result.returncode == 0
    warnings = [l for l in result.stderr.splitlines() if "skipping body validation" in l]
    assert len(warnings) == 2, result.stderr
    assert any("assigner" in w for w in warnings) and any("http-request" in w for w in warnings)
    assert result.stdout.strip() == "", "skips are warnings, not findings"


def test_error_skip_is_schema_derived_not_hardcoded(tmp_path: Path) -> None:
    """AC 3b (anti-gaming): un-stub HttpRequestNodeData in a COPY of the schema and pass it via
    --schema — the same http-request node must now be VALIDATED (a finding appears). A hard-coded
    `if type == 'http-request': skip` passes AC 3 but fails this."""
    schema = json.loads(SCHEMA.read_text())
    schema["$defs"]["NodeData_HttpRequestNodeData"] = {
        "type": "object",
        "properties": {"url": {"type": "string"}},
        "required": ["url"],
    }
    patched = tmp_path / "patched-schema.json"
    patched.write_text(json.dumps(schema))
    result = run_tool("--schema", str(patched), str(FIXTURES_DIR / "skip_defless_and_error.yml"))
    assert result.returncode == 1, f"http-request now validated:\n{result.stdout}\n{result.stderr}"
    assert "url" in result.stdout and "http-request" in result.stdout


def test_demote_flag_downgrades_required_to_warning() -> None:
    """AC 2 (D3 seam): --demote DEF:FIELD turns that missing-required into a stderr warning,
    exit 0. DEMOTED_REQUIRED ships empty — every future row must cite the P2 report."""
    result = run_tool(
        "--demote", "NodeData_LLMNodeData:context", str(FIXTURES_DIR / "demoted_required.yml")
    )
    assert result.returncode == 0, f"{result.stdout}\n{result.stderr}"
    assert "context" in result.stderr and "demoted" in result.stderr
    assert "context" not in result.stdout


def test_malformed_input_never_tracebacks() -> None:
    """AC 4 (V1 rule): non-dict node and non-YAML input → structured one-line error, exit 2."""
    result = run_tool(str(FIXTURES_DIR / "bad_malformed_node.yml"))
    assert result.returncode == 2
    assert "Traceback" not in result.stdout + result.stderr

    not_yaml = FIXTURES_DIR / "bad_malformed_node.yml"  # reuse dir; write a throwaway non-YAML
    bad = not_yaml.parent / "_tmp_not_yaml.txt"
    bad.write_text("{{{{ not: yaml: [")
    try:
        result = run_tool(str(bad))
        assert result.returncode == 2
        assert "Traceback" not in result.stdout + result.stderr
    finally:
        bad.unlink()


def test_usage_error_without_args() -> None:
    result = run_tool()
    assert result.returncode == 2


def test_escape_hatch_suppresses_with_note_and_forgery_fails() -> None:
    """AC 9 (P3): the column-0 marker suppresses (stderr notes it, stdout empty); the identical
    marker text indented inside a block scalar is DATA and must not suppress."""
    ok = run_tool(str(FIXTURES_DIR / "escape_hatch.yml"))
    assert ok.returncode == 0
    assert "suppressed" in ok.stderr and "1700000000002" in ok.stderr
    assert ok.stdout.strip() == ""

    forged = run_tool(str(FIXTURES_DIR / "escape_forged.yml"))
    assert forged.returncode == 1
    assert "prompt_template" in forged.stdout


# ── drift tests (spec 038 D2 / AC 5 / AC 6) ─────────────────────────────────────────────────────


def _schema_defs() -> dict:
    return json.loads(SCHEMA.read_text())["$defs"]


def test_type_to_def_values_resolve_in_pinned_schema() -> None:
    """AC 5: every non-None TYPE_TO_DEF value resolves to a def in the pinned schema; None rows
    (assigner) carry the documented skip rationale by construction."""
    from lint_node_bodies import TYPE_TO_DEF

    defs = _schema_defs()
    missing = [v for v in TYPE_TO_DEF.values() if v is not None and v not in defs]
    assert missing == [], f"TYPE_TO_DEF values not in schema: {missing}"


def test_every_nonbase_def_is_mapped() -> None:
    """AC 5: every NodeData_* def except the two pydantic base classes must be a TYPE_TO_DEF
    value — a schema refresh that ADDS a def fails here until someone maps or skips it."""
    from lint_node_bodies import BASE_CLASS_DEFS, TYPE_TO_DEF

    defs = {k for k in _schema_defs() if k.startswith("NodeData_")}
    mapped = {v for v in TYPE_TO_DEF.values() if v is not None}
    unaccounted = defs - mapped - BASE_CLASS_DEFS
    assert unaccounted == set(), (
        f"defs neither mapped nor on the base-class skip list: {sorted(unaccounted)}"
    )


def test_implicit_outputs_keys_subset_of_type_to_def() -> None:
    """AC 5: lint_refs' hand-written IMPLICIT_OUTPUTS can no longer drift silently — its keys
    must be node types this tool also knows."""
    from lint_node_bodies import TYPE_TO_DEF
    from lint_refs import IMPLICIT_OUTPUTS

    assert set(IMPLICIT_OUTPUTS.keys()) <= set(TYPE_TO_DEF.keys())


def test_known_node_types_deleted_from_lint_refs() -> None:
    """AC 5: KNOWN_NODE_TYPES was dead code (no consumer) — TYPE_TO_DEF is now the authoritative
    node-type list."""
    src = (Path(__file__).parent.parent / "tools" / "dify_base" / "lint_refs.py").read_text()
    assert "KNOWN_NODE_TYPES" not in src


def test_list_coverage_is_the_enforced_predicate_not_a_copy_of_it() -> None:
    """`--list-coverage` answers "will this node type be checked at all?" without a file — the
    question both ③ transcripts (runs 1784185934247 / 1784192313811) answered by reading this
    tool's source, because the skip warning only fires after a body already exists.

    The listing must BE the enforcement: every status is recomputed here from the pinned schema
    + TYPE_TO_DEF (lint_file's own predicate) and must match row-for-row. Asserting a literal
    "http-request → warn-skip" instead would be the hand-synced allowlist D4 exists to forbid —
    it would fail exactly when gen_schema (spec 024 S1) starts dumping a real def and coverage
    correctly turns itself on.
    """
    from lint_node_bodies import TYPE_TO_DEF

    result = run_tool("--list-coverage")
    assert result.returncode == 0, f"stderr:\n{result.stderr}"

    defs = _schema_defs()
    expected = {
        ntype: (
            "warn-skip"
            if def_name is None or "_error" in defs.get(def_name, {})
            else "validated"
        )
        for ntype, def_name in TYPE_TO_DEF.items()
    }
    got = {line.split()[0]: line.split()[1] for line in result.stdout.splitlines()}
    assert got == expected


def test_root_node_data_envelope_still_bare() -> None:
    """AC 6 (D1, anti-gaming): the root Node.data subschema stays the bare `{type}` envelope —
    wiring the NodeData_* $refs there would flip the existing check-jsonschema pre-commit hook
    into an UNMEASURED hard body-gate (the exact hazard D1 excludes structurally)."""
    node_data = _schema_defs()["Node"]["properties"]["data"]
    assert node_data == {
        "type": "object",
        "required": ["type"],
        "properties": {"type": {"type": "string"}},
    }


# ── --dump-schema (the sanctioned one-call answer to "what is IN this node body?") ──────────────
# Run 1784278684526 built a trigger-webhook (no pattern ships an example) and burned 44 turns / 13
# hook-denied greps extracting the def from the 7,700-line schema — grep/rg/`python -c`/probe-script
# are all sandbox-denied, so it Read 182KB three times and reverse-engineered THIS linter's source.
# It literally tried `--dump-schema` before the flag existed. Now it exists; these pin its contract.


def test_dump_schema_prints_the_real_def() -> None:
    result = run_tool("--dump-schema", "trigger-webhook")
    assert result.returncode == 0, result.stderr
    doc = json.loads(result.stdout)
    body = doc["NodeData_WebhookData"]
    # The fields that run reconstructed by hand — if these vanish, the flag misleads.
    for field in ("method", "content_type", "body", "params", "status_code", "webhook_id"):
        assert field in body["properties"], f"missing `{field}`"
    # The def must be self-contained (its own nested $defs), same property lint_file relies on.
    assert "ContentType" in body.get("$defs", {})


def test_dump_schema_unknown_type_lists_the_known_ones() -> None:
    """`find.py --has <typo>` fails SILENTLY ("No matching templates") — indistinguishable from a
    real empty result, and the 44-turn run fell into exactly that. This flag must not repeat it."""
    result = run_tool("--dump-schema", "trigger-webook")  # typo
    assert result.returncode == 2
    assert "unknown node type" in result.stderr
    assert "trigger-webhook" in result.stderr, "the known-type list must include the near-miss"
    assert result.stdout == ""


def test_dump_schema_warn_skip_type_explains_instead_of_stub() -> None:
    """A KNOWN type with no dumped def is a valid question with a valid answer → exit 0, on stdout.

    This asserted exit 2 until run 1784388534562 showed the cost: `--dump-schema http-request` returned
    exactly the right guidance and the turn saw `✗`, i.e. "rejected, find another route" — the hunt this
    flag exists to end. It also fed the denied-call oracle (spec 071 S2) a false positive. Only a
    misspelled type is a caller error; not knowing is the schema's limitation, not the caller's.
    """
    result = run_tool("--dump-schema", "assigner")  # mapped to None (no def dumped)
    assert result.returncode == 0, result.stderr
    assert "warn-skip" in result.stdout
    assert "vetted source" in result.stdout


def test_dump_schema_error_stub_type_exits_zero() -> None:
    """`http-request` maps to a def gen_schema could only emit as an `_error` stub."""
    result = run_tool("--dump-schema", "http-request")
    assert result.returncode == 0, result.stderr
    assert "dump-stub" in result.stdout
    assert "vetted source" in result.stdout


def test_dump_schema_requires_an_argument() -> None:
    result = run_tool("--dump-schema")
    assert result.returncode == 2
    assert "requires a node type" in result.stderr


# ---------------------------------------------------------------------------
# --report-unknown-keys — measured-first probe (2026-08-05; the measurement that gates its
# promotion lives next to UNKNOWN_KEY_EXEMPT in lint_node_bodies.py)
# ---------------------------------------------------------------------------

def _unknown_key_fixture(tmp_path: Path) -> Path:
    """A start→llm workflow whose llm body carries a typo'd key (`queries`) plus the three
    frontend-metadata keys that MUST stay exempt (selected/isInIteration/iteration_id)."""
    f = tmp_path / "unknown_key.yml"
    f.write_text(
        """
workflow:
  graph:
    nodes:
    - id: '1700000000002'
      data:
        type: llm
        title: L
        selected: false
        isInIteration: false
        iteration_id: 'x'
        queries: oops
        model: { provider: p, name: n, mode: chat }
        prompt_template: []
""",
        encoding="utf-8",
    )
    return f


def test_unknown_keys_off_by_default(tmp_path: Path) -> None:
    """Without the flag the sweep is silent — gate behavior is byte-identical (unwired, 038 P1)."""
    result = run_tool(str(_unknown_key_fixture(tmp_path)))
    assert "unknown top-level" not in result.stderr


def test_unknown_keys_flag_warns_but_never_gates(tmp_path: Path) -> None:
    """With the flag: the typo'd key is a stderr WARNING naming the def; exempt frontend keys are
    silent; exit code is unchanged by the warning."""
    result = run_tool("--report-unknown-keys", str(_unknown_key_fixture(tmp_path)))
    line = next(l for l in result.stderr.splitlines() if "unknown top-level" in l)
    assert "queries" in line and "NodeData_LLMNodeData" in line
    for exempt in ("selected", "isInIteration", "iteration_id"):
        assert exempt not in line, f"exempt key {exempt} must not be reported"
    assert "unknown top-level" not in result.stdout, "warnings never land in findings/stdout"


# ── Spec 095 S3 — the editor-state overlay (WARN-FIRST) ─────────────────────────────────────────
# A field Dify's EDITOR needs but its backend never models is invisible to the generated schema, so a
# workflow can be import-clean, four-linters-clean and still refused at publish. These pin the two
# properties that matter: it SPEAKS on the real broken shape, and it can never SHOUT (exit code).

OVERLAY_FIXTURES = [
    ("overlay_webhook_missing.yml", True, "no `variables` at all — the measured failure"),
    ("overlay_webhook_partial.yml", True, "`variables` present but missing a declared field"),
    ("overlay_webhook_ok.yml", False, "fully covered — must stay silent"),
    ("overlay_webhook_no_inputs.yml", False, "nothing promised downstream — nothing to warn about"),
]


@pytest.mark.parametrize("fname,should_warn,why", OVERLAY_FIXTURES)
def test_overlay_never_moves_the_exit_code(fname: str, should_warn: bool, why: str) -> None:
    """THE load-bearing property. lint_node_bodies.py is one of the four LINTERS the builder gates ③
    on (lintClean requires all four == 0) and it runs in pre-commit — so an overlay rule that could
    move the exit code would be a hard gate on another project's frontend internals. Exit stays 0 in
    every case, warning or not."""
    result = run_tool(str(FIXTURES_DIR / fname))
    assert result.returncode == 0, (
        f"{fname} ({why}): overlay must never fail the linter; got {result.returncode}\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert result.stdout.strip() == "", f"{fname}: overlay findings belong on stderr, not stdout"


@pytest.mark.parametrize("fname,should_warn,why", OVERLAY_FIXTURES)
def test_overlay_warns_exactly_where_it_should(fname: str, should_warn: bool, why: str) -> None:
    result = run_tool(str(FIXTURES_DIR / fname))
    spoke = "editor-state field 'variables'" in result.stderr or "does not cover" in result.stderr
    assert spoke is should_warn, (
        f"{fname} ({why}): expected warn={should_warn}, got {spoke}\nstderr:\n{result.stderr}"
    )


def test_overlay_partial_names_the_missing_fields_and_sanitises_header_dashes() -> None:
    """The gap list must be actionable, and `X-Api-Key` must be compared as `X_Api_Key` (Dify's own
    sanitisation) — otherwise a correctly-declared header reads as missing forever."""
    result = run_tool(str(FIXTURES_DIR / "overlay_webhook_partial.yml"))
    assert "does not cover" in result.stderr
    assert "today" in result.stderr, "the uncovered body field must be named"
    assert "X_Api_Key" in result.stderr, "the header gap is reported under its sanitised name"
    assert "rows_json" not in result.stderr.split("does not cover")[1].split("—")[0], (
        "a COVERED field must not appear in the gap list"
    )


def test_overlay_absent_file_is_silent_not_noisy(tmp_path: Path) -> None:
    """A missing/corrupt overlay degrades to "no rules" — never to a crash or a red exit. The overlay
    is advisory; it must not be able to break the linter it rides in."""
    import importlib

    sys.path.insert(0, str(TOOL.parent))
    mod = importlib.import_module("lint_node_bodies")
    mod._overlay_rules.cache_clear()
    real = mod.OVERLAY_PATH
    try:
        mod.OVERLAY_PATH = tmp_path / "does-not-exist.json"
        mod._overlay_rules.cache_clear()
        assert mod._overlay_rules() == ()
        assert mod._overlay_findings(Path("x.yml"), "1", "trigger-webhook", {"body": [{"name": "a"}]}) == []
        (tmp_path / "broken.json").write_text("{not json", encoding="utf-8")
        mod.OVERLAY_PATH = tmp_path / "broken.json"
        mod._overlay_rules.cache_clear()
        assert mod._overlay_rules() == ()
    finally:
        mod.OVERLAY_PATH = real
        mod._overlay_rules.cache_clear()


def test_overlay_rules_carry_evidence_and_a_verified_version() -> None:
    """The bar stated in the overlay's own README: a rule encodes another project's internals, so it
    must cite the source that proves it AND a real observation with the version it was seen on. A rule
    without that is a guess with a linter behind it."""
    overlay = json.loads(
        (Path(__file__).parent.parent / "schemas" / "editor-state-overlay.json").read_text(encoding="utf-8")
    )
    rules = overlay["editor_state_rules"]
    assert rules, "the overlay must not be empty while spec 095 S3 is live"
    for r in rules:
        assert r.get("evidence"), f"{r.get('node_type')}: no evidence cited"
        assert r.get("dify_version_verified"), f"{r.get('node_type')}: no verified Dify version"
        assert r.get("fix"), f"{r.get('node_type')}: a warning without a fix is not actionable"


def test_overlay_field_is_genuinely_absent_from_the_generated_schema() -> None:
    """Rule-bar #1, checked mechanically: if the generated $defs DOES carry the field, the schema
    already gates it and the overlay rule is redundant weight. This also catches the happy day a Dify
    upgrade starts modelling the field — the overlay entry should then be deleted, not kept."""
    import importlib

    sys.path.insert(0, str(TOOL.parent))
    mod = importlib.import_module("lint_node_bodies")
    defs = json.loads(SCHEMA.read_text(encoding="utf-8"))["$defs"]
    overlay = json.loads(
        (Path(__file__).parent.parent / "schemas" / "editor-state-overlay.json").read_text(encoding="utf-8")
    )
    for r in overlay["editor_state_rules"]:
        def_name = mod.TYPE_TO_DEF.get(r["node_type"])
        if not def_name or def_name not in defs:
            continue
        props = (defs[def_name].get("properties") or {}).keys()
        assert r["field"] not in props, (
            f"{r['node_type']}.{r['field']} IS in {def_name} — the schema gates it; drop the overlay rule"
        )

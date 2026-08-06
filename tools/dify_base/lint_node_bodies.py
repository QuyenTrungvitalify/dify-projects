#!/usr/bin/env python3
"""Validate each node's `data` block against its generated NodeData_* schema (spec 038 P1).

The DSL schema (schemas/dify-dsl-0.6.0.json, regenerated weekly from the pinned Dify source)
carries a full pydantic-derived object schema for every node body in `$defs.NodeData_*` — but the
root `Node.data` subschema is deliberately the bare `{type}` envelope (spec 026 D1), so node
bodies are otherwise unvalidated: a wrong-shaped `prompt_template`, a missing `code_language`, a
`model` config without `provider` all pass every committed gate today and surface only at Dify
import/runtime. This linter closes that gap OFFLINE: it dispatches each node's `data.type` to its
def and validates the body against the def as a STANDALONE schema document — each def carries its
own nested `$defs` and every internal `#/$defs/...` pointer resolves within it (verified across
all 29 defs, spec 038 D1). The defs stay UNREFERENCED from the root `Node` schema by design:
wiring `$ref`s there would flip the existing check-jsonschema pre-commit hook into an unmeasured
hard body-gate (tests pin the bare envelope — spec 038 AC 6).

Rollout (spec 038, the spec-020 3-phase discipline): P1 ships this tool UNWIRED — nothing gates
until the P2 false-positive measurement over the indexed surface is written up (038-fp-report.md)
and comes back clean; P3 then adds the 4th `LINTERS` entry + a pre-commit hook.

Skips (D4, all derived at runtime — zero hand-synced allowlists):
  - sticky notes / nodes without `data.type` — silent;
  - node types with no TYPE_TO_DEF entry, an explicit `None` row, or a mapped def carrying an
    `_error` dump-stub (http-request today) — stderr warning. When gen_schema's dump is fixed
    (spec 024 S1), the next regeneration turns coverage on automatically.

`--list-coverage` prints that same skip/validate split BEFORE a file exists, because the skip
warning only fires once you have already written a body and run the tool on it. An author who
wants to know "will this node type be checked at all?" up front otherwise has to read this
source — measured twice (runs 1784185934247 / 1784192313811, the only two ③ transcripts), which
is what motivated the flag. It derives every row from `coverage_rows()`, i.e. the same predicate
`lint_file` gates on, so it cannot drift from what is actually enforced — the D4 rule above is
exactly why no doc may copy the list into prose.

Usage:
    python3 tools/dify_base/lint_node_bodies.py [--schema <path>] [--demote DEF:FIELD ...] \\
        <file.yml> [<file.yml> ...]
    python3 tools/dify_base/lint_node_bodies.py --list-coverage [--schema <path>]

    --schema  override the pinned schema (default: schemas/dify-dsl-0.6.0.json at the repo root;
              `schemas/_latest.json` serves ad-hoc runs against a fresh regeneration)
    --demote  treat DEF's missing-required FIELD as a stderr warning instead of a finding —
              the subprocess-boundary test seam for DEMOTED_REQUIRED (D3); shipped rows must
              cite the P2 report
    --list-coverage
              print `<node type> <validated|warn-skip> <def name|reason>` for every known
              node type and exit 0; takes no files
    --report-unknown-keys
              ALSO warn (stderr, exit unchanged) on top-level body keys outside the def's
              `properties` — the measured-first probe for typo'd field names. See
              UNKNOWN_KEY_EXEMPT below for the measurement that gates its promotion.

Escape hatch (D3, P3): a COLUMN-0 full-line comment `# lint-bodies: allow <node_id>` suppresses
all body findings for that node (stderr notes the suppression). Anchored at column 0 — stricter
than 020's marker — because YAML block-scalar content is always indented past its key, so a
column-0 marker structurally cannot live inside a prompt/instruction string (anti-forgery).

Exit codes (lint_refs.py convention):
    0 — clean
    1 — at least one body finding
    2 — usage error / YAML parse error / file not found / malformed structure (structured
        one-line error, NEVER a traceback — the spec-026 V1 rule)
"""
from __future__ import annotations

import json
import re
import sys
from functools import lru_cache
from pathlib import Path

import yaml

try:
    from jsonschema import Draft202012Validator
except ImportError:  # pragma: no cover — jsonschema is a direct requirement (requirements.in)
    print("lint_node_bodies: the 'jsonschema' package is required (.venv)", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCHEMA = REPO_ROOT / "schemas" / "dify-dsl-0.6.0.json"

# The two pydantic base classes gen_schema dumps alongside the real node types — never mapped
# (they are inheritance scaffolding, not `data.type` values). Drift-tested against the schema.
BASE_CLASS_DEFS = {"NodeData_BaseIterationNodeData", "NodeData_BaseLoopNodeData"}

# `data.type` → NodeData_* def name (spec 038 D2). Hand-authored: 27 of 29 defs carry no `type`
# discriminator, so the mapping cannot be derived from the schema. Regular rows follow
# kebab-case → NodeData_{PascalCase}NodeData; irregulars are commented. Kept honest by drift
# tests: every non-None value must resolve to a def, every non-base def must appear here, and
# lint_refs.IMPLICIT_OUTPUTS.keys() ⊆ this table's keys.
TYPE_TO_DEF: dict[str, str | None] = {
    "agent": "NodeData_AgentNodeData",
    "answer": "NodeData_AnswerNodeData",
    # No def was ever dumped for the assigner (VariableAssignerNodeData) — warn-skip (D4);
    # revisit when gen_schema dumps it. The None row doubles as the documented skip list.
    "assigner": None,
    "code": "NodeData_CodeNodeData",
    "datasource": "NodeData_DatasourceNodeData",
    "document-extractor": "NodeData_DocumentExtractorNodeData",
    "end": "NodeData_EndNodeData",
    "http-request": "NodeData_HttpRequestNodeData",  # `_error` stub today → runtime warn-skip (D4)
    "human-input": "NodeData_HumanInputNodeData",
    "if-else": "NodeData_IfElseNodeData",
    "iteration": "NodeData_IterationNodeData",
    # Real DSL spells the container-start child `data.type: iteration-start` under node-level
    # `type: custom-iteration-start` (templates/patterns/file-iteration.yml; 6 indexed files).
    "iteration-start": "NodeData_IterationStartNodeData",
    "knowledge-index": "NodeData_KnowledgeIndexNodeData",
    "knowledge-retrieval": "NodeData_KnowledgeRetrievalNodeData",
    "list-operator": "NodeData_ListOperatorNodeData",
    "llm": "NodeData_LLMNodeData",  # irregular: all-caps LLM
    "loop": "NodeData_LoopNodeData",
    "loop-end": "NodeData_LoopEndNodeData",
    "loop-start": "NodeData_LoopStartNodeData",
    "parameter-extractor": "NodeData_ParameterExtractorNodeData",
    "question-classifier": "NodeData_QuestionClassifierNodeData",
    "start": "NodeData_StartNodeData",
    "template-transform": "NodeData_TemplateTransformNodeData",
    "tool": "NodeData_ToolNodeData",
    # Spec 057: keys are Dify's WIRE type strings (core/trigger/constants.py) — the old keys
    # "trigger-event"/"webhook" never matched a real node, so those bodies were silently warn-skipped.
    "trigger-plugin": "NodeData_TriggerEventNodeData",  # irregular: plugin node's data class is TriggerEvent
    "trigger-schedule": "NodeData_TriggerScheduleNodeData",
    "trigger-webhook": "NodeData_WebhookData",  # irregular: no 'Node' in the def name
    "variable-aggregator": "NodeData_VariableAggregatorNodeData",
}

# def name → required fields demoted to stderr warnings (spec 038 D3). SHIPS EMPTY: whether
# Dify's importer rejects a missing required field or applies pydantic defaults is unknown until
# the P2 measurement — every row added here must cite 038-fp-report.md. `--demote` is the
# test-only seam across the subprocess boundary.
DEMOTED_REQUIRED: dict[str, set[str]] = {}

_REQUIRED_MSG_RE = re.compile(r"^'(.+?)' is a required property$")

# Escape-hatch marker (D3): COLUMN-0 full-line only — `[^\S\n]*` leading-whitespace tolerance
# (020's REACH_ALLOW_RE) is deliberately NOT copied, because an indented line can live inside a
# YAML block scalar; a column-0 `#` cannot (block-scalar content must be indented past its key).
ALLOW_RE = re.compile(r"^#\s*lint-bodies:\s*allow\s+(\S+)\s*$", re.MULTILINE)


def load_schema(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def coverage_rows(schema_path: Path) -> list[tuple[str, str, str]]:
    """→ [(node type, 'validated'|'warn-skip', def name or skip reason)] for every known type.

    The status column re-uses `lint_file`'s skip predicate verbatim (`def_name is None or
    '_error' in defs.get(def_name, {})`), so this listing IS the enforcement — not a second,
    hand-synced description of it that could drift (D4).
    """
    defs = load_schema(schema_path)["$defs"]
    rows: list[tuple[str, str, str]] = []
    for ntype, def_name in sorted(TYPE_TO_DEF.items()):
        if def_name is None:
            rows.append((ntype, "warn-skip", "no NodeData_* def dumped for this type"))
        elif "_error" in defs.get(def_name, {}):
            rows.append((ntype, "warn-skip", f"{def_name} is an `_error` dump-stub"))
        else:
            rows.append((ntype, "validated", def_name))
    return rows


def dump_schema(schema_path: Path, ntype: str) -> tuple[int, str]:
    """→ (exit code, output) for `--dump-schema <node-type>`: the node's NodeData_* def as JSON.

    WHY THIS EXISTS. `--list-coverage` names the def; nothing said what is IN it. The schema file is
    7,700+ lines with the def a turn needs sitting ~6,700 lines deep, and the Builder sandbox denies
    every extraction route — shell grep/rg, `python -c`, a throwaway probe script. Run 1784278684526
    (trigger-webhook, a node no pattern ships an example of) knew EXACTLY where the answer lived and
    still burned 44 turns: 13 denied greps, the 182KB file Read three times over, and finally this
    linter's source reverse-engineered. This flag is the sanctioned one-call answer that hunt was
    reaching for (it literally tried `--dump-schema` and `--help` before giving up).

    Unknown type → exit 2 AND the known-type list on stderr: "no output" must be distinguishable from
    "you misspelled it" (the find.py --has silence taught that lesson).

    A KNOWN type with no usable def (warn-skip, or an `_error` dump-stub) exits **0**: the caller asked
    a valid question and gets the valid answer — "this schema carries no detail, take the shape from a
    vetted source". Shipping that as exit 2 was a defect: run 1784388534562 called
    `--dump-schema http-request`, got exactly the right guidance, and saw it rendered `✗`. That reads to
    a turn as "rejected, try another route" — the hunt this flag exists to end — and it inflates the
    denied-call oracle (spec 071 S2), where a correct call must never count as thrash.
    """
    if ntype not in TYPE_TO_DEF:
        known = ", ".join(sorted(TYPE_TO_DEF))
        return 2, f"unknown node type '{ntype}'. Known types: {known}"
    def_name = TYPE_TO_DEF[ntype]
    if def_name is None:
        return 0, f"'{ntype}' is warn-skip: no NodeData_* def was dumped for it — take the shape from a vetted source (docs/runtime-supplement.md, templates/)"
    defs = load_schema(schema_path)["$defs"]
    body = defs.get(def_name, {})
    if "_error" in body:
        return 0, f"'{ntype}' maps to {def_name}, which is an `_error` dump-stub — take the shape from a vetted source"
    return 0, json.dumps({def_name: body}, indent=2, ensure_ascii=False)


def node_lines(text: str) -> dict[str, int]:
    """Map node id → 1-based line of the node's own mapping start, via a mark-capturing
    `yaml.compose` pass (spec 038 §Design: safe_load discards marks; lint_refs' regex-scan
    precedent does not transfer to locating a node's data block). Best-effort: any compose
    hiccup → empty map → findings fall back to a `path:` prefix without a line."""
    try:
        root = yaml.compose(text)
    except yaml.YAMLError:
        return {}

    def get(mapping: yaml.Node | None, key: str) -> yaml.Node | None:
        if not isinstance(mapping, yaml.MappingNode):
            return None
        for k, v in mapping.value:
            if isinstance(k, yaml.ScalarNode) and k.value == key:
                return v
        return None

    nodes = get(get(get(root, "workflow"), "graph"), "nodes")
    lines: dict[str, int] = {}
    if isinstance(nodes, yaml.SequenceNode):
        for item in nodes.value:
            nid = get(item, "id")
            if isinstance(nid, yaml.ScalarNode):
                lines[nid.value] = item.start_mark.line + 1
    return lines


@lru_cache(maxsize=None)
def _validator_for(def_name: str, schema_path: str) -> Draft202012Validator:
    defs = load_schema(Path(schema_path))["$defs"]
    # D1: validate the def as its OWN schema document — its nested `$defs` travel with it, so
    # every internal `#/$defs/...` ref resolves against the def, not the (unwired) root.
    return Draft202012Validator(defs[def_name])


# Unknown-key sweep (spec 038 P1 discipline, second application): pydantic's model_json_schema
# emits every model field into `properties`, so a top-level body key OUTSIDE them is either a typo
# (`queries` for `query`) or UI metadata the runtime ignores. The schema does NOT set
# `additionalProperties: false` (flipping that would hard-gate an unmeasured surface), so today
# these keys pass silently and a misnamed field surfaces only at Dify runtime. `--report-unknown-keys`
# surfaces them as stderr WARNINGS (never findings, never exit≠0) so the FP rate can be MEASURED
# over the indexed surface first; promotion to a finding — or per-def strictness — is a later,
# report-backed decision (the 038-fp-report precedent). `type` is the dispatch envelope key
# (27/29 defs don't carry it) — structurally exempt. The other three are FRONTEND metadata the
# runtime models never declare, measured present across the whole indexed surface (2026-08-05
# sweep): `selected` (canvas selection state, on nearly every corpus node), `isInIteration` +
# `iteration_id` (iteration-child markers on any node inside an iteration container).
#
# THE MEASUREMENT that gates promoting this probe to a real finding (2026-08-05, whole indexed
# surface: patterns + library + corpus): **0 real typos**. After exempting the three frontend keys
# above, everything left is a closed set of two kinds, NEITHER of which is a mistake:
#   (a) `variables` on llm/answer/parameter-extractor — legacy DSL 0.1.x, only ever seen in corpus;
#   (b) REAL runtime fields missing from the schema dump — `output_type`/`height`/`width`/
#       `startNodeType`/`iterator_input_type` (IterationNodeData), `is_array_file`
#       (DocumentExtractor), `instructions`/`topics` (QuestionClassifier), `item_var_type`/
#       `var_type` (ListOperator), `isIterationStart`.
# Promotion to a finding stays BLOCKED until gen_schema dumps those fields: exempting real runtime
# fields per-def would be lying about the schema. Keep the flag opt-in and re-measure after every
# schema regeneration.
UNKNOWN_KEY_EXEMPT = {"type", "selected", "isInIteration", "iteration_id"}


def _unknown_keys(body: dict, def_schema: dict) -> list[str]:
    props = def_schema.get("properties")
    if not isinstance(props, dict) or not props:
        return []  # a def with no properties dump gives no basis to judge — never guess
    return sorted(k for k in body if k not in props and k not in UNKNOWN_KEY_EXEMPT)


def lint_file(
    path: Path, schema_path: Path, demoted: dict[str, set[str]], report_unknown: bool = False
) -> tuple[int, list[str], list[str]]:
    """→ (exit_code, findings→stdout, warnings→stderr) for one file."""
    errors: list[str] = []
    warnings: list[str] = []

    try:
        text = path.read_text(encoding="utf-8")
        data = yaml.safe_load(text)
    except (OSError, yaml.YAMLError) as exc:
        return 2, [], [f"{path}: cannot parse — {str(exc).splitlines()[0]}"]
    if not isinstance(data, dict):
        return 2, [], [f"{path}: top level is not a mapping"]

    nodes = (((data.get("workflow") or {}).get("graph") or {}).get("nodes")) or []
    if not isinstance(nodes, list):
        return 2, [], [f"{path}: workflow.graph.nodes is not a list"]

    defs = load_schema(schema_path)["$defs"]
    lines = node_lines(text)
    allowed = set(ALLOW_RE.findall(text))
    code = 0

    for node in nodes:
        if not isinstance(node, dict):
            return 2, [], [f"{path}: non-mapping entry in workflow.graph.nodes: {node!r}"]
        body = node.get("data")
        if not isinstance(body, dict):
            continue  # envelope-level concern (check-jsonschema); nothing to body-check
        ntype = body.get("type")
        if not ntype or not isinstance(ntype, str):
            continue  # sticky note / annotation — silent skip (matches build_node_map)

        def_name = TYPE_TO_DEF.get(ntype)
        if def_name is None or "_error" in defs.get(def_name, {}):
            warnings.append(
                f"{path}: no usable schema for node type '{ntype}' — skipping body validation"
            )
            continue

        nid = str(node.get("id", "?"))
        prefix = f"{path}:{lines[nid]}" if nid in lines else f"{path}"
        if report_unknown:
            unknown = _unknown_keys(body, defs[def_name])
            if unknown:
                warnings.append(
                    f"{path}: node '{nid}' ({ntype}): unknown top-level key(s) not in "
                    f"{def_name}.properties: {', '.join(unknown)}"
                )
        validator = _validator_for(def_name, str(schema_path))
        node_findings: list[str] = []
        for err in sorted(validator.iter_errors(body), key=lambda e: (e.json_path, e.message)):
            missing = _REQUIRED_MSG_RE.match(err.message)
            if (
                err.validator == "required"
                and missing
                and missing.group(1) in demoted.get(def_name, set())
            ):
                warnings.append(
                    f"{path}: node '{nid}' ({ntype}): demoted required field "
                    f"'{missing.group(1)}' missing ({err.json_path})"
                )
                continue
            msg = " ".join(err.message.split())  # single line, collapsed whitespace
            node_findings.append(f"{prefix}: node '{nid}' ({ntype}): {err.json_path}: {msg}")
        if node_findings and nid in allowed:
            warnings.append(
                f"{path}: node '{nid}' ({ntype}): {len(node_findings)} finding(s) suppressed "
                f"by '# lint-bodies: allow' marker"
            )
            continue
        if node_findings:
            errors.extend(node_findings)
            code = 1

    return code, errors, warnings


def main(argv: list[str]) -> int:
    schema_path = DEFAULT_SCHEMA
    demoted: dict[str, set[str]] = {k: set(v) for k, v in DEMOTED_REQUIRED.items()}
    files: list[str] = []
    list_coverage = False
    report_unknown = False

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--list-coverage":
            list_coverage = True
            i += 1
        elif arg == "--report-unknown-keys":
            report_unknown = True
            i += 1
        elif arg == "--dump-schema":
            if i + 1 >= len(argv):
                print("usage: --dump-schema requires a node type (e.g. trigger-webhook)", file=sys.stderr)
                return 2
            if not schema_path.exists():
                print(f"{schema_path}: schema file not found", file=sys.stderr)
                return 2
            code, out = dump_schema(schema_path, argv[i + 1])
            print(out, file=sys.stderr if code else sys.stdout)
            return code
        elif arg == "--schema":
            if i + 1 >= len(argv):
                print("usage: --schema requires a path", file=sys.stderr)
                return 2
            schema_path = Path(argv[i + 1])
            i += 2
        elif arg == "--demote":
            if i + 1 >= len(argv) or ":" not in argv[i + 1]:
                print("usage: --demote requires DEF:FIELD", file=sys.stderr)
                return 2
            def_name, field = argv[i + 1].split(":", 1)
            demoted.setdefault(def_name, set()).add(field)
            i += 2
        else:
            files.append(arg)
            i += 1

    if list_coverage:
        if not schema_path.exists():
            print(f"{schema_path}: schema file not found", file=sys.stderr)
            return 2
        for ntype, status, detail in coverage_rows(schema_path):
            print(f"{ntype:<22} {status:<10} {detail}")
        return 0

    if not files:
        print(
            "usage: lint_node_bodies.py [--schema <path>] [--demote DEF:FIELD ...] "
            "<file.yml> [<file.yml> ...]\n"
            "       lint_node_bodies.py --list-coverage [--schema <path>]\n"
            "       lint_node_bodies.py --dump-schema <node-type>   # the NodeData_* def, one call",
            file=sys.stderr,
        )
        return 2
    if not schema_path.exists():
        print(f"{schema_path}: schema file not found", file=sys.stderr)
        return 2

    overall = 0
    for arg in files:
        path = Path(arg)
        if not path.exists():
            print(f"{path}: file not found", file=sys.stderr)
            overall = max(overall, 2)
            continue
        code, errors, warnings = lint_file(path, schema_path, demoted, report_unknown)
        for w in warnings:
            print(f"warning: {w}", file=sys.stderr)
        for e in errors:
            print(e)
        overall = max(overall, code)
    return overall


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

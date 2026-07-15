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

Usage:
    python3 tools/dify_base/lint_node_bodies.py [--schema <path>] [--demote DEF:FIELD ...] \\
        <file.yml> [<file.yml> ...]

    --schema  override the pinned schema (default: schemas/dify-dsl-0.6.0.json at the repo root;
              `schemas/_latest.json` serves ad-hoc runs against a fresh regeneration)
    --demote  treat DEF's missing-required FIELD as a stderr warning instead of a finding —
              the subprocess-boundary test seam for DEMOTED_REQUIRED (D3); shipped rows must
              cite the P2 report

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


def lint_file(
    path: Path, schema_path: Path, demoted: dict[str, set[str]]
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

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--schema":
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

    if not files:
        print(
            "usage: lint_node_bodies.py [--schema <path>] [--demote DEF:FIELD ...] "
            "<file.yml> [<file.yml> ...]",
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
        code, errors, warnings = lint_file(path, schema_path, demoted)
        for w in warnings:
            print(f"warning: {w}", file=sys.stderr)
        for e in errors:
            print(e)
        overall = max(overall, code)
    return overall


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

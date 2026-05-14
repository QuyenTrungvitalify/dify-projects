#!/usr/bin/env python3
"""Variable reference linter for Dify workflow YAMLs.

Per spec docs/specs/003-variable-ref-linter.md.

Cross-checks `{{#node_id.field#}}` template refs and `value_selector: [id, field]`
arrays against per-node-type output schemas.

Usage:
    python3 tools/dify_base/lint_refs.py <file.yml> [<file.yml> ...]

Exit codes:
    0 — clean
    1 — at least one broken reference
    2 — usage error / YAML parse error / file not found
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import yaml

REF_PATTERN = re.compile(r"\{\{#([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)(?:\.[A-Za-z0-9_.]*)?#\}\}")
SPECIAL_NS = {"conversation", "env", "sys"}

IMPLICIT_OUTPUTS: dict[str, set[str]] = {
    "llm": {"text", "usage", "finish_reason"},
    "http-request": {"body", "status_code", "headers", "files"},
    "tool": {"text", "files", "json"},
    "document-extractor": {"text"},
    "knowledge-retrieval": {"result"},
    "question-classifier": {"class_name", "class_id"},
    "agent": {"text", "usage"},
    "template-transform": {"output"},
    "list-operator": {"result"},
}

KNOWN_NODE_TYPES = (
    IMPLICIT_OUTPUTS.keys()
    | {
        "start",
        "code",
        "parameter-extractor",
        "variable-aggregator",
        "variable-assigner",
        "iteration",
        "loop",
        "if-else",
        "answer",
        "end",
        "assigner",
        "iteration-start",
        "loop-start",
    }
)


def collect_outputs(node_data: dict) -> set[str] | None:
    """Return the set of valid output field names for a node.

    Returns `None` for unknown node types (skip validation, log warning).
    Returns a set (possibly empty) for known types.
    Code/HTTP nodes get implicit `error_message` + `error_type` when fail-branch
    is configured.
    """
    ntype = node_data.get("type")
    fields: set[str] = set()

    if ntype == "start":
        for v in node_data.get("variables", []) or []:
            name = v.get("variable")
            if name:
                fields.add(name)
        return fields

    if ntype == "code":
        outputs = node_data.get("outputs") or {}
        if isinstance(outputs, dict):
            fields.update(outputs.keys())
        if node_data.get("error_strategy") == "fail-branch":
            fields.update({"error_message", "error_type"})
        return fields

    if ntype == "http-request":
        fields.update(IMPLICIT_OUTPUTS["http-request"])
        if node_data.get("error_strategy") == "fail-branch":
            fields.update({"error_message", "error_type"})
        return fields

    if ntype == "parameter-extractor":
        for p in node_data.get("parameters", []) or []:
            name = p.get("name")
            if name:
                fields.add(name)
        return fields

    if ntype in {"variable-aggregator", "variable-assigner"}:
        # variable-aggregator exposes `output` (single aggregated value), and
        # also accepts ref via the declared variable names. We accept both.
        fields.add("output")
        for v in node_data.get("variables", []) or []:
            if isinstance(v, dict):
                name = v.get("variable")
                if name:
                    fields.add(name)
        return fields

    if ntype == "iteration":
        fields.add("output")
        fields.add("item")  # for refs from inside the iteration body
        out_sel = node_data.get("output_selector")
        if isinstance(out_sel, list) and out_sel:
            fields.add(str(out_sel[-1]))
        return fields

    if ntype == "loop":
        fields.add("output")
        outputs = node_data.get("outputs") or {}
        if isinstance(outputs, dict):
            fields.update(outputs.keys())
        return fields

    if ntype in {"if-else", "answer", "end", "assigner", "iteration-start", "loop-start"}:
        return fields  # produce no usable outputs for refs

    if ntype in IMPLICIT_OUTPUTS:
        return set(IMPLICIT_OUTPUTS[ntype])

    return None  # unknown — skip validation


def build_node_map(nodes: list[dict]) -> tuple[dict[str, set[str] | None], list[str]]:
    """Build {node_id: outputs_set_or_None}. Returns (map, unknown_type_warnings).

    Empty `data.type` (sticky-note / annotation nodes) silently skipped.
    """
    node_map: dict[str, set[str] | None] = {}
    warnings: list[str] = []
    for node in nodes or []:
        nid = node.get("id")
        if not nid:
            continue
        data = node.get("data") or {}
        ntype = data.get("type")
        outputs = collect_outputs(data)
        node_map[str(nid)] = outputs
        if outputs is None and ntype:  # only warn for real-but-unknown types
            warnings.append(f"unknown node type '{ntype}' for node '{nid}' — skipping ref validation")
    return node_map, warnings


def walk_value_selectors(obj, path: tuple = ()):
    """Yield (value_selector_list, path) tuples found anywhere in the YAML tree."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "value_selector" and isinstance(v, list) and len(v) >= 2:
                yield v, path + (k,)
            else:
                yield from walk_value_selectors(v, path + (str(k),))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            yield from walk_value_selectors(item, path + (f"[{i}]",))


def lint_file(yaml_path: Path) -> tuple[int, list[str], list[str]]:
    """Lint one file. Return (exit_code, errors, warnings)."""
    try:
        text = yaml_path.read_text(encoding="utf-8")
    except OSError as exc:
        return 2, [f"{yaml_path}: cannot read — {exc}"], []

    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        return 2, [f"{yaml_path}: parse error — {exc}"], []

    if not isinstance(data, dict):
        return 0, [], []

    graph = ((data.get("workflow") or {}).get("graph") or {}) if isinstance(data.get("workflow"), dict) else {}
    nodes = graph.get("nodes") or []
    if not isinstance(nodes, list):
        return 0, [], []

    node_map, warnings = build_node_map(nodes)
    errors: list[str] = []

    # 1. Inline {{#X.Y#}} refs — scan whole text (covers multi-line scalars).
    for line_no, line in enumerate(text.splitlines(), 1):
        for match in REF_PATTERN.finditer(line):
            node_id, field = match.group(1), match.group(2)
            if node_id in SPECIAL_NS:
                continue
            ref_str = f"{{{{#{node_id}.{field}#}}}}"
            outputs = node_map.get(node_id, "MISSING")
            if outputs == "MISSING":
                errors.append(
                    f"{yaml_path}:{line_no}: {ref_str} → node '{node_id}' not found in workflow"
                )
            elif outputs is None:
                continue  # unknown type, already warned
            elif field not in outputs:
                known = sorted(outputs) if outputs else []
                errors.append(
                    f"{yaml_path}:{line_no}: {ref_str} → field '{field}' not in outputs of node '{node_id}' (known: {known})"
                )

    # 2. value_selector: [id, field] arrays.
    for selector, _path in walk_value_selectors(data):
        node_id = str(selector[0])
        field = str(selector[1])
        if node_id in SPECIAL_NS:
            continue
        sel_str = f"value_selector: [{node_id!r}, {field!r}]"
        outputs = node_map.get(node_id, "MISSING")
        if outputs == "MISSING":
            errors.append(f"{yaml_path}: {sel_str} → node '{node_id}' not found in workflow")
        elif outputs is None:
            continue
        elif field not in outputs:
            known = sorted(outputs) if outputs else []
            errors.append(
                f"{yaml_path}: {sel_str} → field '{field}' not in outputs of node '{node_id}' (known: {known})"
            )

    return (1 if errors else 0), errors, warnings


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: lint_refs.py <file.yml> [<file.yml> ...]", file=sys.stderr)
        return 2

    overall = 0
    for arg in argv:
        path = Path(arg)
        if not path.exists():
            print(f"{path}: file not found", file=sys.stderr)
            overall = max(overall, 2)
            continue
        code, errors, warnings = lint_file(path)
        for w in warnings:
            print(f"warning: {path}: {w}", file=sys.stderr)
        for e in errors:
            print(e)
        overall = max(overall, code)
    return overall


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

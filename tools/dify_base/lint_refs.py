#!/usr/bin/env python3
"""Variable reference linter for Dify workflow YAMLs.

Per spec docs/specs/003-variable-ref-linter.md.

Cross-checks `{{#node_id.field#}}` template refs and `value_selector: [id, field]`
arrays against per-node-type output schemas.

Usage:
    python3 tools/dify_base/lint_refs.py <file.yml> [<file.yml> ...]

Exit codes:
    0 — clean
    1 — at least one broken reference (unknown node/field, or — spec 020 — a forward/unreachable ref)
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

# (The old known-node-types constant was deleted — spec 038 D2: dead code with no consumer; the
# authoritative node-type list is now lint_node_bodies.TYPE_TO_DEF, drift-tested against the
# schema and bound to IMPLICIT_OUTPUTS via tests/test_lint_node_bodies.py.)


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


# ── O1 (spec 020): graph-reachability check (warn-only) ──────────────────────────────────────────
# Beyond "node id exists" + "field is a declared output", a `{{#S.field#}}` ref is only valid if the
# source node S is UPSTREAM-reachable to its consumer C (S runs before C; no forward/dangling ref) —
# AGENTS.md §4.2's "#1 cause of silent import success + runtime failure". This pass verifies that over
# the `graph.edges[]` DAG, with the Dify-shape carve-outs the corpus actually needs (see exclusions).
CONTAINER_START_TYPES = {"iteration-start", "loop-start"}
# Spec 057: trigger nodes are first-class workflow entries (Dify 1.10+, DSL unchanged at 0.6.0).
# They anchor reachability exactly like `start` — without this, a trigger-entry workflow had EMPTY
# roots and the spec-020 reachability gate silently disabled itself (proven in the 057 review).
ENTRY_TYPES = {"start", "trigger-schedule", "trigger-webhook", "trigger-plugin"}
# Escape-hatch marker: a FULL-LINE comment `# lint-refs: allow-reach <id>.<field>[, <id>.<field>...]`
# suppresses a specific reachability finding (the rare legitimate graph shape the BFS can't model).
# Anchored to line-start (`^\s*#`, MULTILINE) so a `#` inside a quoted string/prompt can't forge a marker.
REACH_ALLOW_RE = re.compile(r"^[^\S\n]*#\s*lint-refs:\s*allow-reach\s+([^\n#]+)", re.MULTILINE)
# Sentinel in the no-root advisory message: it is informational ("couldn't check"), never a gate error.
REACH_ADVISORY = "reachability NOT checked"


def _iter_refs(obj):
    """Yield (source_id, field) for every `{{#id.field#}}` in any string AND every
    `value_selector: [id, field]` array found anywhere under `obj`."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "value_selector" and isinstance(v, list) and len(v) >= 2:
                yield str(v[0]), str(v[1])
            else:
                yield from _iter_refs(v)
    elif isinstance(obj, list):
        for item in obj:
            yield from _iter_refs(item)
    elif isinstance(obj, str):
        for m in REF_PATTERN.finditer(obj):
            yield m.group(1), m.group(2)


def _bfs(adj: dict[str, list[str]], seeds: list[str]) -> set[str]:
    """Forward closure: every node reachable from `seeds` over `adj`."""
    seen: set[str] = set(seeds)
    stack = list(seeds)
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, []):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def _parse_reach_allowlist(text: str) -> set[tuple[str, str]]:
    """Escape hatch (spec 020): collect `(source_id, field)` pairs the file marks as intentionally
    allowed via `# lint-refs: allow-reach <id>.<field>[, <id>.<field> ...]` comments. `field` is the
    first segment after the id (matching REF_PATTERN's captured field)."""
    allow: set[tuple[str, str]] = set()
    for m in REACH_ALLOW_RE.finditer(text):
        for tok in re.split(r"[,\s]+", m.group(1).strip()):
            sid, _, rest = tok.partition(".")
            field = rest.split(".")[0]
            if sid and field:
                allow.add((sid, field))
    return allow


def check_reachability(data: dict, yaml_path: Path, allow: set[tuple[str, str]] | None = None) -> list[str]:
    """O1 (spec 020) — WARN-ONLY advisory: every `{{#S.field#}}` / value_selector source must be an
    upstream ancestor of its consumer node. Never raises; returns human findings.

    Exclusions (see spec 020):
      E1  sys/env/conversation selectors    — not node outputs, no ordering applies
      E2  source is an iteration/loop-start  — synthetic container entry, refs to it are fine
      E3  consumer is inside a container     — its refs resolve in the container scope, not the main DAG

    KNOWN LIMITATION (spec 020 Mục 3, deferred): because E3 skips *every* container-body consumer, a
    forward ref BETWEEN two nodes inside the same iteration/loop body is NOT caught. Catching those needs
    per-container sub-graph reachability — a v2 follow-up.

    `variable-aggregator`/`answer` use the same strict ancestor rule as everything else: the measurement
    (docs/specs/020-fp-report.md) showed the earlier weaker "reachable-from-any-start" rule prevented 0
    false positives on the corpus while hiding real forward refs, so it was dropped. The escape hatch
    (`allow`) covers any rare legitimate cross-branch shape the strict rule would over-flag.
    """
    allow = allow or set()
    graph = ((data.get("workflow") or {}).get("graph") or {}) if isinstance(data.get("workflow"), dict) else {}
    nodes = graph.get("nodes") or []
    edges = graph.get("edges") or []
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return []

    node_type: dict[str, str | None] = {}
    in_container: dict[str, bool] = {}
    for n in nodes:
        if not isinstance(n, dict):
            continue
        nid = n.get("id")
        if not nid:
            continue
        d = n.get("data") or {}
        node_type[str(nid)] = d.get("type")
        in_container[str(nid)] = bool(d.get("isInIteration") or d.get("isInLoop"))

    adj: dict[str, list[str]] = {}
    radj: dict[str, list[str]] = {}
    for e in edges:
        if not isinstance(e, dict):
            continue
        s, t = e.get("source"), e.get("target")
        if s is None or t is None:
            continue
        adj.setdefault(str(s), []).append(str(t))
        radj.setdefault(str(t), []).append(str(s))

    def _qualifying_refs(node: dict):
        """node-to-node refs in `node.data` that the reachability rule actually judges (after E1/E2)."""
        for sid, field in _iter_refs(node.get("data") or {}):
            if sid in SPECIAL_NS:                            # E1
                continue
            if sid not in node_type:                         # not-found is the existing check's job
                continue
            if node_type.get(sid) in CONTAINER_START_TYPES:  # E2
                continue
            yield sid, field

    # Roots = entry nodes (start | trigger-*, spec 057) + container entries (iteration/loop bodies
    # begin at their *-start). Without an anchor we cannot judge reachability — but DON'T silently
    # skip (spec 020 Mục 5): if the file still carries node-to-node refs, surface an advisory so a
    # mislabeled entry node isn't a blind spot.
    roots = [nid for nid, ty in node_type.items() if ty in ENTRY_TYPES or ty in CONTAINER_START_TYPES]
    if not roots:
        for n in nodes:
            if not isinstance(n, dict) or not n.get("id"):
                continue
            for sid, field in _qualifying_refs(n):
                return [
                    f"{yaml_path}: no start/trigger/container-start node — {REACH_ADVISORY} "
                    f"(found node-to-node ref {{{{#{sid}.{field}#}}}}; add an entry node (start or trigger-*) or verify the graph)"
                ]
        return []

    findings: list[str] = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        cid = n.get("id")
        if not cid:
            continue
        cid = str(cid)
        if in_container.get(cid):  # E3
            continue
        ctype = node_type.get(cid)
        ancestors = _bfs(radj, [cid]) - {cid}
        for sid, field in _qualifying_refs(n):
            if sid == cid:                  # defensive: self-ref
                continue
            if (sid, field) in allow:       # escape hatch
                continue
            if sid not in ancestors:        # strict: S must run before C
                findings.append(
                    f"{yaml_path}: {{{{#{sid}.{field}#}}}} in node '{cid}'"
                    f"{f' ({ctype})' if ctype else ''} → source not upstream-reachable"
                )
    return findings


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

    # 3. O1 (spec 020 phase 3): graph-reachability — forward/dangling refs over the edge DAG now GATE by
    # default (same exit code as a broken ref; the message distinguishes them — spec 020 Q4). The no-root
    # advisory ("couldn't check") is NOT a hard failure here — it's surfaced only by the explicit
    # `--check-reachability` mode, so an un-anchorable file is never gated on something we couldn't verify.
    for finding in check_reachability(data, yaml_path, _parse_reach_allowlist(text)):
        if REACH_ADVISORY not in finding:
            errors.append(finding)

    return (1 if errors else 0), errors, warnings


def main(argv: list[str]) -> int:
    # O1 (spec 020) phase 3 (PROMOTED): the default invocation now GATES on graph-reachability — a
    # forward/dangling ref contributes to exit code 1, flowing through `lintClean` + pre-commit. The
    # `--check-reachability` flag remains a reachability-ONLY, non-gating view (prints, exits 0) for
    # isolated/debug runs and for surfacing the no-root advisory.
    if "--check-reachability" in argv:
        for arg in (a for a in argv if a != "--check-reachability"):
            path = Path(arg)
            if not path.exists():
                print(f"{path}: file not found", file=sys.stderr)
                continue
            try:
                text = path.read_text(encoding="utf-8")
                data = yaml.safe_load(text)
            except (OSError, yaml.YAMLError) as exc:
                print(f"warning: {path}: cannot parse — {exc}", file=sys.stderr)
                continue
            if isinstance(data, dict):
                for finding in check_reachability(data, path, _parse_reach_allowlist(text)):
                    print(f"reachability: {finding}")
        return 0  # WARN-ONLY: never gate

    if not argv:
        print("usage: lint_refs.py [--check-reachability] <file.yml> [<file.yml> ...]", file=sys.stderr)
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

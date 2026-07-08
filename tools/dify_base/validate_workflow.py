#!/usr/bin/env python3
"""
Dify Workflow DSL Validator (vendored, canonical).

Validates the structure and syntax of Dify workflow DSL YAML files.

VENDORED (spec 026): this is the repo's CANONICAL, version-controlled copy of the structural
validator. It originated in the external `mango-svip` skill clone
(`skills/mango-svip/scripts/validate_workflow.py`), which is gitignored and read-only — its upstream
(github.com/mango-svip/dify-workflow-skills) carries NEITHER the spec-017 `cases[]` coherence check
NOR the spec-026 N1/V1 checks, so those customizations lived only as uncommitted local edits that a
fresh `setup.sh` clone (e.g. CI) would not have. Vendoring it here makes the pre-commit gate
(`dify-skill-validate`) and the pinning tests (`tests/test_validate_workflow.py`) deterministic and
durable. Sits alongside the other tracked gates (`lint_refs.py`, `lint_plugin_hashes.py`).

NOTE: the builder (`apps/builder`, localhost-only) still invokes the skill-clone copy via its linter
registry + permission allowlist + phase prompts. Repointing those to this file is a clean follow-up
(see spec 026 revision log) — until then keep the two copies in sync.
"""

import re
import yaml
import sys
from typing import Dict, List, Any, Tuple

# N1 (spec 026): Dify's template engine only resolves NUMERIC-timestamp node ids — a string id like
# `node-code-1` makes `{{#node-code-1.text#}}` render as a LITERAL string at runtime, no error, no
# warning (AGENTS.md §9 pitfall 2026-05-21; the repo's #1 silent-failure class). The only legitimate
# non-pure-numeric form is the container-start child `<iteration_id>start` (AGENTS.md §4.1). Generate
# ids via skills/mango-svip/scripts/generate_id.py. `REF_PATTERN` in lint_refs.py can't enforce this
# (refs legitimately target sys/env/conversation) — the format check belongs only here, in the
# node-definition loop.
NODE_ID_RE = re.compile(r"^\d+(start)?$")


class WorkflowValidator:
    def __init__(self):
        self.errors = []
        self.warnings = []
        self.app_mode = None  # set in _validate_app; drives end-vs-answer terminal-node rule

    def validate(self, file_path: str) -> Tuple[bool, List[str], List[str]]:
        """
        Validate a Dify workflow DSL file.

        Returns:
            Tuple of (is_valid, errors, warnings)
        """
        self.errors = []
        self.warnings = []

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
        except FileNotFoundError:
            self.errors.append(f"File not found: {file_path}")
            return False, self.errors, self.warnings
        except yaml.YAMLError as e:
            self.errors.append(f"YAML parsing error: {str(e)}")
            return False, self.errors, self.warnings

        # Validate top-level structure
        self._validate_top_level(data)

        # Validate app section
        if 'app' in data:
            self._validate_app(data['app'])

        # Validate workflow section
        if 'workflow' in data:
            self._validate_workflow(data['workflow'])

        is_valid = len(self.errors) == 0
        return is_valid, self.errors, self.warnings

    def _validate_top_level(self, data: Dict):
        """Validate top-level structure."""
        required_fields = ['kind', 'version', 'app', 'workflow']
        for field in required_fields:
            if field not in data:
                self.errors.append(f"Missing required top-level field: {field}")

        if data.get('kind') != 'app':
            self.errors.append(f"Invalid 'kind' value: expected 'app', got '{data.get('kind')}'")

    def _validate_app(self, app: Dict):
        """Validate app section."""
        required_fields = ['name', 'mode']
        for field in required_fields:
            if field not in app:
                self.errors.append(f"Missing required app field: {field}")

        # Accept both Dify app modes that this validator covers: 'workflow' (terminates at an
        # 'end' node) and 'advanced-chat'/chatflow (terminates at an 'answer' node). The
        # terminal-node requirement is enforced per-mode in _validate_workflow.
        self.app_mode = app.get('mode')
        if self.app_mode not in ('workflow', 'advanced-chat'):
            self.errors.append(
                f"Invalid app mode: expected 'workflow' or 'advanced-chat', got '{self.app_mode}'")

    def _validate_workflow(self, workflow: Dict):
        """Validate workflow section."""
        # Spec 049 D1: the variables block validates FIRST (and unconditionally) — a broken entry
        # hard-fails the whole Dify import even when the graph is perfect, so it must be reported
        # even when the graph checks below early-return.
        self._validate_variables_block(workflow)

        required_fields = ['graph']
        for field in required_fields:
            if field not in workflow:
                self.errors.append(f"Missing required workflow field: {field}")
                return

        graph = workflow['graph']

        # Validate graph structure
        if 'nodes' not in graph:
            self.errors.append("Missing 'nodes' in graph")
            return
        if 'edges' not in graph:
            self.errors.append("Missing 'edges' in graph")
            return

        nodes = graph['nodes']
        edges = graph['edges']

        # V1 (spec 026): a hard gate must DIAGNOSE malformed input, not stack-trace on it. If
        # `nodes`/`edges` aren't lists the loops below would crash — fail with a clear error instead.
        if not isinstance(nodes, list):
            self.errors.append("Graph 'nodes' must be a list")
            return
        if not isinstance(edges, list):
            self.errors.append("Graph 'edges' must be a list")
            return

        # D1 (spec 017): map each node's outgoing edge handles so the if-else `cases[]` check can
        # confirm a case routes to a real branch. `sourceHandle` is the case id ('true'/'false'/…).
        edge_handles: Dict[str, set] = {}
        for edge in edges if isinstance(edges, list) else []:
            if not isinstance(edge, dict):
                continue
            src = edge.get('source')
            handle = edge.get('sourceHandle')
            if src is not None and handle is not None:
                edge_handles.setdefault(str(src), set()).add(str(handle))

        # Validate nodes
        node_ids = set()
        has_start = False
        has_end = False
        has_answer = False

        for i, node in enumerate(nodes):
            # V1 (spec 026): non-dict node entry → structured error, not an AttributeError traceback.
            if not isinstance(node, dict):
                self.errors.append(f"Node at index {i} is not a mapping")
                continue

            node_id = node.get('id')
            if not node_id:
                self.errors.append(f"Node at index {i} missing 'id'")
                continue

            # N1 (spec 026): node id must be numeric-timestamp (or the `<id>start` container-start
            # child). A string id silently renders refs as literals at runtime (AGENTS.md §9).
            if not NODE_ID_RE.match(str(node_id)):
                self.errors.append(
                    f"Node '{node_id}' has a non-numeric id — Dify resolves only numeric-timestamp "
                    f"ids (or the '<id>start' container child); refs to it render as literal strings "
                    f"at runtime. Generate via generate_id.py (AGENTS.md §4.1)."
                )

            if node_id in node_ids:
                self.errors.append(f"Duplicate node ID: {node_id}")
            node_ids.add(node_id)

            # Check node type
            if 'data' not in node:
                self.errors.append(f"Node {node_id} missing 'data'")
                continue

            node_type = node['data'].get('type')
            if not node_type:
                self.errors.append(f"Node {node_id} missing type")
                continue

            if node_type == 'start':
                has_start = True
                self._validate_start_node(node_id, node['data'])
            elif node_type == 'end':
                has_end = True
                self._validate_end_node(node_id, node['data'])
            elif node_type == 'answer':
                has_answer = True
            elif node_type == 'llm':
                self._validate_llm_node(node_id, node['data'])
            elif node_type == 'code':
                self._validate_code_node(node_id, node['data'])
            elif node_type == 'variable-aggregator':
                self._validate_aggregator_node(node_id, node['data'])
            elif node_type == 'if-else':
                self._validate_ifelse_node(node_id, node['data'], edge_handles.get(node_id))

        if not has_start:
            self.errors.append("Workflow must have at least one 'start' node")
        # Terminal node depends on app mode: chatflows (advanced-chat) end at an 'answer' node,
        # workflows end at an 'end' node.
        if self.app_mode == 'advanced-chat':
            if not has_answer:
                self.errors.append("Chatflow (advanced-chat) must have at least one 'answer' node")
        elif not has_end:
            self.errors.append("Workflow must have at least one 'end' node")

        # Validate edges
        for i, edge in enumerate(edges):
            # V1 (spec 026): non-dict edge entry → structured error, not an AttributeError traceback
            # (mirrors the existing guard in the edge_handles loop above).
            if not isinstance(edge, dict):
                self.errors.append(f"Edge at index {i} is not a mapping")
                continue

            source = edge.get('source')
            target = edge.get('target')

            if not source:
                self.errors.append(f"Edge at index {i} missing 'source'")
            elif source not in node_ids:
                self.errors.append(f"Edge references non-existent source node: {source}")

            if not target:
                self.errors.append(f"Edge at index {i} missing 'target'")
            elif target not in node_ids:
                self.errors.append(f"Edge references non-existent target node: {target}")

    def _validate_variables_block(self, workflow: Dict):
        """Spec 049 D1 — mirror Dify's import-time variable factory EXACTLY.

        `vendor/dify-src/api/factories/variable_factory.py` builds every
        `environment_variables` / `conversation_variables` entry via
        `build_environment_variable_from_mapping` / `build_conversation_variable_from_mapping`
        (both funnel into `_build_variable_from_mapping`), and each raises `VariableError` —
        which surfaces as HTTP 400 `status:'failed'` for the WHOLE import — on:
          * missing or empty `name`  → "missing name"   (the 2026-07-08 field incident: the model
            wrote the START-NODE INPUT shape `variable:` for an env var; all four linters passed
            and the import 400'd — this check is that incident's permanent red fixture);
          * `value_type` that is None → "missing value type";
          * `value` that is None      → "missing value"  (an EMPTY STRING is valid — Dify checks
            `is None`, mirrored exactly; a missing key or YAML null fails).
        """
        for section in ('environment_variables', 'conversation_variables'):
            entries = workflow.get(section)
            if entries is None:
                continue
            if not isinstance(entries, list):
                self.errors.append(f"'{section}' must be a list")
                continue
            for i, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    self.errors.append(f"{section}[{i}] is not a mapping")
                    continue
                label = entry.get('name') or entry.get('variable') or f"[{i}]"
                if not entry.get('name'):
                    if 'variable' in entry and 'name' not in entry:
                        self.errors.append(
                            f"{section} entry '{entry.get('variable')}' uses 'variable:' — "
                            f"{section} entries use 'name:' ('variable:' is the start-node input "
                            f"shape; Dify import fails with \"missing name\")"
                        )
                    else:
                        self.errors.append(f"{section} entry {label} missing or empty 'name'")
                if entry.get('value_type') is None:
                    self.errors.append(f"{section} entry '{label}' missing 'value_type'")
                if entry.get('value') is None:
                    self.errors.append(
                        f"{section} entry '{label}' missing 'value' (empty string '' is valid; "
                        f"a missing key or YAML null fails the Dify import)"
                    )

    def _validate_start_node(self, node_id: str, data: Dict):
        """Validate start node."""
        if 'variables' not in data:
            self.warnings.append(f"Start node {node_id} has no variables defined")
        else:
            for var in data['variables']:
                if 'variable' not in var:
                    self.errors.append(f"Variable in start node {node_id} missing 'variable' name")
                if 'type' not in var:
                    self.errors.append(f"Variable '{var.get('variable', '?')}' in start node {node_id} missing 'type'")

    def _validate_end_node(self, node_id: str, data: Dict):
        """Validate end node."""
        if 'outputs' not in data:
            self.warnings.append(f"End node {node_id} has no outputs defined")
        else:
            for output in data['outputs']:
                if 'variable' not in output:
                    self.errors.append(f"Output in end node {node_id} missing 'variable' name")
                if 'value_selector' not in output:
                    self.errors.append(f"Output '{output.get('variable', '?')}' in end node {node_id} missing 'value_selector'")

    def _validate_llm_node(self, node_id: str, data: Dict):
        """Validate LLM node."""
        if 'model' not in data:
            self.errors.append(f"LLM node {node_id} missing 'model' configuration")
        else:
            model = data['model']
            required = ['provider', 'name', 'mode']
            for field in required:
                if field not in model:
                    self.errors.append(f"LLM node {node_id} model missing '{field}'")

        if 'prompt_template' not in data:
            self.errors.append(f"LLM node {node_id} missing 'prompt_template'")
        elif not data['prompt_template']:
            self.warnings.append(f"LLM node {node_id} has empty prompt_template")

    def _validate_code_node(self, node_id: str, data: Dict):
        """Validate code node."""
        required = ['code', 'code_language']
        for field in required:
            if field not in data:
                self.errors.append(f"Code node {node_id} missing '{field}'")

        if 'code_language' in data and data['code_language'] not in ['python3', 'javascript']:
            self.errors.append(f"Code node {node_id} has invalid code_language: {data['code_language']}")

        if 'outputs' not in data:
            self.warnings.append(f"Code node {node_id} has no outputs defined")

    def _validate_aggregator_node(self, node_id: str, data: Dict):
        """Validate variable aggregator node."""
        if 'variables' not in data:
            self.errors.append(f"Variable aggregator node {node_id} missing 'variables'")
        elif not data['variables']:
            self.warnings.append(f"Variable aggregator node {node_id} has empty variables list")

        if 'output_type' not in data:
            self.errors.append(f"Variable aggregator node {node_id} missing 'output_type'")

    def _validate_ifelse_node(self, node_id: str, data: Dict, edge_handles=None):
        """Validate if-else node.

        The legacy top-level ``conditions`` check is historical (kept). Spec 017 D1 adds modern
        ``cases[]`` coherence: Dify 0.6.0 executes off ``cases``, so a node with only legacy
        ``conditions`` — or a malformed ``cases`` — lints clean today yet branches WRONG at runtime
        (AGENTS.md §9). Severity is split so a legacy-only-but-valid corpus file is not regressed
        (Q1, decided from the corpus where a legacy-only file is intentionally green):
          * a MISSING ``cases``                       → WARNING (legacy-only is tolerated, just risky);
          * a PRESENT-but-incoherent ``cases``        → ERROR (no green corpus file is in this state).
        ``edge_handles`` is the set of this node's outgoing ``sourceHandle`` values (or None when
        edge data is absent) — used only for the advisory case→edge routing check.
        """
        if 'conditions' not in data:
            self.errors.append(f"If-else node {node_id} missing 'conditions'")
        elif not data['conditions']:
            self.warnings.append(f"If-else node {node_id} has empty conditions list")

        # D1 (017): modern `cases[]` coherence.
        cases = data.get('cases')
        if cases is None:
            self.warnings.append(
                f"If-else node {node_id} has no modern 'cases' — Dify 0.6.0 branches off 'cases'; "
                f"emit BOTH legacy 'conditions' and 'cases' (AGENTS.md §9)"
            )
            return
        if not isinstance(cases, list) or not cases:
            self.errors.append(f"If-else node {node_id} has an empty or non-list 'cases'")
            return
        for i, case in enumerate(cases):
            if not isinstance(case, dict):
                self.errors.append(f"If-else node {node_id} case[{i}] is not a mapping")
                continue
            case_id = case.get('id') or case.get('case_id')
            label = case_id if case_id else f"[{i}]"
            if not case_id:
                self.errors.append(f"If-else node {node_id} case[{i}] missing 'id'/'case_id'")
            if 'logical_operator' not in case:
                self.warnings.append(f"If-else node {node_id} case {label} missing 'logical_operator'")
            if not case.get('conditions'):
                self.errors.append(f"If-else node {node_id} case {label} has empty/missing 'conditions'")
            # A case must route to an outgoing edge handle, else the branch goes nowhere. 'false'/'else'
            # are implicit else-branches in Dify, so this is advisory (warning) and only when we have
            # edge data for this node.
            if case_id and edge_handles and str(case_id) not in edge_handles:
                self.warnings.append(
                    f"If-else node {node_id} case {label} routes to no outgoing edge "
                    f"(sourceHandle='{case_id}')"
                )


def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_workflow.py <workflow.yml>")
        sys.exit(1)

    file_path = sys.argv[1]
    validator = WorkflowValidator()
    is_valid, errors, warnings = validator.validate(file_path)

    if warnings:
        print("⚠️  Warnings:")
        for warning in warnings:
            print(f"  - {warning}")
        print()

    if errors:
        print("❌ Validation failed with errors:")
        for error in errors:
            print(f"  - {error}")
        sys.exit(1)
    else:
        print("✅ Workflow validation passed!")
        sys.exit(0)


if __name__ == '__main__':
    main()

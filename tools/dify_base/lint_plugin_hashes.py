"""Lint plugin marketplace identifiers — FORMAT, and (spec 067 S5) COVERAGE.

Format: <provider>/<plugin>:<version>@<sha256>
- provider, plugin: [a-z0-9_]+
- version: semver (X.Y.Z)
- sha256: 64 hex chars

Coverage (spec 067 S5) — the converse check: a `type: tool` node whose plugin has NO entry in the
top-level `dependencies:`. The format check alone cannot see this (zero entries = zero checks), so an
empty `dependencies: []` used to clear all four gates silently. That is not a cosmetic gap: Dify only
raises its "install this plugin" prompt when the imported DSL carries a NON-EMPTY top-level
`dependencies:` array — the graph-derived fallback is dead above DSL 0.1.5
(vendor/dify-src/api/services/app_dsl_service.py:272-285). So a tool node without its dependency
imports cleanly, prompts nothing, and fails at RUNTIME with no explanation. Resolve the identifier
(tools/dify_base/marketplace.py) and list it.

Usage: lint_plugin_hashes.py <file.yml> [<file.yml> ...]
"""
import re
import sys
from pathlib import Path

import yaml

PATTERN = re.compile(
    r"^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$"
)

# `builtin` IS the marketplace type — NOT `plugin`. Dify dispatches BUILT_IN to the
# PluginToolProviderController (vendor/dify-src tool_manager.py:985-987) and every real tool node in
# corpus/ uses it; `plugin` appears in the enum but not in exports. An earlier draft skipped everything
# that was not `plugin`, which made the coverage gate a NO-OP on every real tool node.
# `workflow` (a workspace-local sub-workflow), `api` (a custom OpenAPI tool), `app`,
# `dataset-retrieval` and `mcp` are genuinely NOT marketplace plugins.
MARKETPLACE_PROVIDER_TYPES = {"builtin", "plugin", None}


def plugin_id_of(provider: str) -> str | None:
    """`<org>/<plugin>` — the dependency-identifier prefix — from a tool node's provider_id.

    Mirrors vendor/dify-src/api/models/provider_ids.py:24-29 (GenericProviderID): a 3-segment
    `<org>/<plugin>/<provider>` is used as-is; a bare 1-segment legacy name expands to
    `langgenius/<v>/<v>`; anything else (notably a 2-segment `org/plugin`) raises ValueError at import
    — return None so the caller can say so in Dify's own terms.

    Exported so the pre-commit linter and tests/test_pattern_consistency.py share ONE derivation:
    this rule is subtle enough that two copies would drift.
    """
    parts = str(provider or "").split("/")
    if len(parts) == 1 and parts[0]:
        return f"langgenius/{parts[0]}"
    if len(parts) == 3:
        return f"{parts[0]}/{parts[1]}"
    return None


def lint(path):
    errors = []
    try:
        d = yaml.safe_load(Path(path).read_text())
    except Exception as e:
        return [(0, f"parse error: {e}")]

    if not isinstance(d, dict):
        return []

    declared = []
    for dep in (d.get("dependencies") or []):
        if isinstance(dep, dict):
            val = (dep.get("value") or {}).get("marketplace_plugin_unique_identifier", "")
            if val and not PATTERN.match(val):
                errors.append((0, f"invalid plugin hash format: {val}"))
            if val:
                declared.append(val)

    # ── spec 067 S5: coverage. Every marketplace `type: tool` node must be listed in `dependencies:`.
    declared_prefixes = {v.split(":", 1)[0] for v in declared}
    for node in (((d.get("workflow") or {}).get("graph") or {}).get("nodes") or []):
        if not isinstance(node, dict):
            continue
        nd = node.get("data") or {}
        if not isinstance(nd, dict) or nd.get("type") != "tool":
            continue
        if nd.get("provider_type") not in MARKETPLACE_PROVIDER_TYPES:
            continue
        raw = str(nd.get("provider_id") or nd.get("provider_name") or "")
        if not raw:
            errors.append((0, f"tool node {node.get('id', '?')!r} has no provider_id/provider_name — cannot check its plugin dependency"))
            continue
        plugin_id = plugin_id_of(raw)
        if plugin_id is None:
            errors.append((
                0,
                f"tool node {node.get('id', '?')!r} has provider_id {raw!r} — Dify accepts only "
                f"'<org>/<plugin>/<provider>' or a bare name (provider_ids.py GenericProviderID); "
                f"a 2-segment value raises ValueError at import",
            ))
            continue
        if plugin_id not in declared_prefixes:
            errors.append((
                0,
                f"tool node {node.get('id', '?')!r} uses plugin '{plugin_id}' but `dependencies:` does not "
                f"list it — Dify will import this file and NEVER prompt to install the plugin, so the node "
                f"fails at runtime. Resolve it: marketplace.py resolve {plugin_id}",
            ))
    return errors


def main():
    if len(sys.argv) < 2:
        print("Usage: lint_plugin_hashes.py <file.yml> ...", file=sys.stderr)
        return 2
    fail = 0
    for f in sys.argv[1:]:
        errs = lint(f)
        for _, msg in errs:
            print(f"[X] {f}: {msg}")
            fail += 1
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())

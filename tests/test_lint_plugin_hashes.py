"""Spec 067 S5 — lint_plugin_hashes: the FORMAT gate, and the COVERAGE gate it was missing.

The coverage half is the one that matters for users. Before 067, a `type: tool` node with
`dependencies: []` cleared all four linters, imported into Dify cleanly, and then failed at runtime —
because Dify only raises its "install this plugin" prompt when the DSL carries a NON-EMPTY top-level
`dependencies:` array (the graph-derived fallback is dead above DSL 0.1.5). A linter that only
validates identifiers that are already present can never see that.
"""
import sys
from pathlib import Path

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "dify_base"))
from lint_plugin_hashes import lint  # noqa: E402

HASH = "17f06eaa1d905595e1a76460e7249707a722142353d551cf14aed3d8517c134f"
IDENT = f"omluc/google_sheets:0.0.2@{HASH}"

# The CORRECT node-identity shape (docs/runtime-supplement.md, verified against a lint-clean build):
# provider_type `builtin` (NOT `plugin`), and provider_name == provider_id, 3 segments.
TOOL_NODE = (
    "workflow:\n"
    "  graph:\n"
    "    nodes:\n"
    "    - id: n1\n"
    "      data:\n"
    "        type: tool\n"
    "        provider_type: builtin\n"
    "        provider_id: omluc/google_sheets/google_sheets\n"
    "        provider_name: omluc/google_sheets/google_sheets\n"
    "        tool_name: batch_get\n"
)


def _lint(tmp_path, text):
    f = tmp_path / "w.yml"
    f.write_text(text, encoding="utf-8")
    return [m for _, m in lint(str(f))]


# ── format gate (pre-067 behaviour — must not regress) ───────────────────────────────────────────

def test_valid_identifier_passes(tmp_path):
    body = f"dependencies:\n- type: marketplace\n  value:\n    marketplace_plugin_unique_identifier: {IDENT}\n"
    assert _lint(tmp_path, body + TOOL_NODE) == []


@pytest.mark.parametrize("bad", [
    "omluc/google_sheets:0.0.2@short",
    "omluc/google_sheets@" + HASH,          # no version
    f"OMLUC/Google_Sheets:0.0.2@{HASH}",    # uppercase
    f"omluc/google_sheets:0.0.2@{HASH.upper()}",  # non-lowercase hex
])
def test_malformed_identifier_flagged(tmp_path, bad):
    body = f"dependencies:\n- type: marketplace\n  value:\n    marketplace_plugin_unique_identifier: {bad}\n"
    errs = _lint(tmp_path, body)
    assert any("invalid plugin hash format" in e for e in errs), errs


def test_no_dependencies_and_no_tool_node_is_fine(tmp_path):
    """An llm-only workflow needs no marketplace dependency from this linter's point of view."""
    assert _lint(tmp_path, "dependencies: []\nworkflow:\n  graph:\n    nodes:\n    - id: n1\n      data:\n        type: llm\n") == []


# ── coverage gate (spec 067 S5 — the new half) ───────────────────────────────────────────────────

def test_tool_node_without_its_dependency_is_flagged(tmp_path):
    """THE regression this spec exists for: silent runtime failure, no install prompt."""
    errs = _lint(tmp_path, "dependencies: []\n" + TOOL_NODE)
    assert len(errs) == 1, errs
    assert "omluc/google_sheets" in errs[0]
    assert "NEVER prompt" in errs[0], "the message must say WHY it matters, not just that it is missing"
    assert "marketplace.py resolve" in errs[0], "and how to fix it — the hash is public, resolve it"


def test_tool_node_with_its_dependency_passes(tmp_path):
    body = f"dependencies:\n- type: marketplace\n  value:\n    marketplace_plugin_unique_identifier: {IDENT}\n"
    assert _lint(tmp_path, body + TOOL_NODE) == []


def test_non_marketplace_tool_providers_are_exempt(tmp_path):
    """workflow/api/app/dataset-retrieval/mcp tools are NOT marketplace plugins — flagging them would
    be noise. `builtin` is deliberately NOT in this list: it IS the marketplace type (see
    test_builtin_tool_nodes_are_checked_not_skipped)."""
    for ptype in ("workflow", "api", "app", "dataset-retrieval", "mcp"):
        node = TOOL_NODE.replace("provider_type: builtin", f"provider_type: {ptype}")
        assert _lint(tmp_path, "dependencies: []\n" + node) == [], ptype


def test_a_tool_node_missing_provider_id_is_reported_not_skipped(tmp_path):
    """Fail loud: silently skipping an unparseable node is how the original gap survived."""
    node = (TOOL_NODE
            .replace("        provider_id: omluc/google_sheets/google_sheets\n", "")
            .replace("        provider_name: omluc/google_sheets/google_sheets\n", ""))
    errs = _lint(tmp_path, "dependencies: []\n" + node)
    assert any("no provider_id" in e for e in errs), errs


def test_the_wrong_plugin_listed_does_not_satisfy_a_tool_node(tmp_path):
    """A dependencies entry for a DIFFERENT plugin must not count as coverage."""
    other = f"dependencies:\n- type: marketplace\n  value:\n    marketplace_plugin_unique_identifier: langgenius/slack:0.0.9@{'b' * 64}\n"
    errs = _lint(tmp_path, other + TOOL_NODE)
    assert any("does not list it" in e for e in errs), errs


def test_the_checked_in_catalog_matches_the_linter_format(tmp_path):
    """Every identifier the catalog ships must satisfy the gate it will be pasted into."""
    cat = _catalog()
    assert cat["plugins"], "the catalog must not be empty"
    for p in cat["plugins"]:
        body = ("dependencies:\n- type: marketplace\n  value:\n    "
                f"marketplace_plugin_unique_identifier: {p['dependency_identifier']}\n")
        node = TOOL_NODE.replace("provider_id: omluc/google_sheets/google_sheets",
                                 f"provider_id: {p['provider_id']}")
        assert _lint(tmp_path, body + node) == [], p["provider_name"]
        assert p["category"] == "tool", f"{p['provider_name']} is not a tool plugin"
        assert p["tools"], f"{p['provider_name']} declares no tools — unusable as a tool node"


# ── the node-identity shape (spec 067; docs/runtime-supplement.md) ───────────────────────────────
# Two rules an earlier draft of the catalog got WRONG, so both are pinned here. They are
# counter-intuitive, which is exactly why they need a test rather than a comment.

def test_catalog_uses_the_builtin_provider_type_not_plugin():
    """`builtin` IS the marketplace type. Dify dispatches BUILT_IN to the PluginToolProviderController
    (vendor/dify-src tool_manager.py:985-987) and every real tool node in corpus/ uses `builtin`.
    A catalog emitting `plugin` produces nodes the UI cannot resolve — AND it silently turned the
    coverage gate into a no-op, since that gate skips non-marketplace provider types."""
    for p in _catalog()["plugins"]:
        assert p["provider_type"] == "builtin", f"{p['provider_id']} has provider_type={p['provider_type']!r}"


def test_catalog_provider_name_is_the_full_three_segment_path():
    """"provider name doubled" (docs/runtime-supplement.md): provider_name == provider_id, 3 segments.
    A 2-segment value raises ValueError in Dify's GenericProviderID (provider_ids.py:24-29)."""
    for p in _catalog()["plugins"]:
        assert p["provider_name"] == p["provider_id"], p["provider_id"]
        assert len(p["provider_id"].split("/")) == 3, p["provider_id"]
        assert p["plugin_id"] == "/".join(p["provider_id"].split("/")[:2]), p["provider_id"]


def test_a_two_segment_provider_id_is_rejected_with_difys_own_reason(tmp_path):
    """The shape Dify raises ValueError on must not pass our gate silently."""
    node = TOOL_NODE.replace("provider_id: omluc/google_sheets/google_sheets",
                             "provider_id: omluc/google_sheets")
    errs = _lint(tmp_path, "dependencies: []\n" + node)
    assert any("raises ValueError at import" in e for e in errs), errs


def test_builtin_tool_nodes_are_checked_not_skipped(tmp_path):
    """The regression that made the whole gate a no-op: skipping every provider_type != 'plugin'."""
    node = TOOL_NODE.replace("provider_type: builtin", "provider_type: builtin")
    errs = _lint(tmp_path, "dependencies: []\n" + node)
    assert errs, "a builtin (= marketplace) tool node with no dependency MUST be flagged"


def test_a_legacy_one_segment_provider_id_expands_like_dify_does(tmp_path):
    """`provider_id: time` → langgenius/time/time (GenericProviderID), so the dependency key is
    langgenius/time. corpus/ is full of this legacy 1-segment form."""
    node = TOOL_NODE.replace("provider_id: omluc/google_sheets/google_sheets", "provider_id: time")
    errs = _lint(tmp_path, "dependencies: []\n" + node)
    assert any("langgenius/time" in e for e in errs), errs


# ── the pattern must obey the catalog it points at (spec 067 S3) ─────────────────────────────────

def test_the_tool_pattern_passes_only_parameters_the_tool_declares():
    """A parameter the tool does not declare is silently ignored by Dify; a missing REQUIRED one fails
    at runtime. The first draft of scheduled-tool-append.yml passed `values` (nonexistent) and omitted
    `data` (required) — the linters were all green, because none of them knew the tool's schema.
    The catalog HAS the answer, so cross-check it."""
    pat = yaml.safe_load(
        (Path(__file__).resolve().parents[1] / "templates" / "patterns" / "scheduled-tool-append.yml")
        .read_text(encoding="utf-8")
    )
    by_provider = {p["provider_id"]: p for p in _catalog()["plugins"]}
    checked = 0
    for node in pat["workflow"]["graph"]["nodes"]:
        nd = node.get("data") or {}
        if nd.get("type") != "tool":
            continue
        entry = by_provider.get(nd["provider_id"])
        assert entry, f"{nd['provider_id']} is not in the catalog — the pattern must use a catalogued tool"
        decl = next((t for t in entry["tools"] if t["tool_name"] == nd["tool_name"]), None)
        assert decl, f"{entry['provider_id']} declares no tool named {nd['tool_name']!r}"
        names = {p["name"] for p in decl["parameters"]}
        passed = set((nd.get("tool_parameters") or {}).keys())
        assert passed <= names, f"passes undeclared parameter(s): {sorted(passed - names)}"
        required = {p["name"] for p in decl["parameters"] if p["required"]}
        assert required <= passed, f"omits REQUIRED parameter(s): {sorted(required - passed)}"
        checked += 1
    assert checked, "the pattern must contain a tool node — that is its whole point"


def _catalog():
    import json
    return json.loads(
        (Path(__file__).resolve().parents[1] / "templates" / "tool-catalog.json").read_text(encoding="utf-8")
    )

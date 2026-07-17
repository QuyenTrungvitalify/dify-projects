"""Assert all patterns in templates/patterns/ follow conventions."""
from pathlib import Path

import pytest
import yaml

PATTERN_FILES = sorted(
    (Path(__file__).parent.parent / "templates/patterns").glob("*.yml")
)


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_use_case_comment(yml_path):
    text = yml_path.read_text()
    assert "# Use case:" in text or "# use case:" in text.lower(), (
        f"{yml_path.name} missing '# Use case:' header"
    )


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_has_todo_markers(yml_path):
    text = yml_path.read_text()
    assert "# TODO:" in text, (
        f"{yml_path.name} should have # TODO: customization markers"
    )


@pytest.mark.parametrize("yml_path", PATTERN_FILES, ids=lambda p: p.name)
def test_dependencies_match_the_tool_nodes(yml_path):
    """Spec 067: a pattern's `dependencies:` must COVER its tool nodes — and only those.

    This test used to assert `dependencies == []` for every pattern, with the rationale "patterns
    should not commit specific plugin hashes". That was the workspace-specific-hash myth (retired
    from AGENTS.md §4.3) frozen into a test — and it is exactly backwards for a tool pattern:

    * the hash is the PUBLIC marketplace package checksum keyed to (plugin, version), identical in
      every workspace, so committing it leaks nothing and goes stale only on a version bump;
    * Dify raises its "install this plugin" prompt ONLY when the imported DSL carries a NON-EMPTY
      top-level `dependencies:` (the graph-derived fallback is dead above DSL 0.1.5). A tool pattern
      shipping `dependencies: []` therefore imports silently and fails at RUNTIME — the precise
      user-facing bug spec 067 exists to end.

    The real invariant is coverage, which is what `lint_plugin_hashes.py` now enforces per-file:
    a pattern with no tool node still carries no dependencies (nothing to over-commit), and a
    pattern WITH one must list its plugin.
    """
    d = yaml.safe_load(yml_path.read_text())
    deps = [
        (dep.get("value") or {}).get("marketplace_plugin_unique_identifier", "")
        for dep in (d.get("dependencies") or [])
        if isinstance(dep, dict)
    ]
    # ONE derivation, shared with the pre-commit linter — `builtin` is the marketplace type, and the
    # dependency key is `<org>/<plugin>` derived from the 3-segment provider_id. Re-deriving it here
    # is how the two would drift.
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools" / "dify_base"))
    from lint_plugin_hashes import MARKETPLACE_PROVIDER_TYPES, plugin_id_of

    providers = {
        plugin_id_of((n.get("data") or {}).get("provider_id") or (n.get("data") or {}).get("provider_name") or "")
        for n in (((d.get("workflow") or {}).get("graph") or {}).get("nodes") or [])
        if isinstance(n, dict)
        and (n.get("data") or {}).get("type") == "tool"
        and (n.get("data") or {}).get("provider_type") in MARKETPLACE_PROVIDER_TYPES
    } - {None}
    if not providers:
        assert deps == [], (
            f"{yml_path.name} declares plugin dependencies but has no marketplace tool node — "
            f"an unused dependency makes Dify prompt for a plugin the workflow never calls"
        )
        return
    declared_prefixes = {v.split(":", 1)[0] for v in deps if v}
    missing = providers - declared_prefixes
    assert not missing, (
        f"{yml_path.name}: tool node(s) use {sorted(missing)} but `dependencies:` does not list them — "
        f"Dify would import this file and never prompt to install the plugin (spec 067). "
        f"Resolve it: tools/dify_base/marketplace.py resolve <org>/<name>"
    )

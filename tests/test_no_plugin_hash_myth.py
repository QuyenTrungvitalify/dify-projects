"""Spec 067 AC-4 — the myth must not come back.

For months this repo asserted, in its own rulebook, that a plugin's `@<sha256>` was
"real and workspace-specific — copy it from a YAML exported by the target Dify workspace. NEVER
fabricate." That is false: the hash is the PUBLIC marketplace package checksum, keyed to
(plugin, version) and identical in every workspace. The cost was not theoretical — `②Spec` obeyed the
rule and refused to build `tool` nodes at all (one build's own words: 「プラグインハッシュ依存が増えない
ため」), so a stakeholder asking for spreadsheet integration was told it could not be done.

067 retired the rule. This test is what keeps it retired. It exists because the first pass "verified"
AC-4 with a one-off manual grep and wrote "clean" into the spec status — which is exactly the kind of
unrepeatable check that let the myth become load-bearing in the first place.

Two design notes, both learned the hard way:
  * Match the ASSERTION, not the word. A grep for "workspace-specific" fires on the corrected
    sentence ("the hash is **not** workspace-specific") — a guard that flags its own fix teaches
    people to disable it.
  * A HISTORY note is allowed and wanted. Recording why the rule was wrong is how it stays dead, so
    quoted/retired text under a marker is exempt.
"""
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]

# Live instruction surfaces — what a build or a human actually reads AS A RULE.
# docs/specs/*.md is deliberately EXCLUDED: specs are a dated decision log, and rewriting history
# there would erase the evidence of the mistake.
LIVE_DOCS = [
    REPO / "AGENTS.md",
    REPO / "docs" / "GUIDE.md",
    REPO / "docs" / "runtime-supplement.md",
    REPO / "docs" / "plugin-capabilities.md",
    *sorted((REPO / ".claude" / "skills" / "dify-build").glob("*.md")),
    *sorted((REPO / "templates" / "patterns").glob("*.yml")),
]

# Every phrasing the myth was found in. The first pass grepped only the first two and let the 7-step
# Export-DSL procedure and ":88 re-export" survive undetected.
MYTH_PATTERNS = [
    (r"hash.{0,40}\bis\b.{0,20}workspace-specific", "the headline claim"),
    (r"ONLY sanctioned source of plugin", "the AGENTS.md :252 clause that forbade a resolver"),
    (r"re-export and copy", "the :88 half that survived the first pass"),
    (r"obtain(ed)? from a YAML exported", "the Export-DSL procedure"),
    (r"exported (by|from) (the|your) target (Dify )?workspace", "the Export-DSL procedure"),
    (r"add plugin hash from target workspace", "the pattern-authoring TODO"),
    (r"intentionally never checked in", "the SKILL.md claim that a filled dependencies is unshippable"),
    (r"one-time per plugin per workspace", "the procedure header"),
]

# A line is exempt if it is quoting the retired rule rather than stating it.
HISTORY_MARKERS = re.compile(
    r"used to|previously said|history|retired|was (factually )?wrong|spec 067|updated by|no longer|"
    r"\bnot\b workspace-specific|\*\*not\*\* workspace-specific",
    re.I,
)


def _live_lines(path: Path):
    for i, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
        if HISTORY_MARKERS.search(line):
            continue
        yield i, line


@pytest.mark.parametrize("path", LIVE_DOCS, ids=lambda p: str(p.relative_to(REPO)))
def test_no_live_doc_asserts_the_workspace_specific_hash_myth(path):
    hits = [
        f"{path.relative_to(REPO)}:{i}: [{why}] {line.strip()[:110]}"
        for i, line in _live_lines(path)
        for rx, why in MYTH_PATTERNS
        if re.search(rx, line, re.I)
    ]
    assert not hits, (
        "The retired plugin-hash myth is back in a live instruction surface. The hash is PUBLIC and "
        "version-keyed — resolve it (tools/dify_base/marketplace.py), never tell a build to go export "
        "a YAML or to leave `dependencies: []`.\n  " + "\n  ".join(hits)
    )


def test_the_guard_does_not_fire_on_the_correction_itself():
    """A guard that flags its own fix gets disabled. AGENTS.md §4.3 now says the hash is *not*
    workspace-specific and carries a history note quoting the old rule — both must pass."""
    agents = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    assert "not** workspace-specific" in agents or "not workspace-specific" in agents, (
        "AGENTS.md should still carry the correction (this test would be vacuous otherwise)"
    )
    assert "previously said" in agents, "…and the history note explaining why the old rule was wrong"


def test_the_guard_actually_catches_the_myth(tmp_path):
    """Proof the patterns match — a guard nobody has seen fail is not a guard."""
    for rx, _why in MYTH_PATTERNS:
        sample = {
            r"hash.{0,40}\bis\b.{0,20}workspace-specific": "The hash is real and workspace-specific — copy it.",
            r"ONLY sanctioned source of plugin": "Workspace facts are the ONLY sanctioned source of plugin hashes.",
            r"re-export and copy": "On a mismatch, re-export and copy the fresh hash.",
            r"obtain(ed)? from a YAML exported": "Plugin hash — obtain from a YAML exported by your workspace.",
            r"exported (by|from) (the|your) target (Dify )?workspace": "copy it from a YAML exported by the target Dify workspace",
            r"add plugin hash from target workspace": "# TODO: add plugin hash from target workspace",
            r"intentionally never checked in": "A filled dependencies entry is intentionally never checked in.",
            r"one-time per plugin per workspace": "How to obtain a real plugin hash (one-time per plugin per workspace)",
        }[rx]
        assert re.search(rx, sample, re.I), f"pattern {rx!r} no longer matches its own myth sample"
        assert not HISTORY_MARKERS.search(sample), f"sample for {rx!r} accidentally reads as history"

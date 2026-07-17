"""The generated schema is the truth for a node body — and the skill must send agents there.

Run 1784278684526 built a `trigger-webhook` workflow and spent 44 turns on ③, 13 of them
hook-denied `grep`s, reconstructing the node's field shape. It got there by reading
`lint_node_bodies.py`'s SOURCE, after `--list-coverage` told it only the schema's NAME. The answer
was one `Read` away the whole time: `schemas/dify-dsl-*.json` → `$defs.NodeData_WebhookData`.

Worse, the doc the skill pointed at was WRONG. `skills/mango-svip/references/node_types.md` is a
third-party clone that predates trigger support: it gives `trigger-webhook` a `variables:` field and
`trigger-schedule` a `schedule:` field, neither of which exists. `NodeData_*` does not set
`additionalProperties: false`, so those shapes are not rejected — they import clean and fail at
runtime, the AGENTS.md §4.2 "silent import success" class. The 44-turn hunt is what SAVED that build.

These tests pin the two halves that keep the fix honest:
  1. the generated schema really is authoritative and complete for the trigger nodes, and
  2. the skill points at it, and no longer sells node_types.md as the node-schema source.
"""
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SKILL_DIR = REPO / ".claude" / "skills" / "dify-build"


def _schema() -> dict:
    latest = sorted((REPO / "schemas").glob("dify-dsl-*.json"))[-1]
    return json.loads(latest.read_text())


def test_trigger_node_bodies_are_defined_in_the_generated_schema():
    """The fields ③ hunted for must be findable in ONE Read — else the pointer is worthless."""
    defs = _schema()["$defs"]
    webhook = defs.get("NodeData_WebhookData")
    assert webhook, "NodeData_WebhookData missing — the skill now sends ③ here for the webhook body"
    props = set(webhook.get("properties", {}))
    # The shape run 1784278684526 reconstructed by hand, and that lint_node_bodies gates against.
    for field in ("method", "content_type", "body", "params", "status_code", "webhook_id"):
        assert field in props, f"NodeData_WebhookData has no `{field}` — the pointer would mislead"

    schedule = defs.get("NodeData_TriggerScheduleNodeData")
    assert schedule, "NodeData_TriggerScheduleNodeData missing"
    sprops = set(schedule.get("properties", {}))
    # timezone is the one that silently shifts every date comparison when left at Dify's UTC default.
    for field in ("mode", "frequency", "timezone"):
        assert field in sprops, f"NodeData_TriggerScheduleNodeData has no `{field}`"


def test_node_types_md_is_still_wrong_about_triggers():
    """Pin the REASON the skill warns about node_types.md. If the clone is ever fixed upstream, this
    test fails and the warning should be retired rather than left as folklore."""
    doc = SKILL_DIR / ".." / ".." / ".." / "skills" / "mango-svip" / "references" / "node_types.md"
    doc = doc.resolve()
    if not doc.exists():
        return  # gitignored clone; absent on a fresh checkout until setup.sh runs
    body = doc.read_text()
    m = re.search(r"### \d+\. trigger-webhook\n(.*?)(?=\n### )", body, re.S)
    assert m, "node_types.md no longer documents trigger-webhook — re-check the SKILL.md warning"
    section = m.group(1)
    real = set(_schema()["$defs"]["NodeData_WebhookData"].get("properties", {}))
    assert "variables" in section and "variables" not in real, (
        "node_types.md no longer claims `variables` for trigger-webhook (or the schema gained it). "
        "The SKILL.md warning is now stale — update or delete it."
    )


def test_skill_sends_agents_to_the_generated_schema_for_node_fields():
    skill = (SKILL_DIR / "SKILL.md").read_text()
    assert "$defs.NodeData_" in skill, "SKILL.md must name the schema's `$defs.NodeData_<X>` anchor"
    assert re.search(r"schemas/dify-dsl-[\d.]+\.json", skill), "SKILL.md must name the schema file"


def test_skill_no_longer_sells_node_types_md_as_the_node_schema_source():
    """It may still be MENTIONED (with the warning) — it must not be the answer to 'node schemas'."""
    skill = (SKILL_DIR / "SKILL.md").read_text()
    for m in re.finditer(r"node_types\.md`?\s*\(([^)]*)\)", skill):
        assert "schema" not in m.group(1).lower(), (
            f"SKILL.md still bills node_types.md as `({m.group(1)})` — it is wrong for the trigger "
            f"nodes; the generated schema is the source."
        )


def test_implement_says_list_coverage_is_not_the_field_answer():
    impl = (SKILL_DIR / "implement.md").read_text()
    assert "$defs.NodeData_" in impl, "implement.md must point at the schema for node fields"
    assert re.search(r"--list-coverage", impl), "the --list-coverage block should still be there"

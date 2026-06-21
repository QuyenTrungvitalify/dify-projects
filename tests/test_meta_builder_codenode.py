"""Offline E2E test for meta-workflow-builder code node.

Simulates the full generator pipeline WITHOUT running Dify:
1. Load templates/patterns/meta-workflow-builder.yml
2. Extract the YAML Mutator code-node's Python
3. exec() it with a mock LLM Planner output
4. Write the generated YAML to /tmp and re-validate it through the same
   pipeline (skill validator + JSON schema) used for hand-authored patterns.

This proves the generator logic emits a valid Dify workflow. The remaining
unknown is the actual HTTP import — that requires a live Dify console token.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
BUILDER = REPO / "templates" / "patterns" / "meta-workflow-builder.yml"
OUTPUT = Path("/tmp/generated_workflow.yml")

MOCK_PLAN = json.dumps({
    "pattern": "file-to-llm",
    "description": "Summarize an English PDF into 3 Vietnamese bullet points.",
    "allowed_extensions": [".pdf"],
    "model_provider": "langgenius/openai",
    "model_name": "gpt-4o-mini",
    "system_prompt": (
        "You are a careful summarizer. Read the English document and produce "
        "exactly 3 concise Vietnamese bullet points covering the main ideas. "
        "Return only the bullets, no preamble."
    ),
})


def extract_code_node_python(builder_yaml_path: Path) -> str:
    doc = yaml.safe_load(builder_yaml_path.read_text())
    for node in doc["workflow"]["graph"]["nodes"]:
        if node["data"]["type"] == "code":
            return node["data"]["code"]
    raise AssertionError("No code node found in builder workflow")


def run_main(code: str, plan_text: str, app_name: str) -> dict:
    ns: dict = {}
    exec(code, ns)
    return ns["main"](plan_text, app_name)


def validate_generated(yaml_path: Path) -> None:
    """Run the skill validator + pre-commit on the generated file."""
    validator = REPO / "skills" / "mango-svip" / "scripts" / "validate_workflow.py"
    venv_py = REPO / ".venv" / "bin" / "python"
    r = subprocess.run(
        [str(venv_py), str(validator), str(yaml_path)],
        capture_output=True, text=True,
    )
    print("=== skill validate_workflow.py ===")
    print(r.stdout)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        raise SystemExit(f"Validator failed (exit {r.returncode})")


def main() -> int:
    print(f"Loading builder: {BUILDER.relative_to(REPO)}")
    code = extract_code_node_python(BUILDER)
    print(f"Extracted code node ({len(code)} chars)")
    print(f"Mock plan: {MOCK_PLAN[:80]}...")

    result = run_main(code, MOCK_PLAN, "PDF -> VN Summary Demo")
    print("\n=== Code node returned ===")
    print(f"  yaml_content: {len(result['yaml_content'])} chars")
    print(f"  import_body : {len(result['import_body'])} chars")
    print(f"  generated_ids: {result['generated_ids']}")

    # Sanity-check import_body is valid JSON
    body = json.loads(result["import_body"])
    assert body["mode"] == "yaml-content"
    assert body["name"] == "PDF -> VN Summary Demo"
    assert len(body["yaml_content"]) > 1000, "yaml_content suspiciously short"
    print("  import_body  : valid JSON, has mode/name/yaml_content")

    # Write + validate
    OUTPUT.write_text(result["yaml_content"])
    print(f"\nWrote generated workflow → {OUTPUT}")
    validate_generated(OUTPUT)

    # Show a preview of the generated YAML
    print("\n=== Generated YAML (first 40 lines) ===")
    for line in result["yaml_content"].splitlines()[:40]:
        print(f"  {line}")
    print("  ...")
    return 0


if __name__ == "__main__":
    sys.exit(main())

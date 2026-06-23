"""Offline E2E test for meta-workflow-builder code node.

Simulates the full generator pipeline WITHOUT running Dify:
1. Load templates/patterns/meta-workflow-builder.yml
2. Extract the YAML Mutator code-node's Python
3. exec() it with a mock LLM Planner output
4. Write the generated YAML to a tmp dir and re-validate it through the same
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
    """Run the skill validator on the generated file; assert it passes."""
    validator = REPO / "skills" / "mango-svip" / "scripts" / "validate_workflow.py"
    # Use the interpreter running pytest, not a hardcoded virtualenv path.
    # Locally that resolves to the project venv (we invoke its pytest); in CI
    # it is the system Python that setup.sh --skip-venv provisioned with deps.
    # A hardcoded path under the project venv dir would break CI, which has
    # none. See spec 024 T1.
    r = subprocess.run(
        [sys.executable, str(validator), str(yaml_path)],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, (
        f"Validator failed (exit {r.returncode})\n{r.stdout}\n{r.stderr}"
    )


def test_meta_builder_generates_importable_yaml(tmp_path):
    """The generator code node emits a schema-valid, importable Dify workflow."""
    code = extract_code_node_python(BUILDER)
    result = run_main(code, MOCK_PLAN, "PDF -> VN Summary Demo")

    # import_body is the payload POSTed to Dify's import endpoint.
    body = json.loads(result["import_body"])
    assert body["mode"] == "yaml-content"
    assert body["name"] == "PDF -> VN Summary Demo"
    assert len(body["yaml_content"]) > 1000, "yaml_content suspiciously short"

    # Write + re-validate through the same pipeline as hand-authored patterns.
    out = tmp_path / "generated_workflow.yml"
    out.write_text(result["yaml_content"])
    validate_generated(out)

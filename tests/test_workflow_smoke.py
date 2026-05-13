"""Smoke tests for deployed Dify workflow apps.

These tests skip cleanly if no Dify credentials are configured — they're
opt-in via env vars (see `tests/conftest.py`).

Adapting these to your project:
1. Copy this file into your project (or replace DIFY_API_KEY with your app's key)
2. Update the `inputs` dict to match your workflow's `Start` node variables
3. Run: `DIFY_PROJECT=<your_project> .venv/bin/pytest tests/`

The first run with `--snapshot-update` writes the expected output;
subsequent runs verify it matches.
"""
from __future__ import annotations

import pytest


def test_credentials_loaded(loaded_env_files):
    """Sanity test — show which env files were picked up (passes even if none)."""
    print(f"\nLoaded env files: {loaded_env_files}")
    # No assertion — informational only


def test_parameters_endpoint(workflow_client):
    """Verify we can reach the workflow's `/parameters` endpoint.

    Useful first check that base_url + api_key are correct.
    """
    params = workflow_client.get_parameters()
    assert "user_input_form" in params or "opening_statement" in params


@pytest.mark.parametrize("inputs,expected_status", [
    pytest.param(
        {"source_text": "Hello world"},
        "succeeded",
        id="simple_text_input",
        # Mark as expected to fail / skip by default since we don't know
        # the actual workflow's input schema yet.
        marks=pytest.mark.skip(reason="Edit inputs for your workflow's Start node variables"),
    ),
])
def test_workflow_run(workflow_client, snapshot, inputs, expected_status):
    """Run the workflow with fixture inputs and snapshot the outputs.

    Initial run:
        pytest tests/test_workflow_smoke.py::test_workflow_run --snapshot-update

    Subsequent runs verify against the snapshot in tests/__snapshots__/.
    """
    result = workflow_client.run(inputs)
    assert result["data"]["status"] == expected_status
    # Snapshot only the outputs, not the full envelope (which has timestamps + IDs)
    assert result["data"]["outputs"] == snapshot

"""Pytest fixtures for the dify-projects base workspace.

Provides a minimal `DifyWorkflowClient` for calling deployed Dify workflow apps
via the public API (POST /v1/workflows/run), plus fixtures that load env from
the active project's `envs/<env>.env` file.

Usage in a test:

    def test_my_workflow(workflow_client, snapshot):
        result = workflow_client.run({"source_text": "hello"})
        assert result["data"]["status"] == "succeeded"
        assert result["data"]["outputs"] == snapshot

To run:

    cd /path/to/dify-projects
    .venv/bin/pytest tests/ -v
    # Or against a specific project:
    DIFY_PROJECT=my_project .venv/bin/pytest tests/

Required env vars (loaded from envs/dev.env if present):
    DIFY_BASE_URL   — e.g. https://api.dify.ai/v1 or your self-host
    DIFY_API_KEY    — app-level API key (starts with `app-`)

Optional:
    DIFY_USER       — user identifier for analytics (default: 'pytest-runner')
    DIFY_PROJECT    — which projects/<name>/envs/dev.env to load (default: none)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
import requests

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

BASE = Path(__file__).parent.parent
DEFAULT_USER = "pytest-runner"


# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def _load_env_chain() -> list[Path]:
    """Load envs/dev.env from the workspace root or active project, in order."""
    loaded: list[Path] = []
    if load_dotenv is None:
        return loaded

    candidates: list[Path] = []
    project = os.environ.get("DIFY_PROJECT")
    if project:
        candidates.append(BASE / "projects" / project / "envs" / "dev.env")
    # Fallback to workspace-root envs/dev.env if it exists (not in template, but allowed)
    candidates.append(BASE / "envs" / "dev.env")

    for env_path in candidates:
        if env_path.exists():
            load_dotenv(env_path, override=False)
            loaded.append(env_path)
    return loaded


_LOADED_ENVS = _load_env_chain()


# ---------------------------------------------------------------------------
# Minimal Dify workflow client (replaces the missing langgenius WorkflowClient)
# ---------------------------------------------------------------------------

class DifyWorkflowClient:
    """Minimal client for Dify workflow apps using the public API.

    Endpoints used:
      POST /v1/workflows/run         — run a workflow synchronously
      POST /v1/files/upload          — upload a file (returns id usable in inputs)
      GET  /v1/parameters            — get app parameters (sanity check)

    All requests use `Authorization: Bearer <api_key>`.
    """

    def __init__(self, base_url: str, api_key: str, user: str = DEFAULT_USER,
                 timeout: int = 120):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.user = user
        self.timeout = timeout

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def get_parameters(self) -> dict[str, Any]:
        r = requests.get(
            f"{self.base_url}/parameters",
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def run(self, inputs: dict[str, Any], response_mode: str = "blocking",
            files: list[dict] | None = None) -> dict[str, Any]:
        """Run the workflow synchronously. Returns the full response JSON."""
        payload = {
            "inputs": inputs,
            "response_mode": response_mode,
            "user": self.user,
        }
        if files is not None:
            payload["files"] = files
        r = requests.post(
            f"{self.base_url}/workflows/run",
            headers=self._headers,
            data=json.dumps(payload),
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def upload_file(self, file_path: Path) -> dict[str, Any]:
        """Upload a file for use as workflow input. Returns the file metadata."""
        with open(file_path, "rb") as f:
            r = requests.post(
                f"{self.base_url}/files/upload",
                headers={"Authorization": f"Bearer {self.api_key}"},
                files={"file": (file_path.name, f)},
                data={"user": self.user},
                timeout=self.timeout,
            )
        r.raise_for_status()
        return r.json()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def loaded_env_files() -> list[Path]:
    """Return the list of env files that were loaded at import time."""
    return list(_LOADED_ENVS)


def _have_creds() -> bool:
    return bool(os.environ.get("DIFY_BASE_URL") and os.environ.get("DIFY_API_KEY"))


@pytest.fixture(scope="session")
def workflow_client() -> DifyWorkflowClient:
    """A DifyWorkflowClient configured from env vars. Skips if credentials missing."""
    if not _have_creds():
        pytest.skip(
            "DIFY_BASE_URL and DIFY_API_KEY not set. "
            "Copy envs/dev.env.example to envs/dev.env in your project, then "
            "run with `DIFY_PROJECT=<your_project> pytest`."
        )
    return DifyWorkflowClient(
        base_url=os.environ["DIFY_BASE_URL"],
        api_key=os.environ["DIFY_API_KEY"],
        user=os.environ.get("DIFY_USER", DEFAULT_USER),
    )


@pytest.fixture
def fixtures_dir() -> Path:
    """Path to tests/fixtures/."""
    return Path(__file__).parent / "fixtures"


@pytest.fixture
def workspace_root() -> Path:
    """Path to dify-projects/ workspace root."""
    return BASE

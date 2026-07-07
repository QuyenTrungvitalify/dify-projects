"""Tests for tools/dify_base/sync.py — mock HTTP, no real Dify needed.

These tests verify the sync CLI logic without making network calls. They mock
`requests.get` / `requests.post` to return canned responses, then check:
- API request shape (URL, headers, params, body)
- File output correctness (paths, content)
- Diff detection

Run:
    .venv/bin/pytest tests/test_sync.py -v
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Make `tools.dify_base.sync` importable
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from dify_base import sync  # noqa: E402


# ---------------------------------------------------------------------------
# Mocked HTTP fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_apps_response():
    return {
        "data": [
            {"id": "11111111-aaaa-bbbb-cccc-000000000001", "name": "RAG Bot", "mode": "workflow"},
            {"id": "22222222-aaaa-bbbb-cccc-000000000002", "name": "Translation", "mode": "workflow"},
            {"id": "33333333-aaaa-bbbb-cccc-000000000003", "name": "Chat Demo", "mode": "advanced-chat"},
        ],
        "total": 3,
        "page": 1,
        "limit": 100,
    }


@pytest.fixture
def fake_yaml():
    return "app:\n  name: Test\n  mode: workflow\nkind: app\nversion: 0.6.0\n"


@pytest.fixture
def client():
    return sync.DifyConsoleClient("https://dify.test/console/api", "fake-token")


# ---------------------------------------------------------------------------
# Client tests
# ---------------------------------------------------------------------------

def test_client_headers(client):
    assert client._headers["Authorization"] == "Bearer fake-token"
    assert client._headers["Content-Type"] == "application/json"
    # No workspace id → no X-WORKSPACE-ID header (browser-JWT path, unchanged).
    assert "X-WORKSPACE-ID" not in client._headers


def test_client_headers_admin_key_sends_workspace_id():
    # ADMIN_API_KEY path: a workspace id makes _headers carry X-WORKSPACE-ID (dify requires it to
    # resolve the workspace owner when the bearer is an admin key rather than a session JWT).
    c = sync.DifyConsoleClient("https://dify.test/console/api", "admin-key", workspace_id="tenant-123")
    assert c._headers["Authorization"] == "Bearer admin-key"
    assert c._headers["X-WORKSPACE-ID"] == "tenant-123"


def test_client_from_env_reads_workspace_id(monkeypatch):
    monkeypatch.setenv("DIFY_CONSOLE_URL", "https://dify.test/console/api")
    monkeypatch.setenv("DIFY_CONSOLE_TOKEN", "admin-key")
    monkeypatch.setenv("DIFY_WORKSPACE_ID", "tenant-abc")
    c = sync._client_from_env()
    assert c.workspace_id == "tenant-abc"
    assert c._headers["X-WORKSPACE-ID"] == "tenant-abc"


def test_client_strips_trailing_slash():
    c = sync.DifyConsoleClient("https://dify.test/console/api/", "tok")
    assert c.base_url == "https://dify.test/console/api"


def test_list_apps_request_shape(client, mock_apps_response):
    with patch("dify_base.sync.requests.get") as mock_get:
        mock_get.return_value = MagicMock(status_code=200,
                                          json=lambda: mock_apps_response)
        mock_get.return_value.raise_for_status = lambda: None
        result = client.list_apps(mode="workflow", name="RAG")

    call = mock_get.call_args
    assert call.args[0] == "https://dify.test/console/api/apps"
    assert call.kwargs["headers"]["Authorization"] == "Bearer fake-token"
    assert call.kwargs["params"] == {"page": 1, "limit": 100, "mode": "workflow", "name": "RAG"}
    assert result == mock_apps_response


def test_export_app(client, fake_yaml):
    with patch("dify_base.sync.requests.get") as mock_get:
        mock_get.return_value = MagicMock(json=lambda: {"data": fake_yaml})
        mock_get.return_value.raise_for_status = lambda: None
        text = client.export_app("11111111-aaaa-bbbb-cccc-000000000001")

    call = mock_get.call_args
    assert "/apps/11111111-aaaa-bbbb-cccc-000000000001/export" in call.args[0]
    assert call.kwargs["params"] == {"include_secret": "false"}
    assert text == fake_yaml


def test_export_app_with_secrets(client, fake_yaml):
    with patch("dify_base.sync.requests.get") as mock_get:
        mock_get.return_value = MagicMock(json=lambda: {"data": fake_yaml})
        mock_get.return_value.raise_for_status = lambda: None
        client.export_app("abc-123", include_secret=True)

    assert mock_get.call_args.kwargs["params"]["include_secret"] == "true"


def test_import_app(client, fake_yaml):
    with patch("dify_base.sync.requests.post") as mock_post:
        mock_post.return_value = MagicMock(
            json=lambda: {"id": "import-1", "status": "pending", "app_id": "new-app-id"})
        mock_post.return_value.raise_for_status = lambda: None
        result = client.import_app(fake_yaml, name="My Imported App")

    call = mock_post.call_args
    assert call.args[0] == "https://dify.test/console/api/apps/imports"
    body = json.loads(call.kwargs["data"])
    assert body["mode"] == "yaml-content"
    assert body["yaml_content"] == fake_yaml
    assert body["name"] == "My Imported App"
    assert result["app_id"] == "new-app-id"


# ---------------------------------------------------------------------------
# Helper tests
# ---------------------------------------------------------------------------

def test_slugify():
    assert sync._slugify("RAG Bot") == "rag_bot"
    assert sync._slugify("  Multi-Step LLM  ") == "multi-step_llm"
    assert sync._slugify("【VF】Stem校閲_84") == "vf_stem_84"  # non-ASCII stripped
    assert sync._slugify("") == "untitled"
    assert sync._slugify("___") == "untitled"


# ---------------------------------------------------------------------------
# End-to-end pull (with temp project + mocked HTTP)
# ---------------------------------------------------------------------------

def test_pull_writes_yaml_files(tmp_path, monkeypatch, mock_apps_response, fake_yaml):
    # Set up a fake project under a tmp BASE
    monkeypatch.setattr(sync, "BASE", tmp_path)
    project = tmp_path / "projects" / "demo"
    project.mkdir(parents=True)

    monkeypatch.setenv("DIFY_CONSOLE_URL", "https://dify.test/console/api")
    monkeypatch.setenv("DIFY_CONSOLE_TOKEN", "fake-token")

    with patch("dify_base.sync.requests.get") as mock_get:
        # Sequence: 1st call is list_apps, then export_app per item
        mock_get.side_effect = [
            MagicMock(raise_for_status=lambda: None, json=lambda: mock_apps_response),
            MagicMock(raise_for_status=lambda: None, json=lambda: {"data": fake_yaml}),
            MagicMock(raise_for_status=lambda: None, json=lambda: {"data": fake_yaml}),
            MagicMock(raise_for_status=lambda: None, json=lambda: {"data": fake_yaml}),
        ]

        args = MagicMock(
            project="demo", workflow="summarizer", app_id=None, name_contains=None,
            include_secret=False, yes=True,
        )
        sync.cmd_pull(args)

    # spec 030: files land in the nested workflow folder projects/<project>/<workflow>/workflows/.
    workflows = project / "summarizer" / "workflows"
    files = sorted(f.name for f in workflows.glob("*.yml"))
    assert files == ["chat_demo.yml", "rag_bot.yml", "translation.yml"]
    assert (workflows / "rag_bot.yml").read_text() == fake_yaml


# ---------------------------------------------------------------------------
# inject-model — spec 032 (patch) + spec 043 (llm_count signal)
# ---------------------------------------------------------------------------

def _inject_yaml(nodes: list[dict]) -> str:
    import yaml
    return yaml.safe_dump({"app": {"mode": "workflow"}, "workflow": {"graph": {"nodes": nodes}}})


def _run_inject(tmp_path, monkeypatch, capsys, src_yaml: str) -> dict:
    from types import SimpleNamespace
    monkeypatch.setattr(sync, "BASE", tmp_path)
    (tmp_path / "src.yml").write_text(src_yaml, encoding="utf-8")
    args = SimpleNamespace(src="src.yml", out="out.yml", provider="openai", name="gpt-4o-mini", valid_names=None)
    rc = sync.cmd_inject_model(args)
    assert rc == 0
    return json.loads(capsys.readouterr().out.strip().splitlines()[-1])


def test_inject_model_llm_less_workflow_reports_zero(tmp_path, monkeypatch, capsys):
    # spec 043: a model-agnostic workflow (start → code → end, no llm node) → llm_count:0, node_count:0.
    yaml_src = _inject_yaml([
        {"id": "start", "data": {"type": "start", "variables": []}},
        {"id": "code", "data": {"type": "code"}},
        {"id": "end", "data": {"type": "end"}},
    ])
    obj = _run_inject(tmp_path, monkeypatch, capsys, yaml_src)
    assert obj["llm_count"] == 0
    assert obj["node_count"] == 0
    assert obj["patched"] == []


def test_inject_model_empty_model_llm_reports_one(tmp_path, monkeypatch, capsys):
    # spec 043: an llm node with an EMPTY model → both counts 1 (patched + needs a workspace model).
    yaml_src = _inject_yaml([
        {"id": "start", "data": {"type": "start", "variables": []}},
        {"id": "llm1", "data": {"type": "llm", "model": {"name": ""}}},
    ])
    obj = _run_inject(tmp_path, monkeypatch, capsys, yaml_src)
    assert obj["llm_count"] == 1
    assert obj["node_count"] == 1
    assert obj["patched"] == ["llm1"]

# Tests — pytest harness for deployed Dify workflows

A lightweight test harness that lets you call deployed Dify workflow apps via
the public API and snapshot their outputs for regression testing.

## Quick start

```bash
cd /path/to/dify-projects

# 1. Setup venv (if not already done — same venv used by schemas/gen_schema.py)
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r tests/requirements.txt

# 2. In your project, fill envs/dev.env with workspace creds
cp projects/<your_project>/envs/dev.env.example projects/<your_project>/envs/dev.env
# Edit: DIFY_BASE_URL, DIFY_API_KEY

# 3. Run tests against your project
DIFY_PROJECT=<your_project> .venv/bin/pytest tests/ -v
```

## What's in here

| File | Purpose |
|---|---|
| `conftest.py` | Fixtures: env loader, `DifyWorkflowClient`, `fixtures_dir` |
| `test_workflow_smoke.py` | Example: sanity (parameters endpoint) + run-with-snapshot |
| `fixtures/` | Sample input JSON / files referenced by tests |
| `__snapshots__/` | Syrupy snapshot files (auto-managed) |
| `requirements.txt` | pytest + syrupy + python-dotenv + requests |

## DifyWorkflowClient

Minimal client (~80 LOC in `conftest.py`) wrapping 3 endpoints:

```python
client = DifyWorkflowClient(base_url, api_key, user)

# Sanity check
client.get_parameters()
# → {"user_input_form": [...], "file_upload": {...}, ...}

# Run a workflow synchronously
result = client.run({"my_input_var": "some text"})
# → {"workflow_run_id": "...", "task_id": "...", "data": {"status": "succeeded", "outputs": {...}}}

# Upload a file (use the returned `id` in subsequent run() calls)
file_meta = client.upload_file(Path("inputs/sample.xlsx"))
result = client.run(
    inputs={},
    files=[{"type": "document", "transfer_method": "local_file", "upload_file_id": file_meta["id"]}],
)
```

> Why a minimal custom client instead of `langgenius/dify-python-sdk`?
> The published `dify-client` package on PyPI doesn't include `WorkflowClient`.
> Pinning to a Git revision of the official SDK is fragile. Direct HTTP via
> `requests` is ~50 LOC, has zero dependency drift, and covers our needs.

## Snapshot testing with syrupy

```python
def test_my_workflow(workflow_client, snapshot):
    result = workflow_client.run({"text": "hello"})
    assert result["data"]["outputs"] == snapshot
```

First run:
```bash
pytest tests/test_my_workflow.py --snapshot-update
```
Writes the expected output to `tests/__snapshots__/test_my_workflow.ambr`. Commit it.

Subsequent runs verify the live workflow still produces the same output.

To update after intentional changes:
```bash
pytest tests/test_my_workflow.py --snapshot-update
git diff tests/__snapshots__/  # review changes
git add tests/__snapshots__/
```

## Skip behavior

Tests requiring credentials use the `workflow_client` fixture which calls
`pytest.skip(...)` if `DIFY_BASE_URL` and `DIFY_API_KEY` are not set in the
environment. So `pytest tests/` always succeeds locally; CI without secrets
just shows skipped tests, not failures.

## Common patterns

### Test against multiple environments

```bash
DIFY_PROJECT=my_project pytest tests/                       # → loads projects/my_project/envs/dev.env
DIFY_BASE_URL=$STAGING_URL DIFY_API_KEY=$STAGING_KEY pytest # → explicit override
```

### Use fixture files for inputs

```python
def test_file_iteration(workflow_client, fixtures_dir, snapshot):
    file_meta = workflow_client.upload_file(fixtures_dir / "sample.csv")
    result = workflow_client.run(
        inputs={},
        files=[{
            "type": "document",
            "transfer_method": "local_file",
            "upload_file_id": file_meta["id"],
        }],
    )
    assert result["data"]["outputs"] == snapshot
```

### Parametrize across multiple inputs

```python
@pytest.mark.parametrize("text,lang", [
    ("Hello", "en"),
    ("こんにちは", "ja"),
    ("Xin chào", "vi"),
])
def test_translate(workflow_client, snapshot, text, lang):
    result = workflow_client.run({"text": text, "target_lang": lang})
    assert result["data"]["outputs"]["translation"] == snapshot
```

## Limitations & roadmap

- **Console API not wrapped**: programmatic import of YAML, app creation, dataset
  management require the admin Console API (different auth scheme). Currently
  you import YAML manually in Dify UI, then test against the deployed app.
- **No docker-local Dify spin-up yet**: Phase 2 will add a `docker-compose.test.yml`
  for full e2e testing without depending on a remote workspace.
- **No mock-LLM mode**: every test call hits real models — costs real money.
  For PR CI, point `DIFY_BASE_URL` at a staging workspace with cheap models.

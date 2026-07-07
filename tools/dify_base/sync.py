#!/usr/bin/env python3
"""GitOps sync between a Dify workspace and a local project's workflows/.

Provides:
    sync.py list        — list apps in the configured workspace
    sync.py pull        — fetch app DSL YAML(s) into projects/<name>/workflows/
    sync.py diff        — show local vs remote differences
    sync.py push        — import a local YAML to the workspace as a NEW app

Authentication: uses the Dify Console API with an `Authorization: Bearer <token>`
header. TWO kinds of token work:

  A. Browser-session JWT (quick, but expires — ACCESS_TOKEN_EXPIRE_MINUTES, ~60m):
     1. Open Dify in browser, log in.
     2. DevTools → Network tab → click any /console/api call.
     3. Copy the `Authorization: Bearer <TOKEN>` header value → DIFY_CONSOLE_TOKEN.

  B. Admin API key (stable, does NOT expire — recommended for long-term/self-host):
     In the Dify docker `.env`: ADMIN_API_KEY_ENABLE=true + ADMIN_API_KEY=<key>, then
     restart the `api` container. Use that key as DIFY_CONSOLE_TOKEN AND also set
     DIFY_WORKSPACE_ID=<tenant id> — the admin-key path REQUIRES an X-WORKSPACE-ID
     header to resolve the workspace owner (dify api ext_login.load_user_from_request).
     Get the tenant id from `GET /console/api/workspaces/current` (or run `sync.py list`
     once with a JWT) → its `id`.

Required env (loaded from envs/dev.env if DIFY_PROJECT is set):
    DIFY_CONSOLE_URL    — e.g. https://cloud.dify.ai/console/api
                           or https://your-host/console/api
    DIFY_CONSOLE_TOKEN  — bearer token: a session JWT (A) or an ADMIN_API_KEY (B)
    DIFY_WORKSPACE_ID   — tenant/workspace id; REQUIRED only for the admin-key path (B)

Usage:
    python3 tools/dify_base/sync.py list
    python3 tools/dify_base/sync.py list --mode workflow
    python3 tools/dify_base/sync.py pull --project my_app --workflow summarizer --app-id <uuid>
    python3 tools/dify_base/sync.py pull --project my_app --workflow summarizer --name-contains "RAG"
    python3 tools/dify_base/sync.py diff --project my_app --workflow summarizer
    python3 tools/dify_base/sync.py push --project my_app --workflow summarizer --file workflows/main.yml

A session JWT (A) is short-lived — refresh from DevTools when console calls start
returning 401. An ADMIN_API_KEY (B) does not expire.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    print("❌ Need `requests` installed. Run: uv pip install --python .venv/bin/python requests", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

BASE = Path(__file__).parent.parent.parent


# ---------------------------------------------------------------------------
# Env loading
# ---------------------------------------------------------------------------

def _load_project_env(project: str | None) -> None:
    # Spec 030 (D2): envs are PER-PROJECT and shared by every workflow in the project.
    if load_dotenv is None or not project:
        return
    env_path = BASE / "projects" / project / "envs" / "dev.env"
    if env_path.exists():
        load_dotenv(env_path, override=False)


def _workflow_base(args) -> Path:
    """Spec 030: the on-disk base a pull/push/diff operates in. With `--workflow`, files live in the
    nested `projects/<project>/<workflow>/`; without it (back-compat / bare project), `projects/<project>/`."""
    base = BASE / "projects" / args.project
    workflow = getattr(args, "workflow", None)
    return base / workflow if workflow else base


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())
    s = re.sub(r"_+", "_", s).strip("_").lower()
    return s or "untitled"


# ---------------------------------------------------------------------------
# Console API client
# ---------------------------------------------------------------------------

class DifyConsoleClient:
    """Minimal client for Dify Console API (admin/import/export endpoints)."""

    def __init__(self, base_url: str, token: str, workspace_id: str | None = None, timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.workspace_id = workspace_id
        self.timeout = timeout

    @property
    def _headers(self) -> dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        # When DIFY_CONSOLE_TOKEN is an ADMIN_API_KEY (Dify ADMIN_API_KEY_ENABLE=true) instead of a
        # browser-session JWT, the console API also needs X-WORKSPACE-ID to resolve the workspace owner
        # (dify api ext_login.load_user_from_request). Harmless for a JWT — that path ignores the header.
        if self.workspace_id:
            headers["X-WORKSPACE-ID"] = self.workspace_id
        return headers

    def list_apps(self, page: int = 1, limit: int = 100, mode: str | None = None,
                  name: str | None = None) -> dict[str, Any]:
        params = {"page": page, "limit": limit}
        if mode:
            params["mode"] = mode
        if name:
            params["name"] = name
        r = requests.get(
            f"{self.base_url}/apps",
            headers=self._headers, params=params, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def get_app(self, app_id: str) -> dict[str, Any]:
        r = requests.get(
            f"{self.base_url}/apps/{app_id}",
            headers=self._headers, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def export_app(self, app_id: str, include_secret: bool = False) -> str:
        params = {"include_secret": "true" if include_secret else "false"}
        r = requests.get(
            f"{self.base_url}/apps/{app_id}/export",
            headers=self._headers, params=params, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()["data"]  # YAML string

    def import_app(self, yaml_content: str, name: str | None = None,
                   description: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "mode": "yaml-content",
            "yaml_content": yaml_content,
        }
        if name:
            payload["name"] = name
        if description:
            payload["description"] = description
        r = requests.post(
            f"{self.base_url}/apps/imports",
            headers=self._headers, data=json.dumps(payload), timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    # -- spec 032 live-test additions (all Console API except run_workflow, which is the Service API) --

    def list_llm_models(self) -> dict[str, Any]:
        """Enabled LLM models grouped by provider (spec 032 §Verified)."""
        r = requests.get(
            f"{self.base_url}/workspaces/current/models/model-types/llm",
            headers=self._headers, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def list_plugins(self) -> dict[str, Any]:
        """Installed plugins (spec 037 D5 — endpoint + shape verified live 2026-07-06):
        `{plugins: [{plugin_unique_identifier, name, version, checksum, …}], total}`; the
        `plugin_unique_identifier` is EXACTLY the `dependencies:` form — bare hex64 after `@`,
        no `sha256:` literal."""
        r = requests.get(
            f"{self.base_url}/workspaces/current/plugin/list",
            headers=self._headers, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def list_datasets(self, page: int = 1, limit: int = 100) -> dict[str, Any]:
        """Knowledge-base datasets (spec 037 D5 — paged envelope `{data, has_more, limit, total,
        page}`, verified live 2026-07-06)."""
        r = requests.get(
            f"{self.base_url}/datasets",
            headers=self._headers, params={"page": page, "limit": limit}, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def default_model(self, model_type: str = "llm") -> dict[str, Any]:
        """The workspace system-default for a model type (may be an invalid/unavailable model)."""
        r = requests.get(
            f"{self.base_url}/workspaces/current/default-model",
            headers=self._headers, params={"model_type": model_type}, timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def create_api_key(self, app_id: str) -> dict[str, Any]:
        """Mint an app-level API key (`app-…`) — 021 Q1(b), verified 201 (spec 032 §Verified)."""
        r = requests.post(
            f"{self.base_url}/apps/{app_id}/api-keys",
            headers=self._headers, data=json.dumps({}), timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json()

    def publish_workflow(self, app_id: str) -> dict[str, Any]:
        """Publish the app's workflow draft (import does NOT auto-publish, spec 032 §Verified)."""
        r = requests.post(
            f"{self.base_url}/apps/{app_id}/workflows/publish",
            headers=self._headers, data=json.dumps({}), timeout=self.timeout,
        )
        r.raise_for_status()
        try:
            return r.json()
        except ValueError:
            return {"result": "success"}  # some Dify builds return an empty 200 body

    def delete_app(self, app_id: str) -> None:
        r = requests.delete(
            f"{self.base_url}/apps/{app_id}",
            headers=self._headers, timeout=self.timeout,
        )
        r.raise_for_status()

    def _service_base(self) -> str:
        """The Service API base (`…/v1`). Some Dify deployments expose the service API on a DIFFERENT
        host/port than the console — set `DIFY_API_URL` (full base incl. `/v1`, e.g. http://localhost/v1)
        to override. Default: the console base minus `/console/api`, plus `/v1`."""
        override = os.environ.get("DIFY_API_URL")
        if override:
            return override.rstrip("/")
        base = re.sub(r"/console/api/?$", "", self.base_url).rstrip("/")
        return f"{base}/v1"

    @staticmethod
    def _run_timeout(read: int | None):
        # (connect, read): fail FAST on an unreachable service API (~5s); the read timeout applies BETWEEN
        # streamed chunks, so a steadily-streaming LLM never trips it. (Blocking mode held the whole
        # response and nginx reset it — spec 032; the Dify UI itself streams, verified working.)
        return (5, read or 120)

    def _run_headers(self, app_key: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {app_key}", "Content-Type": "application/json"}

    def _collect_stream(self, r: Any, chat: bool) -> dict[str, Any]:
        """Consume a Dify SSE run stream and NORMALIZE it into the blocking-response shape (so the TS
        parser is unchanged): chat → `{answer, metadata.usage.total_tokens}`; workflow → `{data:{status,
        outputs, total_tokens, error}}`. Streaming avoids the long-held blocking connection nginx resets."""
        r.raise_for_status()
        answer_parts: list[str] = []
        total_tokens = None
        outputs = None
        status = None
        error = None
        for raw in r.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            payload = raw[len("data:"):].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                ev = json.loads(payload)
            except json.JSONDecodeError:
                continue
            etype = ev.get("event")
            if etype in ("message", "agent_message"):
                answer_parts.append(ev.get("answer") or "")
            elif etype == "message_end":
                total_tokens = ((ev.get("metadata") or {}).get("usage") or {}).get("total_tokens", total_tokens)
            elif etype == "workflow_finished":
                data = ev.get("data") or {}
                status, outputs, error = data.get("status"), data.get("outputs"), data.get("error")
                total_tokens = data.get("total_tokens", total_tokens)
            elif etype == "error":
                error = ev.get("message") or ev.get("code") or "stream error"
        if chat:
            out: dict[str, Any] = {"answer": "".join(answer_parts), "metadata": {"usage": {"total_tokens": total_tokens}}}
            if error:
                out["error"] = error
            return out
        return {"data": {"status": status or ("failed" if error else "succeeded"),
                         "outputs": outputs, "total_tokens": total_tokens, "error": error}}

    def run_workflow(self, app_key: str, inputs: dict[str, Any], timeout: int | None = None) -> dict[str, Any]:
        """Run a `workflow`-mode app (streaming SSE, normalized) with the APP KEY (NOT the admin token)."""
        r = requests.post(
            f"{self._service_base()}/workflows/run",
            headers=self._run_headers(app_key),
            data=json.dumps({"inputs": inputs, "response_mode": "streaming", "user": "builder-live-test"}),
            timeout=self._run_timeout(timeout), stream=True,
        )
        return self._collect_stream(r, chat=False)

    def run_chat(self, app_key: str, inputs: dict[str, Any], query: str, timeout: int | None = None) -> dict[str, Any]:
        """Run a chat-like app (advanced-chat / chat / agent-chat) via `/chat-messages` streaming (needs `query`)."""
        r = requests.post(
            f"{self._service_base()}/chat-messages",
            headers=self._run_headers(app_key),
            data=json.dumps({
                "inputs": inputs, "query": query, "response_mode": "streaming",
                "user": "builder-live-test", "conversation_id": "",
            }),
            timeout=self._run_timeout(timeout), stream=True,
        )
        return self._collect_stream(r, chat=True)

    def run_completion(self, app_key: str, inputs: dict[str, Any], timeout: int | None = None) -> dict[str, Any]:
        """Run a `completion`-mode app via `/completion-messages` streaming (the prompt rides `inputs`)."""
        r = requests.post(
            f"{self._service_base()}/completion-messages",
            headers=self._run_headers(app_key),
            data=json.dumps({"inputs": inputs, "response_mode": "streaming", "user": "builder-live-test"}),
            timeout=self._run_timeout(timeout), stream=True,
        )
        return self._collect_stream(r, chat=False)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def _client_from_env() -> DifyConsoleClient:
    url = os.environ.get("DIFY_CONSOLE_URL")
    token = os.environ.get("DIFY_CONSOLE_TOKEN")
    workspace_id = os.environ.get("DIFY_WORKSPACE_ID")
    if not url:
        sys.exit("❌ DIFY_CONSOLE_URL not set (e.g. https://cloud.dify.ai/console/api)")
    if not token:
        sys.exit("❌ DIFY_CONSOLE_TOKEN not set — see `python3 tools/dify_base/sync.py --help`")
    return DifyConsoleClient(url, token, workspace_id=(workspace_id.strip() or None) if workspace_id else None)


def _fmt_request_error(e: requests.RequestException) -> str:
    """Return a one-line user-friendly summary of a requests exception."""
    if isinstance(e, requests.ConnectionError):
        return f"connection failed (DNS / unreachable / refused) — {e.__class__.__name__}"
    if isinstance(e, requests.Timeout):
        return f"timeout after {getattr(e.request, 'timeout', '?')}s"
    if isinstance(e, requests.HTTPError):
        resp = getattr(e, "response", None)
        code = resp.status_code if resp is not None else "?"
        body = (resp.text[:200] if resp is not None else "").replace("\n", " ")
        return f"HTTP {code} — {body}"
    return f"{e.__class__.__name__}: {e}"


def cmd_list(args) -> int:
    client = _client_from_env()
    try:
        res = client.list_apps(page=args.page, limit=args.limit, mode=args.mode, name=args.name)
    except requests.RequestException as e:
        sys.exit(f"❌ list_apps failed: {_fmt_request_error(e)}")
    apps = res.get("data", [])
    print(f"\n{len(apps)} apps (page {args.page}, limit {args.limit}):\n")
    print(f"  {'app_id':<38} {'mode':<14} {'name'}")
    print(f"  {'-' * 38} {'-' * 14} {'-' * 40}")
    for a in apps:
        print(f"  {a.get('id', '?'):<38} {a.get('mode', '?'):<14} {a.get('name', '?')}")
    total = res.get("total", len(apps))
    if total > args.limit:
        print(f"\n  → {total} total; pass --page 2 (or higher) to see more")
    return 0


def cmd_pull(args) -> int:
    client = _client_from_env()
    wf_base = _workflow_base(args)
    target_dir = wf_base / "workflows"
    if not (BASE / "projects" / args.project).exists():
        sys.exit(f"❌ Project not found: projects/{args.project}/ "
                 f"(use `init_project.py` first)")
    target_dir.mkdir(parents=True, exist_ok=True)

    # Determine which apps to fetch
    if args.app_id:
        apps = [{"id": args.app_id, "name": args.app_id, "mode": "?"}]
    else:
        try:
            res = client.list_apps(page=1, limit=200, name=args.name_contains)
        except requests.RequestException as e:
            sys.exit(f"❌ list_apps failed: {_fmt_request_error(e)}")
        apps = res.get("data", [])

    if not apps:
        print("No apps match.")
        return 0

    if not args.app_id and not args.yes:
        print(f"\nWill pull {len(apps)} apps into {target_dir.relative_to(BASE)}/")
        for a in apps[:5]:
            print(f"  - {a.get('name')} ({a.get('mode')})")
        if len(apps) > 5:
            print(f"  ... +{len(apps) - 5} more")
        if input("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
            return 0

    saved = 0
    for a in apps:
        app_id = a["id"]
        try:
            yaml_text = client.export_app(app_id, include_secret=args.include_secret)
        except requests.RequestException as e:
            print(f"  ❌ {a.get('name')} ({app_id}): {_fmt_request_error(e)}")
            continue
        slug = _slugify(a.get("name", app_id))
        out_path = target_dir / f"{slug}.yml"
        out_path.write_text(yaml_text, encoding="utf-8")
        print(f"  ✓ {out_path.relative_to(BASE)} ({len(yaml_text)} bytes)")
        saved += 1

    print(f"\n✓ Saved {saved}/{len(apps)} apps to {target_dir.relative_to(BASE)}/")
    return 0


def cmd_diff(args) -> int:
    client = _client_from_env()
    workflows_dir = _workflow_base(args) / "workflows"
    if not workflows_dir.exists():
        sys.exit(f"❌ No workflows in {workflows_dir.relative_to(BASE)}/")

    try:
        res = client.list_apps(page=1, limit=200)
    except requests.RequestException as e:
        sys.exit(f"❌ list_apps failed: {_fmt_request_error(e)}")
    remote_by_slug: dict[str, dict] = {
        _slugify(a.get("name", a["id"])): a for a in res.get("data", [])
    }

    local_files = sorted(workflows_dir.glob("*.yml"))
    changed = 0
    for local_path in local_files:
        slug = local_path.stem
        remote_app = remote_by_slug.get(slug)
        if remote_app is None:
            print(f"⚠ {local_path.relative_to(BASE)}: not found in workspace (local-only)")
            changed += 1
            continue
        try:
            remote_yaml = client.export_app(remote_app["id"], include_secret=False)
        except requests.RequestException as e:
            print(f"  ❌ {local_path.relative_to(BASE)}: {_fmt_request_error(e)}")
            continue
        local_yaml = local_path.read_text(encoding="utf-8")
        if local_yaml == remote_yaml:
            if args.verbose:
                print(f"  = {local_path.relative_to(BASE)} (in sync)")
            continue
        print(f"\nΔ {local_path.relative_to(BASE)} (remote app_id: {remote_app['id']})")
        diff = difflib.unified_diff(
            remote_yaml.splitlines(keepends=True),
            local_yaml.splitlines(keepends=True),
            fromfile=f"remote/{slug}.yml",
            tofile=f"local/{slug}.yml",
            n=2,
        )
        sys.stdout.write("".join(diff))
        changed += 1

    # Remote-only check
    local_slugs = {p.stem for p in local_files}
    for slug, app in remote_by_slug.items():
        if slug not in local_slugs:
            print(f"⚠ remote-only: {app.get('name')} ({app['id']})")
            changed += 1

    if changed == 0:
        print(f"✓ All {len(local_files)} files in sync with workspace.")
    return 0


def cmd_push(args) -> int:
    client = _client_from_env()
    # Spec 032: `--src-file` (repo-root-relative) pushes an out-of-tree file, e.g. the temp
    # `.runs/<id>/deploy.yml` the live-test writes (which is NOT under the workflow folder). It overrides
    # the default workflow-relative `--file`. Exactly one must resolve to an existing file.
    if getattr(args, "src_file", None):
        src = BASE / args.src_file
    elif args.file:
        src = _workflow_base(args) / args.file
    else:
        sys.exit("❌ push needs --file (workflow-relative) or --src-file (repo-relative)")
    if not src.exists():
        sys.exit(f"❌ File not found: {src}")
    yaml_content = src.read_text(encoding="utf-8")

    if not args.yes:
        print(f"\nWill push {src.relative_to(BASE)} ({len(yaml_content)} bytes) as a NEW app.")
        print("⚠ Dify import always creates a new app. To update an existing app,")
        print("  delete the old one first, or use copy/duplicate via the Dify UI.")
        if input("Proceed? [y/N] ").strip().lower() not in ("y", "yes"):
            return 0

    try:
        result = client.import_app(yaml_content, name=args.name, description=args.description)
    except requests.RequestException as e:
        sys.exit(f"❌ import_app failed: {_fmt_request_error(e)}")
    if args.json_out:
        # Machine-readable: the raw import-endpoint r.json() on ONE line, nothing else, so a caller
        # can JSON.parse the last stdout line. The new app id lives under `app_id` — a real Cloud
        # Dify POST /console/api/apps/imports returned `{app_id, status, error, current_dsl_version}`
        # (verified, spec 008-meta-workflow-builder.md:51). Self-hosted may differ, so consumers read
        # `app_id` first and fall back (e.g. `id`) / to a `list`-reconcile.
        print(json.dumps(result))
        return 0
    print(f"\n✓ Import result: {json.dumps(result, indent=2)}")
    return 0


# -- spec 032 live-test commands (JSON-out on one line so a caller JSON.parses the last stdout line) --

def cmd_models(args) -> int:
    client = _client_from_env()
    try:
        enabled = client.list_llm_models()
        default = client.default_model("llm")
    except requests.RequestException as e:
        sys.exit(f"❌ models failed: {_fmt_request_error(e)}")
    # `enabled.data` = providers each with a `models` list; `default.data` = {model, provider} | null.
    print(json.dumps({"enabled": enabled.get("data", []), "default": default.get("data")}))
    return 0


def cmd_plugins(args) -> int:
    client = _client_from_env()
    try:
        res = client.list_plugins()
    except requests.RequestException as e:
        sys.exit(f"❌ plugins failed: {_fmt_request_error(e)}")
    # spec 037 D5: emit only what the harvester needs — name + the dependencies-form identifier.
    plugins = [{"name": p.get("name"), "identifier": p.get("plugin_unique_identifier")}
               for p in (res.get("plugins") or []) if p.get("plugin_unique_identifier")]
    print(json.dumps({"plugins": plugins}))
    return 0


def cmd_datasets(args) -> int:
    client = _client_from_env()
    try:
        res = client.list_datasets()
    except requests.RequestException as e:
        sys.exit(f"❌ datasets failed: {_fmt_request_error(e)}")
    datasets = [{"id": d.get("id"), "name": d.get("name")}
                for d in (res.get("data") or []) if d.get("id")]
    print(json.dumps({"datasets": datasets}))
    return 0


def cmd_api_key(args) -> int:
    client = _client_from_env()
    try:
        res = client.create_api_key(args.app_id)
    except requests.RequestException as e:
        sys.exit(f"❌ api_key failed: {_fmt_request_error(e)}")
    print(json.dumps(res))  # {token: "app-…", …} — caller reads `token`
    return 0


def cmd_publish(args) -> int:
    client = _client_from_env()
    try:
        res = client.publish_workflow(args.app_id)
    except requests.RequestException as e:
        sys.exit(f"❌ publish failed: {_fmt_request_error(e)}")
    print(json.dumps(res))
    return 0


def cmd_delete(args) -> int:
    client = _client_from_env()
    try:
        client.delete_app(args.app_id)
    except requests.RequestException as e:
        sys.exit(f"❌ delete failed: {_fmt_request_error(e)}")
    print(json.dumps({"deleted": args.app_id}))
    return 0


def cmd_inject_model(args) -> int:
    # Spec 032 §2: write a TEMP copy of a workflow YAML with `model` filled into empty/invalid llm nodes,
    # so the on-disk main.yml stays model-agnostic (portable) while the pushed copy is runnable. LOCAL
    # file I/O only — no Dify creds. Reformatting/comment-loss on the throwaway copy is fine (Dify parses
    # structure, not comments).
    try:
        import yaml  # PyYAML (in the venv; the linters use it)
    except ImportError:
        sys.exit("❌ PyYAML not installed in the venv (needed for inject-model)")
    src = BASE / args.src
    out = BASE / args.out
    if not src.exists():
        sys.exit(f"❌ File not found: {src}")
    # Guard the portability invariant (spec 032 B5): NEVER write over the source — main.yml must stay
    # model-agnostic. Also refuse an --out that escapes the repo (an absolute --out wins under pathlib).
    if out.resolve() == src.resolve():
        sys.exit("❌ --out must differ from --src (refusing to overwrite the source YAML)")
    if not out.resolve().is_relative_to(BASE.resolve()):
        sys.exit("❌ --out must stay within the repo")
    try:
        data = yaml.safe_load(src.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        sys.exit(f"❌ source YAML parse failed: {e}")
    valid = {v for v in (args.valid_names or "").split(",") if v} or None
    patched: list[str] = []
    nodes = (((data or {}).get("workflow") or {}).get("graph") or {}).get("nodes") or []
    for n in nodes:
        nd = n.get("data") or {}
        if nd.get("type") != "llm":
            continue
        model = nd.get("model")
        if not isinstance(model, dict):
            model = {}
            nd["model"] = model
        cur = model.get("name") or ""
        # patch an EMPTY name (the primary observed failure) OR one that isn't in the enabled set.
        if (not cur) or (valid is not None and cur not in valid):
            model["provider"] = args.provider
            model["name"] = args.name
            patched.append(str(n.get("id", "?")))
    # Spec 032 D8: also surface the start-node input schema so the caller can build a sample run input.
    inputs_schema = []
    for n in nodes:
        nd = n.get("data") or {}
        if nd.get("type") == "start":
            for v in (nd.get("variables") or []):
                inputs_schema.append({
                    "variable": v.get("variable"),
                    "type": v.get("type"),
                    "required": bool(v.get("required")),
                    "label": v.get("label"),
                    "options": v.get("options") or [],
                })
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    # Spec 032: the app mode decides the run endpoint (workflow vs chat vs completion). Prefer app.mode;
    # else infer from node types (an `answer` node ⇒ chat-like, else workflow).
    mode = (data.get("app") or {}).get("mode") or ""
    if not mode:
        types = {(n.get("data") or {}).get("type") for n in nodes}
        mode = "advanced-chat" if "answer" in types else "workflow"
    print(json.dumps({
        "node_count": len(patched), "patched": patched,
        "out": str(out.relative_to(BASE)), "inputs": inputs_schema, "mode": mode,
    }))
    return 0


def cmd_run(args) -> int:
    # B3 (spec 032): the app key comes on the CHILD ENV (DIFY_APP_KEY), never argv — argv is visible via
    # `ps`, so a key passed as --app-key would leak. The backend injects it on this subprocess's env.
    app_key = os.environ.get("DIFY_APP_KEY")
    if not app_key:
        sys.exit("❌ DIFY_APP_KEY not set (the app-level key; injected on the child env, never argv)")
    client = _client_from_env()
    try:
        inputs = json.loads(args.inputs) if args.inputs else {}
    except json.JSONDecodeError as e:
        sys.exit(f"❌ --inputs is not valid JSON: {e}")
    mode = (args.mode or "workflow").lower()
    timeout = args.timeout or None
    try:
        if mode in ("advanced-chat", "chat", "agent-chat"):
            res = client.run_chat(app_key, inputs, args.query or "Hello", timeout=timeout)
        elif mode == "completion":
            res = client.run_completion(app_key, inputs, timeout=timeout)
        else:
            res = client.run_workflow(app_key, inputs, timeout=timeout)
    except requests.RequestException as e:
        sys.exit(f"❌ run failed: {_fmt_request_error(e)}")
    print(json.dumps(res))
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List apps in the workspace")
    p_list.add_argument("--project", help="Load envs/dev.env from this project")
    p_list.add_argument("--page", type=int, default=1)
    p_list.add_argument("--limit", type=int, default=100)
    p_list.add_argument("--mode", help="Filter by mode (workflow / chat / agent-chat / completion)")
    p_list.add_argument("--name", help="Filter by name (substring)")
    p_list.set_defaults(func=cmd_list)

    p_pull = sub.add_parser("pull", help="Fetch app DSL YAML(s) into projects/<project>/<workflow>/workflows/")
    p_pull.add_argument("--project", required=True, help="Target project name (folder under projects/)")
    p_pull.add_argument("--workflow", help="Target workflow subfolder (spec 030); omit for a bare project")
    g = p_pull.add_mutually_exclusive_group()
    g.add_argument("--app-id", help="Pull a single app by UUID")
    g.add_argument("--name-contains", help="Pull all apps with name matching this substring")
    p_pull.add_argument("--include-secret", action="store_true",
                        help="Include env var secret values in export (NOT recommended)")
    p_pull.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    p_pull.set_defaults(func=cmd_pull)

    p_diff = sub.add_parser("diff", help="Compare local workflows/ vs remote workspace")
    p_diff.add_argument("--project", required=True)
    p_diff.add_argument("--workflow", help="Target workflow subfolder (spec 030); omit for a bare project")
    p_diff.add_argument("--verbose", "-v", action="store_true",
                        help="Also show in-sync files")
    p_diff.set_defaults(func=cmd_diff)

    p_push = sub.add_parser("push", help="Import a local YAML into the workspace as a NEW app")
    p_push.add_argument("--project", required=True)
    p_push.add_argument("--workflow", help="Target workflow subfolder (spec 030); omit for a bare project")
    p_push.add_argument("--file",
                        help="Path relative to projects/<project>/<workflow>/, e.g. workflows/main.yml")
    p_push.add_argument("--src-file",
                        help="Repo-root-relative path (overrides --file), e.g. apps/builder/.runs/<id>/deploy.yml")
    p_push.add_argument("--name", help="Override app name from YAML")
    p_push.add_argument("--description", help="Override description")
    p_push.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    p_push.add_argument("--json-out", action="store_true",
                        help="Print machine-readable JSON of the import result (raw r.json()) and nothing else")
    p_push.set_defaults(func=cmd_push)

    # -- spec 032 live-test subcommands (JSON-out on the last stdout line) --
    p_models = sub.add_parser("models", help="List enabled LLM models + the system default (JSON)")
    p_models.add_argument("--project", help="Load envs/dev.env from this project")
    p_models.set_defaults(func=cmd_models)

    p_plugins = sub.add_parser("plugins", help="List installed plugins with dependencies-form identifiers (JSON; spec 037)")
    p_plugins.add_argument("--project", help="Load envs/dev.env from this project")
    p_plugins.set_defaults(func=cmd_plugins)

    p_datasets = sub.add_parser("datasets", help="List knowledge-base datasets {id, name} (JSON; spec 037)")
    p_datasets.add_argument("--project", help="Load envs/dev.env from this project")
    p_datasets.set_defaults(func=cmd_datasets)

    p_key = sub.add_parser("api-key", help="Mint an app-level API key for an app (JSON {token})")
    p_key.add_argument("--app-id", required=True)
    p_key.add_argument("--project", help="Load envs/dev.env from this project")
    p_key.set_defaults(func=cmd_api_key)

    p_pub = sub.add_parser("publish", help="Publish an app's workflow draft (JSON)")
    p_pub.add_argument("--app-id", required=True)
    p_pub.add_argument("--project", help="Load envs/dev.env from this project")
    p_pub.set_defaults(func=cmd_publish)

    p_del = sub.add_parser("delete", help="Delete an app by id (JSON)")
    p_del.add_argument("--app-id", required=True)
    p_del.add_argument("--project", help="Load envs/dev.env from this project")
    p_del.set_defaults(func=cmd_delete)

    p_inj = sub.add_parser("inject-model",
                           help="Write a copy of a workflow YAML with a model filled into empty/invalid llm nodes")
    p_inj.add_argument("--src", required=True, help="Source YAML path relative to repo root")
    p_inj.add_argument("--out", required=True, help="Output YAML path relative to repo root")
    p_inj.add_argument("--provider", required=True)
    p_inj.add_argument("--name", required=True)
    p_inj.add_argument("--valid-names",
                       help="Comma-separated enabled model names; a node whose name is not among these is also patched")
    p_inj.set_defaults(func=cmd_inject_model)

    p_run = sub.add_parser("run", help="Run a published workflow via the Service API (app key from DIFY_APP_KEY env)")
    p_run.add_argument("--inputs", help="JSON object of workflow inputs (non-secret; argv is fine)")
    p_run.add_argument("--mode", help="App mode: workflow | advanced-chat | chat | agent-chat | completion")
    p_run.add_argument("--query", help="The chat message for a chat-like app (advanced-chat/chat/agent-chat)")
    p_run.add_argument("--timeout", type=int, help="Per-run HTTP timeout seconds")
    p_run.add_argument("--project", help="Load envs/dev.env from this project")
    p_run.set_defaults(func=cmd_run)

    args = p.parse_args()
    if hasattr(args, "project"):
        _load_project_env(args.project)

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

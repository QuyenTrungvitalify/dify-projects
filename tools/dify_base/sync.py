#!/usr/bin/env python3
"""GitOps sync between a Dify workspace and a local project's workflows/.

Provides:
    sync.py list        — list apps in the configured workspace
    sync.py pull        — fetch app DSL YAML(s) into projects/<name>/workflows/
    sync.py diff        — show local vs remote differences
    sync.py push        — import a local YAML to the workspace as a NEW app

Authentication: uses the Dify Console API which requires a bearer access token.
There's no public API key path for export/import — you need a token from a
logged-in browser session.

How to get the token:
  1. Open Dify in browser, log in.
  2. DevTools → Network tab → click any console API call (any page reload).
  3. Copy the `Authorization: Bearer <TOKEN>` header value.
  4. Paste into projects/<your_project>/envs/dev.env as DIFY_CONSOLE_TOKEN.

Required env (loaded from envs/dev.env if DIFY_PROJECT is set):
    DIFY_CONSOLE_URL    — e.g. https://cloud.dify.ai/console/api
                           or https://your-host/console/api
    DIFY_CONSOLE_TOKEN  — bearer access token

Usage:
    python3 tools/dify_base/sync.py list
    python3 tools/dify_base/sync.py list --mode workflow
    python3 tools/dify_base/sync.py pull --project my_app
    python3 tools/dify_base/sync.py pull --project my_app --app-id <uuid>
    python3 tools/dify_base/sync.py pull --project my_app --name-contains "RAG"
    python3 tools/dify_base/sync.py diff --project my_app
    python3 tools/dify_base/sync.py push --project my_app --file workflows/main.yml

Tokens are session-scoped — refresh by getting a fresh one from DevTools when
console calls start returning 401.
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
    if load_dotenv is None or not project:
        return
    env_path = BASE / "projects" / project / "envs" / "dev.env"
    if env_path.exists():
        load_dotenv(env_path, override=False)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip())
    s = re.sub(r"_+", "_", s).strip("_").lower()
    return s or "untitled"


# ---------------------------------------------------------------------------
# Console API client
# ---------------------------------------------------------------------------

class DifyConsoleClient:
    """Minimal client for Dify Console API (admin/import/export endpoints)."""

    def __init__(self, base_url: str, token: str, timeout: int = 60):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }

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


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def _client_from_env() -> DifyConsoleClient:
    url = os.environ.get("DIFY_CONSOLE_URL")
    token = os.environ.get("DIFY_CONSOLE_TOKEN")
    if not url:
        sys.exit("❌ DIFY_CONSOLE_URL not set (e.g. https://cloud.dify.ai/console/api)")
    if not token:
        sys.exit("❌ DIFY_CONSOLE_TOKEN not set — see `python3 tools/dify_base/sync.py --help`")
    return DifyConsoleClient(url, token)


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
    target_dir = BASE / "projects" / args.project / "workflows"
    if not target_dir.parent.exists():
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
    workflows_dir = BASE / "projects" / args.project / "workflows"
    if not workflows_dir.exists():
        sys.exit(f"❌ No workflows in projects/{args.project}/workflows/")

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
    src = BASE / "projects" / args.project / args.file
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

    p_pull = sub.add_parser("pull", help="Fetch app DSL YAML(s) into projects/<name>/workflows/")
    p_pull.add_argument("--project", required=True, help="Target project name (folder under projects/)")
    g = p_pull.add_mutually_exclusive_group()
    g.add_argument("--app-id", help="Pull a single app by UUID")
    g.add_argument("--name-contains", help="Pull all apps with name matching this substring")
    p_pull.add_argument("--include-secret", action="store_true",
                        help="Include env var secret values in export (NOT recommended)")
    p_pull.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    p_pull.set_defaults(func=cmd_pull)

    p_diff = sub.add_parser("diff", help="Compare local workflows/ vs remote workspace")
    p_diff.add_argument("--project", required=True)
    p_diff.add_argument("--verbose", "-v", action="store_true",
                        help="Also show in-sync files")
    p_diff.set_defaults(func=cmd_diff)

    p_push = sub.add_parser("push", help="Import a local YAML into the workspace as a NEW app")
    p_push.add_argument("--project", required=True)
    p_push.add_argument("--file", required=True,
                        help="Path relative to projects/<project>/, e.g. workflows/main.yml")
    p_push.add_argument("--name", help="Override app name from YAML")
    p_push.add_argument("--description", help="Override description")
    p_push.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    p_push.add_argument("--json-out", action="store_true",
                        help="Print machine-readable JSON of the import result (raw r.json()) and nothing else")
    p_push.set_defaults(func=cmd_push)

    args = p.parse_args()
    if hasattr(args, "project"):
        _load_project_env(args.project)

    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())

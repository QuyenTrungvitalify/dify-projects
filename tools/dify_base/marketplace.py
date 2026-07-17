#!/usr/bin/env python3
"""marketplace.py — resolve a Dify plugin's dependency identifier from the PUBLIC marketplace.

Spec 067 S2. Deliberately NOT part of sync.py's console client: this talks to a different host
(marketplace.dify.ai), needs **no auth**, and works for plugins nobody has installed. Mixing it into
`_client_from_env` would inherit a creds requirement that does not exist and cannot fail this way.

WHY this exists — AGENTS.md §4.3 used to say the `@<sha256>` was "workspace-specific — copy it from a
YAML exported by the target Dify workspace. NEVER fabricate." That was **false**, and the cost was
real: `②Spec` obeyed it and refused to build tool nodes at all, so a stakeholder asking for
spreadsheet integration was told it could not be done. The hash is the marketplace **package
checksum**, keyed to (plugin, version), identical in every workspace. Proof, 2026-07-16: this repo's
own workspace exports (`projects/_drafts/3_3/workflows/main.yml:12,15`) match the public API
byte-for-byte for `langgenius/openai:0.2.8` and `langgenius/gemini:0.9.1`.

Usage:
  marketplace.py resolve <org>/<name>[/<version>]   # → {"unique_identifier": …, "version": …}
  marketplace.py tools   <org>/<name>[/<version>]   # → the node-building fields + tool list
  marketplace.py catalog <org>/<name>[/<version>] … # → a catalog fragment for templates/tool-catalog.json

Version: pin it. The hash is version-keyed, so `latest_package_identifier` drifts as the plugin is
upgraded (AGENTS.md §4.3's one surviving caveat). Omitting <version> resolves `latest_version` and
reports which version that was, so a caller can pin it deliberately rather than by accident.
"""
from __future__ import annotations

import json
import re
import sys

try:
    import requests
except ImportError:  # pragma: no cover - the repo venv always has it
    print(json.dumps({"error": "requests not available"})); sys.exit(1)

BASE = "https://marketplace.dify.ai/api/v1/plugins"
TIMEOUT = 20
# The exact `dependencies[].value.marketplace_plugin_unique_identifier` form that
# tools/dify_base/lint_plugin_hashes.py enforces — assert it here so a marketplace shape change is
# caught at the source instead of by a linter three steps later.
IDENTIFIER_RE = re.compile(r"^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$")


def _get(path: str) -> dict:
    """GET + unwrap the v1 `{code, data, msg}` envelope. Verified live 2026-07-17 — the two endpoints
    return DIFFERENT shapes, so callers ask for the inner key they want:
      /<org>/<name>            → data.plugin  (label, latest_version, latest_package_identifier, tool…)
      /<org>/<name>/<version>  → data.version (unique_identifier, checksum, status …)
    """
    r = requests.get(f"{BASE}/{path}", timeout=TIMEOUT)
    r.raise_for_status()
    body = r.json()
    return body.get("data") if isinstance(body.get("data"), dict) else body


def _plugin(org: str, name: str) -> dict:
    return _get(f"{org}/{name}").get("plugin") or {}


def _version(org: str, name: str, version: str) -> dict:
    return _get(f"{org}/{name}/{version}").get("version") or {}


def _split(ref: str) -> tuple[str, str, str | None]:
    parts = ref.strip("/").split("/")
    if len(parts) == 2:
        return parts[0], parts[1], None
    if len(parts) == 3:
        return parts[0], parts[1], parts[2]
    raise ValueError(f"expected <org>/<name> or <org>/<name>/<version>, got {ref!r}")


def resolve(ref: str) -> dict:
    """The dependency identifier for <org>/<name>[/<version>]. No auth, no install needed."""
    org, name, version = _split(ref)
    if version is None:
        version = _plugin(org, name).get("latest_version")
        if not version:
            raise ValueError(f"{org}/{name}: marketplace reports no latest_version")
    ident = _version(org, name, version).get("unique_identifier")
    if not ident:
        raise ValueError(f"{org}/{name}/{version}: no unique_identifier in the response")
    if not IDENTIFIER_RE.match(ident):
        # Never emit something a build would paste into `dependencies:` and only discover is wrong at
        # import time — fail loudly at the source instead.
        raise ValueError(f"identifier {ident!r} does not match the dependencies form (marketplace shape drift?)")
    return {"unique_identifier": ident, "version": version, "org": org, "name": name}


def tool_fields(ref: str) -> dict:
    """Everything a `type: tool` node needs, plus its `dependencies:` identifier.

    The DSL requires [provider_id, provider_type, provider_name, tool_name, tool_label,
    tool_configurations, title, tool_parameters] (schemas/dify-dsl-0.6.0.json:6291-6300);
    `plugin_unique_identifier` on the NODE is optional (:6204-6212) — the hash that matters rides the
    top-level `dependencies:` array, which is what arms Dify's install prompt.
    """
    r = resolve(ref)
    # The tool DECLARATION lives on the plugin endpoint, not the version one (verified live).
    plugin = _plugin(r["org"], r["name"])
    category = plugin.get("category")
    tool_decl = plugin.get("tool") or {}
    identity = tool_decl.get("identity") or {}
    provider = identity.get("name") or r["name"]
    tools = []
    for t in tool_decl.get("tools") or []:
        ident = t.get("identity") or {}
        label = ident.get("label") or {}
        tools.append({
            "tool_name": ident.get("name"),
            "tool_label": label.get("en_US") if isinstance(label, dict) else label,
            "parameters": [
                {"name": (p.get("name") or ((p.get("identity") or {}).get("name"))),
                 "type": p.get("type"),
                 "required": bool(p.get("required"))}
                for p in (t.get("parameters") or [])
            ],
        })
    if category != "tool" or not tools:
        # An honest hole beats a silent one. `langgenius/jina` is `category: model` and declares ZERO
        # tools — it is a model PROVIDER, unusable as a `type: tool` node. Returning it with an empty
        # tools list would put a plugin in the catalog that a build could never use, and the failure
        # would surface as a mystery at runtime.
        raise ValueError(
            f"{r['org']}/{r['name']} is category={category!r} with {len(tools)} tools — not usable as a "
            f"`type: tool` node (a model/agent/endpoint plugin belongs in `dependencies:` via its own path)"
        )
    # The node-identity shape is NOT inferred from this API — it is the one this repo already
    # documented and verified against a lint-clean build: docs/runtime-supplement.md §"md_to_xlsx tool
    # node — the correct `builtin` shape". Two traps it records, both of which an earlier draft of this
    # file got wrong:
    #   * provider_type is `builtin`, NOT `plugin`. Counter-intuitive, but it is what Dify emits and
    #     consumes: vendor/dify-src/api/core/tools/tool_manager.py:985-987 dispatches BUILT_IN to the
    #     PluginToolProviderController, and all 16 real tool nodes in corpus/ use `builtin`.
    #   * provider_name is the FULL 3-segment path — identical to provider_id ("provider name doubled").
    #     A 2-segment value raises ValueError in vendor/dify-src/api/models/provider_ids.py:24-29
    #     (GenericProviderID accepts `org/plugin/provider`, or a bare name it expands to
    #     `langgenius/$v/$v` — never `org/plugin`).
    provider_path = f"{r['org']}/{r['name']}/{provider}"
    return {
        "provider_id": provider_path,
        "provider_type": "builtin",
        "provider_name": provider_path,
        # `plugin_id` (org/plugin) is the dependency-identifier prefix — the key that ties a tool node
        # to its `dependencies:` entry (lint_plugin_hashes.py's coverage gate).
        "plugin_id": f"{r['org']}/{r['name']}",
        "category": category,
        "dependency_identifier": r["unique_identifier"],
        "version": r["version"],
        "tools": tools,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__); return 2
    cmd, refs = argv[0], argv[1:]
    try:
        if cmd == "resolve":
            print(json.dumps(resolve(refs[0]), ensure_ascii=False))
        elif cmd == "tools":
            print(json.dumps(tool_fields(refs[0]), ensure_ascii=False, indent=2))
        elif cmd == "catalog":
            print(json.dumps({"tools": [tool_fields(r) for r in refs]}, ensure_ascii=False, indent=2))
        else:
            print(f"unknown command {cmd!r}", file=sys.stderr); return 2
    except Exception as e:  # noqa: BLE001 — a CLI: one line out, non-zero, never a traceback
        print(f"❌ {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

#!/usr/bin/env python3
"""Generate JSON Schema for Dify DSL by reverse-engineering upstream pydantic models.

Reads pydantic NodeData classes from a local Dify source clone and emits a
JSON Schema bundle that VS Code / `check-jsonschema` can use to validate
workflow YAML files.

Output: schemas/dify-dsl-<version>.json

Usage:
    python3 schemas/gen_schema.py                # use vendor/dify-src/
    python3 schemas/gen_schema.py --dify-src /path/to/dify
    python3 schemas/gen_schema.py --yes          # auto-overwrite without prompt
    uv run --python 3.12 schemas/gen_schema.py   # if your default Python is too old

Requirements: Python 3.11+ (Dify minimum), pydantic 2.x, pyyaml (for version read).
"""
from __future__ import annotations

import argparse
import difflib
import importlib
import importlib.util
import json
import os
import re
import sys
import traceback
import types
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import MagicMock


_STUBBED_MODULES: set[str] = set()

# Top-level Dify packages we always stub upfront — these pull in Flask, SQLAlchemy,
# Redis, etc. and aren't needed to extract node-data pydantic schemas.
PRE_STUB_PACKAGES = [
    "models",
    "extensions",
    "controllers",
    "services",
    "tasks",
    "schedule",
    "events",
    "factories",
    "libs",
    "configs",
    "repositories",
    "flask_sqlalchemy",
    "flask_login",
    "flask_restful",
    "flask_cors",
    "celery",
    "boto3",
    "psycopg2",
]
# Agent node needs two workarounds to import cleanly:
#   1. `core.mcp.session.client_session` evaluates
#      `Implementation(version=dify_config.project.version)` at import time.
#      With `dify_config` stubbed, that version is a permissive object that
#      pydantic's strict `str` validator rejects. We can't stub all of
#      `core.mcp` (would shadow real `core.workflow` imports), so we patch
#      only `Implementation` — see `_install_narrow_mcp_stubs()` below.
#   2. Agent's transitive imports (via `core.tools.entities`) leave sys.modules
#      in a state where later-loaded nodes' `__init_subclass__` checks reject
#      their generics. We process agent last so the contamination has no
#      successors — see the sort in `main()`.


class _SmartConfigStub:
    """Stub for `configs.dify_config` — returns sensible-type defaults based on
    attribute name pattern. Real Dify has hundreds of config attrs; we infer
    types from common naming conventions so pydantic field defaults type-check.
    """
    _INT_KEYWORDS = ("TIMEOUT", "MAX_", "MIN_", "_LIMIT", "_SIZE", "RETRIES",
                     "NUM_", "_NUMS", "BATCH", "PORT", "DEPTH", "COUNT",
                     "INTERVAL", "_LENGTH", "_BYTES")
    _BOOL_KEYWORDS = ("ENABLED", "IS_", "_ENABLE", "ALLOW_", "_DEBUG")
    _LIST_KEYWORDS = ("_LIST", "ALLOWED_")

    def __getattr__(self, name: str):
        if any(kw in name for kw in self._INT_KEYWORDS):
            return 30
        if any(kw in name for kw in self._BOOL_KEYWORDS):
            return False
        if any(kw in name for kw in self._LIST_KEYWORDS):
            return []
        # Default: return a permissive object so chained access (.foo.bar) works
        return _make_permissive_class(name)()

    def __repr__(self):
        return "<_SmartConfigStub>"


class _PermissiveMeta(type):
    """Metaclass that returns more permissive classes on any missing attribute access.

    Lets code like `dify_config.ETL_TYPE` (class-level attribute lookup) succeed
    by minting a fresh _PermissiveType subclass on demand.
    """

    def __getattr__(cls, attr: str):
        sub = _make_permissive_class(f"{cls.__name__}.{attr}")
        setattr(cls, attr, sub)
        return sub


class _PermissiveType(metaclass=_PermissiveMeta):
    """Stub class that pydantic v2 accepts as Any when used as a field annotation."""

    @classmethod
    def __get_pydantic_core_schema__(cls, source_type, handler):
        from pydantic_core import core_schema
        return core_schema.any_schema()

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, *args, **kwargs):
        return self

    def __getitem__(self, item):
        return self

    def __iter__(self):
        return iter([])

    def __getattr__(self, item):
        # Any unknown attribute on a _PermissiveType *instance* — return another
        # permissive instance so chained `.foo.bar.baz` accesses don't fail.
        return _make_permissive_class(item)()


def _make_permissive_class(name: str) -> type:
    """Create a unique _PermissiveType subclass with the given name."""
    return _PermissiveMeta(f"_Stub_{name}", (_PermissiveType,), {})


class _PermissiveModule(types.ModuleType):
    """A stub module that returns _PermissiveType subclasses for any attribute access."""

    def __getattr__(self, attr: str):
        cls = _make_permissive_class(attr)
        setattr(self, attr, cls)
        return cls


def _stub_module(name: str) -> None:
    """Install a permissive stub for `name` (and create parent packages so Python
    can resolve the dotted import). Only the EXACT `name` is tracked in
    _STUBBED_MODULES — parents are minimally registered but not claimed as
    stubs, so real submodules under them can still load.
    """
    parts = name.split(".")
    for i in range(len(parts)):
        sub = ".".join(parts[: i + 1])
        is_target = (sub == name)
        if sub in sys.modules:
            if is_target:
                _STUBBED_MODULES.add(sub)
            continue
        m = _PermissiveModule(sub)
        m.__path__ = []
        sys.modules[sub] = m
        if is_target:
            _STUBBED_MODULES.add(sub)


class _StubFinder:
    """Meta-path finder: any import whose top-level package is in PRE_STUB_PACKAGES
    (or already stubbed) gets a stub module auto-created. This handles deeply
    nested imports like `libs.exception.MyError` that the pre-stub of `libs`
    alone doesn't cover.
    """

    def find_spec(self, fullname: str, path, target=None):
        import importlib.machinery
        # Only intercept if fullname IS a stubbed path or is nested under one.
        # Top-level packages aren't considered stubbed just because a sibling is.
        for stub_path in tuple(PRE_STUB_PACKAGES) + tuple(_STUBBED_MODULES):
            if fullname == stub_path or fullname.startswith(stub_path + "."):
                return importlib.machinery.ModuleSpec(fullname, self)
        return None

    def create_module(self, spec):
        m = _PermissiveModule(spec.name)
        m.__path__ = []
        _STUBBED_MODULES.add(spec.name)
        return m

    def exec_module(self, module):
        pass


_MISSING_RE = re.compile(r"No module named ['\"]([^'\"]+)['\"]")


def robust_import(module_path: str, max_retries: int = 30) -> tuple[object | None, str | None]:
    """Import `module_path`, stubbing missing deps with MagicMock and retrying."""
    last_err = None
    for _ in range(max_retries):
        try:
            # Force re-import after stubbing
            if module_path in sys.modules:
                del sys.modules[module_path]
            return importlib.import_module(module_path), None
        except ModuleNotFoundError as e:
            m = _MISSING_RE.search(str(e))
            if not m:
                return None, f"{type(e).__name__}: {e}"
            missing = m.group(1)
            if missing in _STUBBED_MODULES:
                # Already stubbed but still failing → give up
                return None, f"{type(e).__name__}: {e} (after stubbing)"
            _stub_module(missing)
            last_err = str(e)
        except Exception as e:
            return None, f"{type(e).__name__}: {e}"
    return None, f"max_retries exceeded; last error: {last_err}"

def _install_narrow_mcp_stubs() -> None:
    """Replace `core.mcp.types.Implementation` with a permissive variant.

    The real class strictly validates `version: str`. Downstream module
    `core.mcp.session.client_session` instantiates `Implementation(version=
    dify_config.project.version)` at import time; with dify_config stubbed,
    that arg is a permissive object and pydantic rejects it. We import the
    real module first (so siblings like JSONRPCMessage stay intact) and then
    override only `Implementation`.
    """
    try:
        real_mod = importlib.import_module("core.mcp.types")
        from pydantic import BaseModel, ConfigDict

        class Implementation(BaseModel):
            model_config = ConfigDict(extra="allow")
            name: str = "stub"
            version: str = "0.0.0"

            def __init__(self, **data):
                # Coerce non-string fields to strings so the permissive stub
                # doesn't break real callers that pass actual strings either.
                if "version" in data and not isinstance(data["version"], str):
                    data["version"] = str(data["version"])
                if "name" in data and not isinstance(data["name"], str):
                    data["name"] = str(data["name"])
                super().__init__(**data)

        real_mod.Implementation = Implementation
    except Exception as e:  # pragma: no cover — best-effort
        print(f"  ⚠ MCP narrow stub failed: {e}", file=sys.stderr)


REPO_ROOT = Path(__file__).resolve().parent.parent
VENDOR_DIFY_SRC = REPO_ROOT / "vendor" / "dify-src"
LEGACY_DIFY_SRC = Path.home() / "Desktop" / "MyProjects" / "dify-workspace"
DEFAULT_DIFY_SRC = VENDOR_DIFY_SRC
NODES_SUBPATH = "api/core/workflow/nodes"
DSL_SERVICE_SUBPATH = "api/services/app_dsl_service.py"


@dataclass
class NodeResult:
    node_dir: str
    classes: list[str]
    schema: dict | None
    error: str | None = None


def read_dsl_version(dify_src: Path) -> str:
    """Extract DSL version constant from upstream source.

    Older Dify (<= v1.13.x): literal CURRENT_DSL_VERSION = "0.6.0" in
    api/services/app_dsl_service.py.

    Newer Dify (>= v1.14.0): CURRENT_DSL_VERSION = CURRENT_APP_DSL_VERSION
    (alias) and the literal lives in api/constants/dsl_version.py.
    """
    # Try the alias source first (v1.14+)
    constants = dify_src / "api" / "constants" / "dsl_version.py"
    if constants.exists():
        m = re.search(r'CURRENT_APP_DSL_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]',
                      constants.read_text(encoding="utf-8"))
        if m:
            return m.group(1)

    # Legacy literal in services/app_dsl_service.py
    f = dify_src / DSL_SERVICE_SUBPATH
    if not f.exists():
        return "unknown"
    text = f.read_text(encoding="utf-8")
    m = re.search(r'CURRENT_DSL_VERSION\s*=\s*[\'"]([^\'"]+)[\'"]', text)
    return m.group(1) if m else "unknown"


def discover_node_dirs(dify_src: Path) -> list[Path]:
    """Return list of node directories under api/core/workflow/nodes/."""
    nodes_root = dify_src / NODES_SUBPATH
    return sorted(
        p for p in nodes_root.iterdir()
        if p.is_dir() and not p.name.startswith("_") and (p / "entities.py").exists()
    )


def import_node_entities(node_dir: Path, dify_src: Path) -> tuple[object | None, str | None]:
    """Import the `entities` module of a node directory, with auto-stubbing."""
    api_dir = dify_src / "api"
    if str(api_dir) not in sys.path:
        sys.path.insert(0, str(api_dir))
    module_path = f"core.workflow.nodes.{node_dir.name}.entities"
    return robust_import(module_path)


def schemas_from_module(module) -> dict[str, dict]:
    """Find BaseNodeData subclasses and dump their JSON schemas."""
    out = {}
    base_mod, err = robust_import("core.workflow.nodes.base")
    if err or base_mod is None:
        raise RuntimeError(f"Cannot import BaseNodeData: {err}")
    BaseNodeData = getattr(base_mod, "BaseNodeData", None)
    if BaseNodeData is None:
        raise RuntimeError("BaseNodeData not exported by core.workflow.nodes.base")

    for name in dir(module):
        obj = getattr(module, name)
        if not isinstance(obj, type):
            continue
        if not issubclass(obj, BaseNodeData) or obj is BaseNodeData:
            continue
        if obj.__module__ != module.__name__:
            continue  # re-exports
        try:
            out[name] = obj.model_json_schema()
        except Exception as e:
            out[name] = {"_error": f"{type(e).__name__}: {e}"}
    return out


def compose_root_schema(version: str, node_schemas: dict[str, dict]) -> dict:
    """Wrap node schemas into a top-level Dify DSL schema (best-effort).

    The DSL YAML has shape:
        app: {name, mode, icon, ...}
        dependencies: [...]
        kind: app
        version: <str>
        workflow:
          conversation_variables: []
          environment_variables: []
          features: {...}
          graph:
            nodes: [{id, type, data: <NodeData>, position, ...}]
            edges: [{source, target, sourceHandle, ...}]
    """
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": f"https://dify.local/schemas/dsl-{version}.json",
        "title": f"Dify Workflow DSL ({version})",
        "description": "Auto-generated from langgenius/dify pydantic models. "
                       f"DSL version {version}.",
        "type": "object",
        "required": ["app", "kind", "version", "workflow"],
        "properties": {
            "app": {
                "type": "object",
                "required": ["name", "mode"],
                "properties": {
                    "name": {"type": "string"},
                    "description": {"type": ["string", "null"]},
                    "icon": {"type": "string"},
                    "icon_background": {"type": "string"},
                    "icon_type": {"type": "string"},
                    "mode": {"enum": ["workflow", "chatflow", "advanced-chat", "agent-chat", "completion", "chat"]},
                    "use_icon_as_answer_icon": {"type": "boolean"},
                },
            },
            "dependencies": {
                "type": "array",
                "items": {"type": "object"},
            },
            "kind": {"const": "app"},
            "version": {"type": "string", "examples": [version]},
            "workflow": {
                "type": "object",
                "properties": {
                    "conversation_variables": {"type": "array"},
                    "environment_variables": {"type": "array"},
                    "features": {"type": "object"},
                    "graph": {
                        "type": "object",
                        "required": ["nodes", "edges"],
                        "properties": {
                            "nodes": {
                                "type": "array",
                                "items": {"$ref": "#/$defs/Node"},
                            },
                            "edges": {
                                "type": "array",
                                "items": {"$ref": "#/$defs/Edge"},
                            },
                            "viewport": {"type": "object"},
                        },
                    },
                },
            },
        },
        "$defs": {
            "Node": {
                "type": "object",
                "required": ["id", "type", "data", "position"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"enum": ["custom", "custom-iteration-start", "custom-loop-start"]},
                    "data": {
                        "type": "object",
                        "required": ["type"],
                        "properties": {"type": {"type": "string"}},
                    },
                    "position": {"$ref": "#/$defs/Position"},
                    "positionAbsolute": {"$ref": "#/$defs/Position"},
                    "width": {"type": "number"},
                    "height": {"type": "number"},
                    "sourcePosition": {"type": "string"},
                    "targetPosition": {"type": "string"},
                    "parentId": {"type": "string"},
                    "extent": {"type": "string"},
                    "selected": {"type": "boolean"},
                    "zIndex": {"type": "number"},
                },
            },
            "Edge": {
                "type": "object",
                "required": ["id", "source", "target"],
                "properties": {
                    "id": {"type": "string"},
                    "source": {"type": "string"},
                    "target": {"type": "string"},
                    "sourceHandle": {"type": "string"},
                    "targetHandle": {"type": "string"},
                    "type": {"type": "string"},
                    "data": {"type": "object"},
                    "zIndex": {"type": "number"},
                },
            },
            "Position": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                },
            },
            **{f"NodeData_{name}": schema for name, schema in node_schemas.items()},
        },
    }


def _diff_summary(old: str, new: str, max_lines: int = 10) -> str:
    """Return first `max_lines` lines of a unified diff between two strings."""
    diff = difflib.unified_diff(
        old.splitlines(keepends=False),
        new.splitlines(keepends=False),
        fromfile="existing",
        tofile="generated",
        lineterm="",
    )
    head = []
    for line in diff:
        head.append(line)
        if len(head) >= max_lines:
            break
    return "\n".join(head)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dify-src", type=Path, default=None,
                   help=f"Path to Dify source clone (default: {VENDOR_DIFY_SRC.relative_to(REPO_ROOT)}/, "
                        f"fallback to legacy {LEGACY_DIFY_SRC})")
    p.add_argument("--out", type=Path, default=Path(__file__).parent,
                   help="Output directory (default: same dir as this script)")
    p.add_argument("--yes", "-y", action="store_true",
                   help="Auto-overwrite existing schema without confirm prompt")
    p.add_argument("--verbose", "-v", action="store_true")
    args = p.parse_args()

    # Resolve --dify-src: explicit arg > vendor/dify-src/ > legacy fallback (with warning)
    if args.dify_src is None:
        if VENDOR_DIFY_SRC.exists():
            args.dify_src = VENDOR_DIFY_SRC
        elif LEGACY_DIFY_SRC.exists():
            print(f"⚠ vendor/dify-src/ not found — falling back to legacy path {LEGACY_DIFY_SRC}",
                  file=sys.stderr)
            print(f"  Run ./scripts/setup.sh to vendor Dify source into vendor/dify-src/",
                  file=sys.stderr)
            args.dify_src = LEGACY_DIFY_SRC
        else:
            print(f"❌ Dify source not found at vendor/dify-src/ or {LEGACY_DIFY_SRC}",
                  file=sys.stderr)
            print(f"  Run ./scripts/setup.sh to clone Dify source", file=sys.stderr)
            return 1

    if not args.dify_src.exists():
        print(f"❌ Dify source not found at {args.dify_src}", file=sys.stderr)
        return 1
    api_dir = args.dify_src / "api"
    if not api_dir.exists():
        print(f"❌ {api_dir} does not exist (not a Dify source root?)", file=sys.stderr)
        return 1

    if sys.version_info < (3, 11):
        print(f"❌ Need Python 3.11+ (have {sys.version_info.major}.{sys.version_info.minor})",
              file=sys.stderr)
        print("   Try: uv run --python 3.12 schemas/gen_schema.py", file=sys.stderr)
        return 1

    version = read_dsl_version(args.dify_src)
    print(f"Dify source: {args.dify_src}")
    print(f"DSL version: {version}")
    print()

    sys.path.insert(0, str(api_dir))

    # Pre-stub Dify packages that pull in heavy runtime deps
    for pkg in PRE_STUB_PACKAGES:
        _stub_module(pkg)

    # Replace configs.dify_config with a type-aware smart stub (fixes pydantic
    # default-value type errors when fields like `connect: int = dify_config.X`
    # would otherwise get a class object as their default).
    if "configs" in sys.modules:
        sys.modules["configs"].dify_config = _SmartConfigStub()  # type: ignore

    # Register meta-path finder for transitively stubbed submodules
    # (e.g., `libs.exception` when only `libs` was pre-stubbed)
    sys.meta_path.insert(0, _StubFinder())

    # Patch core.mcp.types.Implementation so agent node entities can load
    # (see comment near PRE_STUB_PACKAGES).
    _install_narrow_mcp_stubs()

    node_dirs = discover_node_dirs(args.dify_src)
    # Move `agent` to the end of the iteration: its transitive import chain
    # (core.tools.entities → core.tools.tool_manager → core.helper.code_executor →
    # …) leaves sys.modules in a state where later nodes' __init_subclass__ hooks
    # see a different BaseNodeData identity and reject their generic args. Doing
    # agent last means contamination has no successors to break.
    node_dirs = sorted(node_dirs, key=lambda p: (p.name == "agent", p.name))
    print(f"Discovered {len(node_dirs)} node directories")

    all_node_schemas: dict[str, dict] = {}
    results: list[NodeResult] = []

    for nd in node_dirs:
        module, err = import_node_entities(nd, args.dify_src)
        if err:
            results.append(NodeResult(nd.name, [], None, err))
            if args.verbose:
                print(f"  ✗ {nd.name}: {err}")
            continue
        try:
            schemas = schemas_from_module(module)
            results.append(NodeResult(nd.name, list(schemas), schemas))
            for name, schema in schemas.items():
                all_node_schemas[name] = schema
            if args.verbose and schemas:
                print(f"  ✓ {nd.name}: {', '.join(schemas)}")
        except Exception as e:
            results.append(NodeResult(nd.name, [], None, f"{type(e).__name__}: {e}"))
            if args.verbose:
                print(f"  ✗ {nd.name}: {e}")
                traceback.print_exc()

    # Summary
    ok = [r for r in results if r.schema is not None]
    fail = [r for r in results if r.error]
    print()
    print(f"Imported {len(ok)}/{len(results)} node entity modules")
    if fail:
        print(f"Failed to import {len(fail)}:")
        for r in fail:
            print(f"  - {r.node_dir}: {r.error}")

    if not all_node_schemas:
        print("❌ No node schemas generated", file=sys.stderr)
        return 1

    # Compose + write (idempotent — skip if identical, prompt if differs)
    root = compose_root_schema(version, all_node_schemas)
    args.out.mkdir(parents=True, exist_ok=True)
    out_file = args.out / f"dify-dsl-{version}.json"
    new_text = json.dumps(root, indent=2, ensure_ascii=False)

    print()
    if out_file.exists():
        old_text = out_file.read_text(encoding="utf-8")
        if old_text == new_text:
            print(f"✓ {out_file.relative_to(REPO_ROOT)} unchanged ({len(all_node_schemas)} node data schemas), skipping")
            _update_latest_symlink(args.out, out_file)
            return 0
        print(f"⚠ {out_file.relative_to(REPO_ROOT)} differs from generated output:")
        diff = _diff_summary(old_text, new_text)
        if diff:
            for line in diff.splitlines():
                print(f"  {line}")
        if not args.yes:
            try:
                resp = input("Overwrite? [y/N] ").strip().lower()
            except EOFError:
                resp = ""
            if resp not in ("y", "yes"):
                print("Aborted (no overwrite).")
                return 1

    out_file.write_text(new_text, encoding="utf-8")
    print(f"✓ Wrote {out_file.relative_to(REPO_ROOT)} ({len(all_node_schemas)} node data schemas)")
    _update_latest_symlink(args.out, out_file)
    return 0


def _update_latest_symlink(out_dir: Path, target: Path) -> None:
    """Point schemas/_latest.json → target (a generated dify-dsl-<version>.json)."""
    link = out_dir / "_latest.json"
    rel_target = target.name  # symlink relative within same dir
    try:
        if link.is_symlink() or link.exists():
            if link.is_symlink() and os.readlink(link) == rel_target:
                return
            link.unlink()
        link.symlink_to(rel_target)
        print(f"✓ _latest.json → {rel_target}")
    except OSError as e:
        print(f"⚠ could not update _latest.json symlink: {e}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())

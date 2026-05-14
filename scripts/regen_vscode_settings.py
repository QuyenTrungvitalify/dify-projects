#!/usr/bin/env python3
"""Regenerate .vscode/settings.json yaml.schemas mapping.

Scans schemas/dify-dsl-*.json and projects/*/.dify-workspace.yaml to build a
per-project file-pattern → schema mapping. templates/patterns/ falls back to
the version pinned by .dify-dsl-version at repo root.

Run after creating new projects or generating new schemas. Idempotent.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("❌ pyyaml not installed. Activate .venv or run: pip install pyyaml", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMAS_DIR = REPO_ROOT / "schemas"
PROJECTS_DIR = REPO_ROOT / "projects"
VSCODE_SETTINGS = REPO_ROOT / ".vscode" / "settings.json"
DEFAULT_VERSION_FILE = REPO_ROOT / ".dify-dsl-version"

SCHEMA_VERSION_RE = re.compile(r"dify-dsl-([\d.]+)\.json$")


def discover_schemas() -> dict[str, str]:
    """Return {version: relative_path} for every schemas/dify-dsl-*.json."""
    out: dict[str, str] = {}
    for p in sorted(SCHEMAS_DIR.glob("dify-dsl-*.json")):
        m = SCHEMA_VERSION_RE.search(p.name)
        if m:
            out[m.group(1)] = f"./schemas/{p.name}"
    return out


def discover_projects() -> dict[str, str]:
    """Return {project_slug: dsl_version} for every projects/*/.dify-workspace.yaml."""
    out: dict[str, str] = {}
    if not PROJECTS_DIR.exists():
        return out
    for cfg in sorted(PROJECTS_DIR.glob("*/.dify-workspace.yaml")):
        slug = cfg.parent.name
        try:
            data = yaml.safe_load(cfg.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            print(f"⚠ {cfg.relative_to(REPO_ROOT)}: YAML parse error ({e}) — skipping", file=sys.stderr)
            continue
        v = (data.get("project") or {}).get("dsl_version")
        if v:
            out[slug] = str(v)
    return out


def default_version() -> str | None:
    if DEFAULT_VERSION_FILE.exists():
        v = DEFAULT_VERSION_FILE.read_text(encoding="utf-8").strip()
        if v:
            return v
    return None


def build_yaml_schemas(schemas: dict[str, str], projects: dict[str, str],
                       default: str | None) -> dict[str, list[str]]:
    """Build the yaml.schemas mapping: schema_path → [glob, glob, ...]."""
    mapping: dict[str, list[str]] = {path: [] for path in schemas.values()}

    # Default schema bucket — used for templates/patterns and _base
    default_schema_path: str | None = None
    if default and default in schemas:
        default_schema_path = schemas[default]
    elif schemas:
        # fallback: lexicographic last (highest version) as default
        default_schema_path = sorted(schemas.values())[-1]

    if default_schema_path is not None:
        mapping[default_schema_path].extend([
            "templates/patterns/*.yml",
            "templates/_base/**/workflows/*.yml",
        ])

    for slug, version in projects.items():
        path = schemas.get(version)
        if path is None:
            print(f"⚠ project '{slug}' declares dsl_version={version} but no schema exists at "
                  f"schemas/dify-dsl-{version}.json", file=sys.stderr)
            if default_schema_path is None:
                continue
            path = default_schema_path
        mapping[path].extend([
            f"projects/{slug}/workflows/*.yml",
            f"projects/{slug}/workflows/*.yaml",
        ])

    # Drop any schema entries with no globs (no project / template uses them)
    return {k: v for k, v in mapping.items() if v}


def main() -> int:
    schemas = discover_schemas()
    if not schemas:
        print("⚠ no schemas/dify-dsl-*.json found — generate one first: "
              "python3 schemas/gen_schema.py", file=sys.stderr)
        return 1

    projects = discover_projects()
    default = default_version()

    yaml_schemas = build_yaml_schemas(schemas, projects, default)

    settings = {
        "yaml.schemas": yaml_schemas,
        "yaml.validate": True,
        "yaml.format.enable": True,
        "yaml.completion": True,
        "yaml.hover": True,
        "files.associations": {
            "*.dify.yml": "yaml",
            "*.dify.yaml": "yaml",
        },
    }

    VSCODE_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    new_text = json.dumps(settings, indent=2, ensure_ascii=False) + "\n"

    if VSCODE_SETTINGS.exists() and VSCODE_SETTINGS.read_text(encoding="utf-8") == new_text:
        print(f"✓ {VSCODE_SETTINGS.relative_to(REPO_ROOT)} unchanged "
              f"({len(yaml_schemas)} schema bucket(s), {len(projects)} project(s))")
        return 0

    VSCODE_SETTINGS.write_text(new_text, encoding="utf-8")
    print(f"✓ Wrote {VSCODE_SETTINGS.relative_to(REPO_ROOT)} "
          f"({len(yaml_schemas)} schema bucket(s), {len(projects)} project(s))")
    return 0


if __name__ == "__main__":
    sys.exit(main())

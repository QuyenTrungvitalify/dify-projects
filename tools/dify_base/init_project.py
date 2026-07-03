#!/usr/bin/env python3
"""Scaffolder for the two on-disk tiers of a Dify project (spec 030).

The hierarchy is REAL: a Project is `projects/<project>/` and a Workflow is
`projects/<project>/<workflow>/`. This tool scaffolds either tier:

  * `--kind project`  → copies `templates/_base/project/`  to `projects/<slug>/`
                        (the shared manifest + envs, created once per project).
  * `--kind workflow` → copies `templates/_base/workflow/` to `projects/<project>/<slug>/`
                        (workflows/ prompts/ inputs/ tests/, created per workflow).

Usage:
    python3 tools/dify_base/init_project.py                       # interactive (project tier)
    python3 tools/dify_base/init_project.py --non-interactive --kind project  --name "..." --slug "..."
    python3 tools/dify_base/init_project.py --non-interactive --kind workflow --project "<project>" --slug "..."

No external dependencies — uses stdlib only (input/argparse/pathlib/shutil).
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass, asdict
from datetime import date
from pathlib import Path

BASE = Path(__file__).parent.parent.parent  # dify-projects/
TEMPLATE_ROOT = BASE / "templates" / "_base"
TEMPLATE_DIR_PROJECT = TEMPLATE_ROOT / "project"
TEMPLATE_DIR_WORKFLOW = TEMPLATE_ROOT / "workflow"
PROJECTS_DIR = BASE / "projects"

APP_TYPES = ["workflow", "chatflow", "agent", "completion"]
LANGS = ["en", "ja", "vi", "zh", "ja-en", "vi-en", "ja-vi"]
DEFAULT_DSL_VERSION = "0.6.0"
DEFAULT_DIFY_TAG = "main"

# Files that should NOT have {{var}} substitution applied (binary, large, etc.)
SKIP_SUBSTITUTE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".pdf", ".zip", ".xlsx"}


@dataclass
class Answers:
    project_name: str
    project_slug: str
    description: str
    app_type: str
    dsl_version: str
    dify_tag: str
    primary_lang: str
    date: str


def slugify(name: str) -> str:
    """Convert any string to a snake_case slug usable as a directory name. An intentional LEADING
    underscore is preserved (spec 030's reserved `_drafts` project must round-trip through slugify),
    while underscores introduced from leading punctuation/whitespace are still trimmed."""
    raw = name.strip()
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", raw)
    s = re.sub(r"_+", "_", s).strip("_").lower()
    if raw.startswith("_") and s:
        s = "_" + s
    return s or "project"


def ask(prompt: str, default: str | None = None, choices: list[str] | None = None) -> str:
    """Prompt user with optional default and choices, return their answer."""
    suffix_parts = []
    if choices:
        suffix_parts.append("/".join(choices))
    if default is not None:
        suffix_parts.append(f"default: {default}")
    suffix = f"  [{' | '.join(suffix_parts)}]" if suffix_parts else ""
    while True:
        try:
            raw = input(f"? {prompt}{suffix}\n> ").strip()
        except EOFError:
            raw = ""
        if not raw and default is not None:
            return default
        if choices and raw not in choices:
            print(f"  ⚠ Please choose one of: {', '.join(choices)}")
            continue
        if raw:
            return raw
        print("  ⚠ Required")


def detect_dsl_version() -> str:
    """Detect DSL version from .dify-dsl-version file, fallback to default."""
    pin = BASE / ".dify-dsl-version"
    if pin.exists():
        v = pin.read_text(encoding="utf-8").strip()
        if v:
            return v
    schemas = sorted((BASE / "schemas").glob("dify-dsl-*.json"))
    if not schemas:
        return DEFAULT_DSL_VERSION
    m = re.search(r"dify-dsl-([\d.]+)\.json", schemas[-1].name)
    return m.group(1) if m else DEFAULT_DSL_VERSION


def detect_dify_tag() -> str:
    """Read pinned Dify source tag from .dify-tag at repo root, fallback to default."""
    pin = BASE / ".dify-tag"
    if pin.exists():
        v = pin.read_text(encoding="utf-8").strip()
        if v:
            return v
    return DEFAULT_DIFY_TAG


def collect_interactive() -> Answers:
    print()
    print("=== Create a new Dify project ===")
    print(f"  (will scaffold into {PROJECTS_DIR.relative_to(BASE.parent)}/<slug>/)")
    print()

    name = ask("Project name (human-readable)", default=None)
    slug_default = slugify(name)
    slug = slugify(ask("Project slug (folder name)", default=slug_default))
    description = ask("Short description (one line)", default=name)
    app_type = ask("App type", default="workflow", choices=APP_TYPES)
    dsl_default = detect_dsl_version()
    dsl_version = ask("Target Dify DSL version", default=dsl_default)
    dify_tag = detect_dify_tag()
    print(f"  ℹ Dify source tag pinned by repo: {dify_tag} (from .dify-tag)")
    primary_lang = ask("Primary prompt language", default="en", choices=LANGS)

    return Answers(
        project_name=name,
        project_slug=slug,
        description=description,
        app_type=app_type,
        dsl_version=dsl_version,
        dify_tag=dify_tag,
        primary_lang=primary_lang,
        date=date.today().isoformat(),
    )


def substitute(text: str, vars: dict[str, str]) -> str:
    """Replace {{var}} occurrences in text."""
    for k, v in vars.items():
        text = text.replace(f"{{{{{k}}}}}", v)
    return text


def copy_template(answers: Answers, template_dir: Path, target_root: Path, force: bool = False) -> None:
    """Walk `template_dir` and copy to target_root with {{var}} substitution."""
    if target_root.exists() and not force:
        raise FileExistsError(f"{target_root} already exists. Use --force to overwrite.")
    if target_root.exists() and force:
        shutil.rmtree(target_root)

    vars = asdict(answers)

    for src in sorted(template_dir.rglob("*")):
        rel = src.relative_to(template_dir)
        # Substitute placeholders in path components
        rel_substituted = Path(*[substitute(p, vars) for p in rel.parts])
        dst = target_root / rel_substituted

        if src.is_dir():
            dst.mkdir(parents=True, exist_ok=True)
            continue

        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.suffix.lower() in SKIP_SUBSTITUTE_SUFFIXES:
            shutil.copy2(src, dst)
            continue

        text = src.read_text(encoding="utf-8")
        dst.write_text(substitute(text, vars), encoding="utf-8")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--non-interactive", action="store_true")
    p.add_argument("--kind", choices=["project", "workflow"], default="project",
                   help="Scaffold the project tier (projects/<slug>/) or a workflow tier "
                        "(projects/<project>/<slug>/). Default: project.")
    p.add_argument("--project", help="Parent project folder (required for --kind workflow)")
    p.add_argument("--name", help="Human-readable name")
    p.add_argument("--slug", help="Slug (folder name — the project or the workflow subfolder)")
    p.add_argument("--description", default="")
    p.add_argument("--app-type", choices=APP_TYPES, default="workflow")
    p.add_argument("--dsl-version", default=None,
                   help=f"DSL version (default: detect from schemas/, or {DEFAULT_DSL_VERSION})")
    p.add_argument("--primary-lang", choices=LANGS, default="en")
    p.add_argument("--force", action="store_true",
                   help="Overwrite the existing target dir")
    args = p.parse_args()

    template_dir = TEMPLATE_DIR_WORKFLOW if args.kind == "workflow" else TEMPLATE_DIR_PROJECT
    if not template_dir.exists():
        print(f"❌ Template dir not found: {template_dir}", file=sys.stderr)
        return 1

    if args.non_interactive:
        if not args.name:
            print("❌ --non-interactive requires --name", file=sys.stderr)
            return 1
        if args.kind == "workflow" and not args.project:
            print("❌ --kind workflow requires --project", file=sys.stderr)
            return 1
        answers = Answers(
            project_name=args.name,
            project_slug=slugify(args.slug or args.name),
            description=args.description or args.name,
            app_type=args.app_type,
            dsl_version=args.dsl_version or detect_dsl_version(),
            dify_tag=detect_dify_tag(),
            primary_lang=args.primary_lang,
            date=date.today().isoformat(),
        )
    else:
        answers = collect_interactive()

    # Project tier → projects/<slug>/ ; workflow tier → projects/<project>/<slug>/.
    if args.kind == "workflow":
        target = PROJECTS_DIR / slugify(args.project) / answers.project_slug
    else:
        target = PROJECTS_DIR / answers.project_slug

    print()
    print("=== Will create ===")
    print(f"  kind           {args.kind}")
    for k, v in asdict(answers).items():
        print(f"  {k:14} {v}")
    print(f"  target         {target}")
    print()

    if not args.non_interactive:
        confirm = input("Proceed? [Y/n] ").strip().lower()
        if confirm and confirm not in ("y", "yes"):
            print("Cancelled.")
            return 0

    try:
        target.parent.mkdir(parents=True, exist_ok=True)  # ensure projects/<project>/ exists (workflow tier)
        copy_template(answers, template_dir, target, force=args.force)
    except FileExistsError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 1

    print(f"✓ Created {target.relative_to(BASE)}/")

    # Regenerate .vscode/settings.json so this project's yaml.schemas mapping
    # picks up its dsl_version. Failures are non-fatal — user can run manually.
    regen = BASE / "scripts" / "regen_vscode_settings.py"
    if regen.exists():
        import subprocess
        try:
            subprocess.run([sys.executable, str(regen)], check=True)
        except subprocess.CalledProcessError as e:
            print(f"⚠ regen_vscode_settings.py failed: {e}", file=sys.stderr)
            print(f"  Run manually: python3 scripts/regen_vscode_settings.py", file=sys.stderr)

    print()
    print("Next steps:")
    if args.kind == "project":
        print(f"  cd {target.relative_to(BASE.parent)}")
        print(f"  cp envs/dev.env.example envs/dev.env  # fill secrets")
        print(f"  # Add a workflow:  init_project.py --kind workflow --project {answers.project_slug} --slug <wf>")
    else:
        print(f"  # Add your workflow YAML to {target.relative_to(BASE)}/workflows/")
    print()
    print(f"Rebuild template index to include this:")
    print(f"  python3 tools/dify_base/build_index.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())

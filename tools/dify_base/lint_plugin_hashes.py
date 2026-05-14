"""Lint plugin marketplace identifiers for valid format.

Format: <provider>/<plugin>:<version>@<sha256>
- provider, plugin: [a-z0-9_]+
- version: semver (X.Y.Z)
- sha256: 64 hex chars

Usage: lint_plugin_hashes.py <file.yml> [<file.yml> ...]
"""
import re
import sys
from pathlib import Path

import yaml

PATTERN = re.compile(
    r"^[a-z0-9_]+/[a-z0-9_]+:\d+\.\d+\.\d+@[a-f0-9]{64}$"
)


def lint(path):
    errors = []
    try:
        d = yaml.safe_load(Path(path).read_text())
    except Exception as e:
        return [(0, f"parse error: {e}")]

    if not isinstance(d, dict):
        return []

    for dep in (d.get("dependencies") or []):
        if isinstance(dep, dict):
            val = (dep.get("value") or {}).get("marketplace_plugin_unique_identifier", "")
            if val and not PATTERN.match(val):
                errors.append((0, f"invalid plugin hash format: {val}"))
    return errors


def main():
    if len(sys.argv) < 2:
        print("Usage: lint_plugin_hashes.py <file.yml> ...", file=sys.stderr)
        return 2
    fail = 0
    for f in sys.argv[1:]:
        errs = lint(f)
        for _, msg in errs:
            print(f"[X] {f}: {msg}")
            fail += 1
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env bash
# Pre-commit hook: verify each staged Dify workflow YAML has version matching
# the expected DSL version for the project that owns it.
#
# Resolution order for expected DSL version:
#   1. Walk up parents from the YAML file; first .dify-workspace.yaml wins
#      → read project.dsl_version
#   2. Fallback: .dify-dsl-version at repo root (1-line file, e.g., "0.6.0")
#
# Usage (called by pre-commit):
#   scripts/check_dsl_version.sh path/to/workflow.yml ...

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

PY="python3"
[ -x .venv/bin/python ] && PY=".venv/bin/python"

# Default expected version (used when a workflow isn't inside a project)
DEFAULT_VERSION=""
if [ -f "$ROOT/.dify-dsl-version" ]; then
    DEFAULT_VERSION=$(tr -d ' \t\n\r' < "$ROOT/.dify-dsl-version")
fi

resolve_expected() {
    # Walk up parents from $1 looking for .dify-workspace.yaml; print dsl_version.
    local file="$1"
    local dir
    dir=$(cd "$(dirname "$file")" 2>/dev/null && pwd || echo "")
    while [ -n "$dir" ] && [ "$dir" != "/" ]; do
        if [ -f "$dir/.dify-workspace.yaml" ]; then
            "$PY" - "$dir/.dify-workspace.yaml" <<'PYEOF'
import sys, yaml
try:
    with open(sys.argv[1], "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    v = (data.get("project") or {}).get("dsl_version") or ""
    print(v)
except Exception:
    print("")
PYEOF
            return
        fi
        dir=$(dirname "$dir")
    done
    echo ""
}

fail=0
for f in "$@"; do
    expected=$(resolve_expected "$f")
    source_label=".dify-workspace.yaml"
    if [ -z "$expected" ]; then
        expected="$DEFAULT_VERSION"
        source_label=".dify-dsl-version (repo default)"
    fi
    if [ -z "$expected" ]; then
        echo "❌ $f: no expected DSL version found (no .dify-workspace.yaml ancestor, no .dify-dsl-version)"
        fail=1
        continue
    fi

    actual=$(grep -E "^version:" "$f" 2>/dev/null | head -1 | awk '{print $2}' | tr -d "'\"")
    if [ -z "$actual" ]; then
        echo "❌ $f: no top-level 'version:' field"
        fail=1
    elif [ "$actual" != "$expected" ]; then
        echo "❌ $f: DSL version '$actual', expected '$expected' (from $source_label)"
        fail=1
    fi
done

exit $fail

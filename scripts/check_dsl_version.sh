#!/usr/bin/env bash
# Pre-commit hook: verify each staged Dify workflow YAML has version matching
# the committed schema (schemas/dify-dsl-<version>.json).
#
# Usage (called by pre-commit):
#   scripts/check_dsl_version.sh path/to/workflow.yml ...

set -euo pipefail

# Detect schema version from the filename in schemas/
SCHEMA=$(ls schemas/dify-dsl-*.json 2>/dev/null | head -1)
if [ -z "$SCHEMA" ]; then
    echo "❌ No schema found at schemas/dify-dsl-*.json"
    echo "   Run: .venv/bin/python schemas/gen_schema.py"
    exit 1
fi
EXPECTED=$(basename "$SCHEMA" .json | sed 's/dify-dsl-//')

fail=0
for f in "$@"; do
    actual=$(grep -E "^version:" "$f" 2>/dev/null | head -1 | awk '{print $2}' | tr -d "'\"")
    if [ -z "$actual" ]; then
        echo "❌ $f: no top-level 'version:' field"
        fail=1
    elif [ "$actual" != "$EXPECTED" ]; then
        echo "❌ $f: DSL version $actual, expected $EXPECTED (from $SCHEMA)"
        fail=1
    fi
done

exit $fail

#!/usr/bin/env bash
# Resolve the Python interpreter for local pre-commit hooks (spec 024 Q1a).
# Prefer the repo .venv (has the pinned deps after setup.sh); fall back to
# system python3 — CI runs `setup.sh --skip-venv` + `uv pip install --system`,
# so there is no .venv there but system python already has the deps.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -x "$here/.venv/bin/python" ]; then
  exec "$here/.venv/bin/python" "$@"
else
  exec python3 "$@"
fi

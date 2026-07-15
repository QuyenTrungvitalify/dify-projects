#!/usr/bin/env bash
# Bootstrap the Node side of the spec-009 builder app (apps/builder).
#
# SEPARATE from ./scripts/setup.sh (the Python/Dify substrate). This installs the builder backend +
# web deps and builds both. It does NOT touch the Python venv — run ./scripts/setup.sh first so the
# builder can shell `.venv/bin/python tools/dify_base/...` at runtime.
#
# Usage:
#   ./scripts/setup-node.sh            # install + build backend and web
#   ./scripts/setup-node.sh --no-build # install deps only
#
# Idempotent — re-runs are safe (npm install is incremental).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/builder"
WEB_DIR="$APP_DIR/web"
DO_BUILD=1
[[ "${1:-}" == "--no-build" ]] && DO_BUILD=0

command -v node >/dev/null 2>&1 || { echo "❌ node not found — install Node.js 22.6+"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "❌ npm not found — install Node.js"; exit 1; }
echo "ℹ node $(node --version), npm $(npm --version)"

echo "── backend (apps/builder) ──"
( cd "$APP_DIR" && npm install )
echo "── web (apps/builder/web) ──"
( cd "$WEB_DIR" && npm install )

if [[ "$DO_BUILD" == "1" ]]; then
  echo "── build backend ──"
  ( cd "$APP_DIR" && npm run build )
  echo "── build web (SPA) ──"
  ( cd "$WEB_DIR" && npm run build )
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ℹ no apps/builder/.env yet — copy apps/builder/.env.example to apps/builder/.env and edit."
fi

echo "✓ builder Node bootstrap complete."
echo "  Next: ensure ./scripts/setup.sh has run (.venv present), then: cd apps/builder && npm start"

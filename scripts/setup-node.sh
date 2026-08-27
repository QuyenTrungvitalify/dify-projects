#!/usr/bin/env bash
# Bootstrap the Node side of the builder app (apps/builder).
#
# SEPARATE from ./scripts/setup.sh (the Python/Dify substrate). This installs the builder backend +
# web deps and builds both. It does NOT touch the Python venv — run ./scripts/setup.sh first so the
# builder can shell `.venv/bin/python tools/dify_base/...` at runtime.
#
# Usage:
#   ./scripts/setup-node.sh            # install + build ONLY what changed
#   ./scripts/setup-node.sh --force    # ignore the stamps; reinstall and rebuild everything
#   ./scripts/setup-node.sh --no-build # install deps only
#
# It requires the repo's own pinned Node (.toolchain/, see scripts/bootstrap.sh). Set
# BUILDER_ALLOW_ANY_NODE=1 to run it against whatever `node` is on PATH — for CI or a maintainer who
# knows why they are doing it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/builder"
WEB_DIR="$APP_DIR/web"
TC="$REPO_ROOT/.toolchain"
. "$REPO_ROOT/scripts/lib/toolchain.sh"

DO_BUILD=1
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --force)    FORCE=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

# ── Which node? ───────────────────────────────────────────────────────────────────────────────────
# The old check was `command -v node || exit 1`: existence, not version. That let a machine whose
# nvm happened to be on node 20 walk straight past this line and fail later, during the build, in an
# error that never mentioned the version — and it told the user to go install Node themselves, which
# is the decision this repo exists to stop asking them to make (spec 110 §1.4).
if [ "${BUILDER_ALLOW_ANY_NODE:-0}" != "1" ]; then
  if [ ! -x "$TC/node/bin/node" ]; then
    printf '\n  \033[31m✗\033[0m The repo toolchain is missing (.toolchain/node).\n' >&2
    printf '    Run:  ./scripts/bootstrap.sh\n\n' >&2
    exit 1
  fi
  have="$("$TC/node/bin/node" --version)"
  if [ "$have" != "v$NODE_VERSION" ]; then
    printf '\n  \033[31m✗\033[0m Toolchain node is %s but this repo pins v%s.\n' "$have" "$NODE_VERSION" >&2
    printf '    Run:  ./scripts/bootstrap.sh    (re-fetches the pinned build)\n\n' >&2
    exit 1
  fi
  # Prepend our own node/npm and clear the environment variables that silently change what a build
  # produces — NODE_ENV=production alone makes `npm ci` drop devDependencies, which deletes tsc and
  # vite and then fails at build time complaining about neither (spec 110 §1.8 R1, S6).
  use_toolchain "$REPO_ROOT"
fi

command -v node >/dev/null 2>&1 || { echo "❌ node not found on PATH"; exit 1; }
command -v npm  >/dev/null 2>&1 || { echo "❌ npm not found on PATH"; exit 1; }
echo "ℹ node $(node --version), npm $(npm --version)"

hash_of() { # sha256 of the concatenated inputs, or empty if a tool is missing
  if command -v shasum >/dev/null 2>&1; then cat "$@" 2>/dev/null | shasum -a 256 | awk '{print $1}'
  elif command -v sha256sum >/dev/null 2>&1; then cat "$@" 2>/dev/null | sha256sum | awk '{print $1}'
  fi
}

# ── Install — only when the lockfiles (or the node version) actually changed ───────────────────────
# This used to run `npm install` on EVERY launch: 142 MB of node_modules re-resolved to produce
# 1.3 MB of output, including two packages with install scripts (esbuild fetches a per-platform
# binary; fsevents is native). Stamping it does two things at once — it makes an ordinary launch
# fast, and it lets the install itself be `npm ci`, which is exact where `npm install` may drift
# from the lockfile (spec 110 S5).
mkdir -p "$TC"
STAMP="$TC/.npm-stamp"
WANT="$(hash_of "$APP_DIR/package-lock.json" "$WEB_DIR/package-lock.json")-$(node --version)"
HAVE="$(cat "$STAMP" 2>/dev/null || echo '')"

if [ "$FORCE" = "1" ] || [ "$WANT" != "$HAVE" ] || [ ! -d "$APP_DIR/node_modules" ] || [ ! -d "$WEB_DIR/node_modules" ]; then
  echo "── installing dependencies (lockfile or node version changed) ──"
  ( cd "$APP_DIR" && npm ci --no-audit --no-fund )
  ( cd "$WEB_DIR" && npm ci --no-audit --no-fund )
  printf '%s' "$WANT" > "$STAMP"
else
  echo "── dependencies already match the lockfiles — skipping install ──"
fi

# ── Build — only when a source file is newer than what it produced ────────────────────────────────
# `find -newer <artifact>` answers exactly the question "is the build stale?" without a timestamp
# database. Missing artifact => stale, which is the correct answer for a fresh clone.
is_stale() { # is_stale <artifact> <src dir...>
  local artifact="$1"; shift
  [ -e "$artifact" ] || return 0
  [ -n "$(find "$@" -type f -newer "$artifact" -print -quit 2>/dev/null)" ]
}

if [ "$DO_BUILD" = "1" ]; then
  if [ "$FORCE" = "1" ] || is_stale "$APP_DIR/dist/server/index.js" "$APP_DIR/server"; then
    echo "── build backend ──"
    ( cd "$APP_DIR" && npm run build )
  else
    echo "── backend already built — skipping ──"
  fi

  if [ "$FORCE" = "1" ] || is_stale "$WEB_DIR/dist/index.html" "$WEB_DIR/src"; then
    echo "── build web (SPA) ──"
    ( cd "$WEB_DIR" && npm run build )
  else
    echo "── web already built — skipping ──"
  fi
fi

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ℹ no apps/builder/.env yet — copy apps/builder/.env.example to apps/builder/.env and edit."
fi

echo "✓ builder Node bootstrap complete."

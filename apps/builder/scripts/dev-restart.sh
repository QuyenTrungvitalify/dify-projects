#!/usr/bin/env bash
# dev-restart.sh — spec 059 dev-only. Detached restarter spawned by POST /api/dev/rebuild AFTER a clean
# rebuild: wait for the HTTP reply to flush, kill the old server, wait for the port to free, then exec a
# fresh one. Runs OUTSIDE the server it replaces (the one thing a process can't do to itself).
# args: <oldpid> <port> <entry-js>
set -u
oldpid=${1:?oldpid required} port=${2:?port required} entry=${3:?entry required}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
builder=$(cd "$here/.." && pwd)
mkdir -p "$builder/.runs"
exec >>"$builder/.runs/dev-restart.log" 2>&1   # own log; stdio was 'ignore' at spawn
echo "=== $(date) restart: kill pid=$oldpid, wait port=$port, then exec $entry ==="

sleep 1                                          # let the HTTP 200 flush to the browser
kill "$oldpid" 2>/dev/null || true               # SIGTERM the old server

port_busy() { lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; }
for _ in $(seq 1 80); do port_busy || break; sleep 0.25; done   # up to ~20s for the port to free
if port_busy; then                               # still bound → escalate
  echo "port still busy after SIGTERM — SIGKILL $oldpid"
  kill -9 "$oldpid" 2>/dev/null || true
  for _ in $(seq 1 20); do port_busy || break; sleep 0.25; done
fi

cd "$builder" || exit 1                           # matches `npm start` cwd (apps/builder)
echo "=== $(date) exec: node $entry ==="
exec node "$entry"                                # inherits this script's env (→ re-reads .env at boot)

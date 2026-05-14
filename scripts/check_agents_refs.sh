#!/usr/bin/env bash
# Pre-commit drift check: every file path mentioned in AGENTS.md must exist.
#
# Parses two reference forms:
#   1. Markdown links:        [text](path)            → take path
#   2. Repo-rooted paths in `backticks` or plain text — only those that look
#      like relative paths (contain "/" and a known top-level dir).
#
# Exits non-zero if any referenced path is missing, listing each gap.
# Skips:
#   - http(s):// URLs
#   - mailto:, # in-page anchors, #L<n> line anchors (stripped before check)
#   - paths inside fenced code blocks IF they look like shell commands
#     (heuristic: starts with `.venv/bin/python`, `python3`, `cp`, `grep`,
#     `ls`, `cat`, `DIFY_*`, or `<...>` placeholders) — those are commands
#     not file references.
#
# Usage: scripts/check_agents_refs.sh
# Called by .pre-commit-config.yaml on AGENTS.md or this script changing.

set -euo pipefail

cd "$(dirname "$0")/.."
FILE="AGENTS.md"

if [ ! -f "$FILE" ]; then
  echo "FATAL: $FILE not found at repo root"
  exit 1
fi

# Extract candidate paths.
#   - [text](path)          — markdown links
#   - `path/with/slash`     — backticked paths containing a slash
# Strip URL fragments (#anchor, #Lnnn-Lmmm).
candidates=$(
  {
    grep -oE '\]\([^)]+\)' "$FILE" | sed -E 's/^\]\(//; s/\)$//'
    grep -oE '`[^`]+/[^`]+`' "$FILE" | sed -E 's/^`//; s/`$//'
  } | sed -E 's/#L[0-9]+(-L?[0-9]+)?$//; s/#.*$//' \
    | grep -v -E '^(https?|mailto):' \
    | grep -v -E '^[a-z]+://' \
    | sort -u
)

missing=0
while IFS= read -r p; do
  [ -z "$p" ] && continue
  # Skip obvious non-file tokens: regex/glob/format strings/commands.
  case "$p" in
    *' '*) continue ;;            # contains space → command, not a path
    *'<'*'>'*) continue ;;        # placeholder like <node_id>
    *'@'*) continue ;;            # plugin hash format
    *'{{'*|*'}}'*) continue ;;    # variable ref syntax
    *'*'*) continue ;;            # glob
    .venv/*) continue ;;          # gitignored local venv (e.g. .venv/bin/python)
  esac
  if [ ! -e "$p" ]; then
    echo "MISSING: $p (referenced in $FILE)"
    missing=$((missing + 1))
  fi
done <<< "$candidates"

if [ "$missing" -gt 0 ]; then
  echo
  echo "$FILE references $missing missing path(s). Fix the references or update AGENTS.md."
  exit 1
fi

echo "$FILE: all referenced paths exist."

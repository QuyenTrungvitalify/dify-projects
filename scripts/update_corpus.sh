#!/usr/bin/env bash
# Update the gitignored corpus clones declared in corpus/sources.yml (spec 022 D2) to their
# upstream ref, then rebuild the index + lint so they never go stale.
#
# Each corpus is a sparse (per-source `sparse:`) read-only clone — see scripts/setup.sh.
# `reset --hard` here is intentional and safe: corpora are never hand-edited (AGENTS.md
# "Never edit corpus"), so resetting to upstream is the desired state. The sparse-checkout
# config persists across fetches, so only the declared subdirs are materialised.
#
# Usage:
#   scripts/update_corpus.sh            # update ALL sources → rebuild INDEX → lint
#   scripts/update_corpus.sh --all      # same as bare
#   scripts/update_corpus.sh <name>     # update one source by registry name
#   scripts/update_corpus.sh --check    # report per-source fresh/stale (no download)
#
# Idempotent: sources already up to date are skipped; if nothing changed, INDEX is left alone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCES_YML="$ROOT/corpus/sources.yml"
PY="$ROOT/.venv/bin/python"
. "$ROOT/scripts/lib/sources.sh"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
info() { printf '  \033[36m→\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

[ -f "$SOURCES_YML" ] || { warn "no registry at $SOURCES_YML — run ./scripts/setup.sh first"; exit 1; }

CHECK_ONLY=false
ONLY_NAME=""
case "${1:-}" in
    --check)    CHECK_ONLY=true ;;
    --all|"")   : ;;
    -*)         warn "unknown flag: $1 (use --check, --all, or a source name)"; exit 1 ;;
    *)          ONLY_NAME="$1" ;;
esac

bold "Corpus registry: corpus/sources.yml"

updated_any=false
matched=false
lint_targets=()

while IFS='|' read -r name repo ref sparse glob license; do
    [ -z "$name" ] && continue
    [ -n "$ONLY_NAME" ] && [ "$name" != "$ONLY_NAME" ] && continue
    matched=true
    dir="$ROOT/corpus/$name"
    branch="${ref:-main}"
    [ -d "$dir" ] && lint_targets+=("$dir")

    if [ ! -d "$dir/.git" ]; then
        warn "$name: not cloned at corpus/$name — run ./scripts/setup.sh"
        continue
    fi

    local_head="$(git -C "$dir" rev-parse HEAD)"
    remote_head="$(git -C "$dir" ls-remote origin -h "refs/heads/$branch" 2>/dev/null | awk '{print $1}')"
    if [ -z "$remote_head" ]; then
        warn "$name: could not reach remote (offline?, or ref '$branch' is a tag/SHA) — skipping"
        continue
    fi

    if [ "$local_head" = "$remote_head" ]; then
        ok "$name: fresh (${local_head:0:10})"
        continue
    fi

    bold "$name: update available ${local_head:0:10} → ${remote_head:0:10}"
    [ "$CHECK_ONLY" = true ] && continue

    before="$(cd "$dir" && find . -path ./.git -prune -o -name '*.yml' -print | sort)"
    info "  fetch + reset to upstream (sparse preserved)…"
    git -C "$dir" fetch --depth=1 origin "$branch" >/dev/null 2>&1
    git -C "$dir" reset --hard FETCH_HEAD >/dev/null 2>&1
    ok "  $name now at $(git -C "$dir" rev-parse --short HEAD)"
    after="$(cd "$dir" && find . -path ./.git -prune -o -name '*.yml' -print | sort)"
    added="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") || true)"
    removed="$(comm -23 <(printf '%s\n' "$before") <(printf '%s\n' "$after") || true)"
    [ -n "$added" ]   && { printf '%s\n' "$added"   | sed 's/^/    + /'; }
    [ -n "$removed" ] && { printf '%s\n' "$removed" | sed 's/^/    - /'; }
    [ -z "$added$removed" ] && info "  DSL file set unchanged (content-only edits)"
    updated_any=true
done < <(sources_list "$SOURCES_YML")

if [ -n "$ONLY_NAME" ] && [ "$matched" = false ]; then
    warn "no source named '$ONLY_NAME' in the registry"; exit 1
fi

if [ "$CHECK_ONLY" = true ]; then
    info "(--check) no downloads performed. Re-run without --check to update."
    exit 0
fi

if [ "$updated_any" = false ]; then
    ok "all sources already up to date — nothing to rebuild"
    exit 0
fi

bold "Rebuilding INDEX…"
"$PY" "$ROOT/tools/dify_base/build_index.py"

# Lint is WARN-ONLY over intake (spec 022 AC5): corpora are reference-only, multilingual, and may
# use older DSL versions, so they cannot be required green. The curated tier (templates/library/) is
# tracked and gated by pre-commit instead.
if [ "${#lint_targets[@]}" -gt 0 ]; then
    bold "Linting corpus refs (warn-only — intake is reference-only)…"
    if find "${lint_targets[@]}" -path '*/.git/*' -prune -o -name '*.yml' -print0 \
            | xargs -0 "$PY" "$ROOT/tools/dify_base/lint_refs.py"; then
        ok "lint clean"
    else
        warn "lint reported issues — review above (intake is not a gate)"
    fi
fi

bold "Done."

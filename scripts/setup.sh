#!/usr/bin/env bash
# Bootstrap a fresh clone of dify-projects.
#
# Clones the Dify source into vendor/dify-src/ (used by gen_schema.py),
# re-clones gitignored skills + corpus, sets up the Python venv used by
# gen_schema.py / sync.py / pytest, and rebuilds INDEX.md.
#
# Usage:
#   ./scripts/setup.sh
#   ./scripts/setup.sh --dify-tag 1.14.0  # pin Dify source to a specific tag
#   ./scripts/setup.sh --skip-venv        # don't create .venv (use system Python)
#   ./scripts/setup.sh --skip-clones      # don't re-clone skills/corpus/dify-src
#   ./scripts/setup.sh --latest           # clone corpus at branch tip, skip the reproducibility pin
#
# Default --dify-tag is read from .dify-tag at repo root (fallback "main").
# Idempotent — re-runs are safe (skips already-cloned repos and existing venv).
#
# Tip: if you already have a Dify source clone elsewhere (e.g. a sibling
# dify-workspace/), symlink vendor/dify-src to it before running setup —
# setup.sh detects symlinks and won't overwrite them:
#     ln -s ../dify-workspace vendor/dify-src

set -euo pipefail

cd "$(dirname "$0")/.."  # workspace root
ROOT="$PWD"

SKIP_VENV=false
SKIP_CLONES=false
USE_LATEST=false
DIFY_TAG=""

# Default tag from .dify-tag file at repo root, fallback "main"
if [ -f "$ROOT/.dify-tag" ]; then
    DIFY_TAG=$(tr -d ' \t\n\r' < "$ROOT/.dify-tag")
fi
[ -z "$DIFY_TAG" ] && DIFY_TAG="main"

while [ $# -gt 0 ]; do
    case "$1" in
        --skip-venv)   SKIP_VENV=true; shift ;;
        --skip-clones) SKIP_CLONES=true; shift ;;
        --latest)      USE_LATEST=true; shift ;;
        --dify-tag)    shift; DIFY_TAG="$1"; shift ;;
        --help|-h)
            sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "Unknown arg: $1"; exit 1 ;;
    esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
info() { printf '  • %s\n' "$*"; }

# Source registry reader (spec 022 D1) — pure bash/awk, works before the venv exists.
. "$ROOT/scripts/lib/sources.sh"

# ---------------------------------------------------------------------------
# 1. Vendor Dify source (pinned by --dify-tag / .dify-tag)
# ---------------------------------------------------------------------------
if [ "$SKIP_CLONES" = false ]; then
    bold "[1/5] Vendoring Dify source (tag: $DIFY_TAG)"

    VENDOR_DIR="$ROOT/vendor/dify-src"
    if [ -L "$VENDOR_DIR" ]; then
        # vendor/dify-src is a symlink to an external Dify source clone (e.g. a
        # sibling dify-workspace/). Honor it — never overwrite. Verify the target
        # is a valid Dify git clone at the expected tag.
        TARGET=$(readlink "$VENDOR_DIR")
        if [ -d "$VENDOR_DIR/.git" ]; then
            EXACT_TAG=$(cd "$VENDOR_DIR" && git describe --tags --exact-match 2>/dev/null || true)
            NEAREST_TAG=$(cd "$VENDOR_DIR" && git describe --tags --abbrev=0 2>/dev/null || true)
            CURRENT_REF=$(cd "$VENDOR_DIR" && git rev-parse --short HEAD)
            if [ "$EXACT_TAG" = "$DIFY_TAG" ]; then
                ok "vendor/dify-src/ → $TARGET (symlink, exact tag $DIFY_TAG)"
            elif [ "$NEAREST_TAG" = "$DIFY_TAG" ]; then
                ok "vendor/dify-src/ → $TARGET (symlink, on $DIFY_TAG @ $CURRENT_REF — ahead of tag, compatible)"
            else
                warn "vendor/dify-src/ → $TARGET (symlink, nearest tag '$NEAREST_TAG' @ $CURRENT_REF — expected '$DIFY_TAG')"
                warn "to switch: cd \"$VENDOR_DIR\" && git fetch --tags && git checkout $DIFY_TAG"
            fi
        else
            warn "vendor/dify-src/ → $TARGET is a broken or non-git symlink"
            warn "fix or remove: rm vendor/dify-src && rerun setup.sh"
        fi
    elif [ -d "$VENDOR_DIR/.git" ]; then
        CURRENT_TAG=$(cd "$VENDOR_DIR" && git describe --tags --exact-match 2>/dev/null || git rev-parse --short HEAD)
        if [ "$CURRENT_TAG" = "$DIFY_TAG" ]; then
            ok "vendor/dify-src/ already at $DIFY_TAG"
        else
            warn "vendor/dify-src/ exists at '$CURRENT_TAG' (not '$DIFY_TAG') — skipping"
            warn "to switch: cd vendor/dify-src && git fetch --tags && git checkout $DIFY_TAG"
        fi
    else
        mkdir -p "$ROOT/vendor"
        info "cloning langgenius/dify @ $DIFY_TAG → vendor/dify-src/"
        if git clone --depth=1 --branch "$DIFY_TAG" \
                https://github.com/langgenius/dify.git "$VENDOR_DIR" >/dev/null 2>&1; then
            ok "vendor/dify-src/ (tag $DIFY_TAG)"
        else
            warn "failed to clone Dify source (offline or tag '$DIFY_TAG' missing)"
            warn "gen_schema.py will skip; rerun setup.sh once network/tag is available"
        fi
    fi
else
    bold "[1/5] Skipping Dify source vendor (--skip-clones)"
fi

# ---------------------------------------------------------------------------
# 2. Skills + corpus
# ---------------------------------------------------------------------------
if [ "$SKIP_CLONES" = false ]; then
    bold "[2/5] Cloning skills + corpus"

    # Skills are hard-coded here (spec 022 Q1 defers folding skills into the registry).
    # Format: "<dir>|<url>[|<sparse-subdir>]" (one per line, bash 3.2 compatible — no assoc arrays)
    REPOS="
skills/mango-svip|https://github.com/mango-svip/dify-workflow-skills.git
skills/Tomatio13|https://github.com/Tomatio13/DifyWorkFlowGenerator.git
skills/lazeyliu|https://github.com/lazeyliu/dify-dsl-generator-skills.git
"

    while IFS='|' read -r dir url sparse; do
        [ -z "$dir" ] && continue
        if [ -d "$dir/.git" ]; then
            ok "$dir already present (skipping)"
        elif [ -n "$sparse" ]; then
            info "cloning $url → $dir/ (sparse: $sparse/)"
            if git clone --depth=1 --filter=blob:none --sparse "$url" "$dir" >/dev/null 2>&1; then
                git -C "$dir" sparse-checkout set --cone "$sparse" >/dev/null 2>&1 && ok "$dir (sparse $sparse/)"
            fi
        else
            info "cloning $url → $dir/"
            git clone --depth=1 "$url" "$dir" >/dev/null 2>&1 && ok "$dir"
        fi
    done <<< "$REPOS"

    # Corpus sources are registry-driven (spec 022 D2): one blobless + sparse clone per entry in
    # corpus/sources.yml. Sparse keeps each clone slim (corpus only needs DSL/ ~1M; a full clone
    # drags in ~46M of images the tooling never reads). Adding a source = one registry entry.
    SOURCES_YML="$ROOT/corpus/sources.yml"
    if [ -f "$SOURCES_YML" ]; then
        while IFS='|' read -r name repo ref sparse glob license; do
            [ -z "$name" ] && continue
            dir="corpus/$name"
            if [ -d "$dir/.git" ]; then
                ok "$dir already present (skipping)"
                continue
            fi
            info "cloning $repo → $dir/ (sparse: $sparse/, ref: ${ref:-main})"
            if git clone --depth=1 ${ref:+--branch "$ref"} --filter=blob:none --sparse "$repo" "$dir" >/dev/null 2>&1; then
                # sparse may be comma-joined (e.g. "DSL,assets") — cone takes space-separated dirs.
                git -C "$dir" sparse-checkout set --cone $(printf '%s' "$sparse" | tr ',' ' ') >/dev/null 2>&1 \
                    && ok "$dir (sparse $sparse/)"
            else
                warn "failed to clone $repo (offline, or ref '${ref:-main}' missing / is a bare SHA)"
            fi
        done < <(sources_list "$SOURCES_YML")
    else
        warn "no corpus/sources.yml registry — skipping corpus clones"
    fi
else
    bold "[2/5] Skipping skills/corpus clones (--skip-clones)"
fi

# ---------------------------------------------------------------------------
# 3. Python venv + deps for gen_schema/sync/tests
# ---------------------------------------------------------------------------
if [ "$SKIP_VENV" = false ]; then
    bold "[3/5] Setting up Python venv"

    if ! command -v uv >/dev/null 2>&1; then
        warn "uv not found. Install it: https://docs.astral.sh/uv/getting-started/installation/"
        warn "Falling back to system python3 + pip (may need Python 3.11+)"
        USE_UV=false
    else
        USE_UV=true
    fi

    if [ -d .venv ]; then
        ok ".venv already present"
    elif [ "$USE_UV" = true ]; then
        info "uv venv --python 3.12 .venv"
        uv venv --python 3.12 .venv >/dev/null 2>&1
        ok "created .venv (Python 3.12)"
    else
        python3 -m venv .venv
        ok "created .venv (system python)"
    fi

    info "installing deps from requirements.txt (locked)..."
    # Single pinned source of truth (requirements.txt, locked from requirements.in, spec 024 Q1b).
    if [ "$USE_UV" = true ]; then
        uv pip install --python .venv/bin/python --quiet -r "$ROOT/requirements.txt"
    else
        .venv/bin/pip install --quiet -r "$ROOT/requirements.txt"
    fi
    ok "installed deps from requirements.txt"
else
    bold "[3/5] Skipping venv setup (--skip-venv)"
fi

# ---------------------------------------------------------------------------
# 4. Rebuild INDEX.md + regenerate VS Code yaml.schemas mapping
# ---------------------------------------------------------------------------
bold "[4/5] Pinning corpus to lockfile & rebuilding index"
PY="python3"
[ -x .venv/bin/python ] && PY=".venv/bin/python"

# Reproducibility pin (spec 077 C1). The corpus was cloned at the branch tip in step [2/5], BEFORE the
# venv existed — so the SHA pin CANNOT run there (the lock is JSON, read only by Python). It runs HERE,
# post-venv: for each source with a recorded SHA, fetch that commit shallowly and check it out, so a
# fresh clone rebuilds the EXACT corpus the lock froze. `ref` in sources.yml stays a branch (used for
# the clone); the lock carries the SHA, fetched separately. --latest or --skip-clones skips the pin.
if [ "$SKIP_CLONES" = false ] && [ "$USE_LATEST" = false ] && [ -f "$ROOT/corpus/sources.yml" ]; then
    while IFS='|' read -r name repo ref sparse glob license; do
        [ -z "$name" ] && continue
        dir="$ROOT/corpus/$name"
        branch="${ref:-main}"
        [ -d "$dir/.git" ] || continue
        sha="$("$PY" "$ROOT/tools/dify_base/sources_admin.py" lock-read --name "$name" 2>/dev/null || true)"
        if [ -z "$sha" ]; then
            info "$name: no lockfile entry — leaving at $branch tip"
            continue
        fi
        cur="$(git -C "$dir" rev-parse HEAD 2>/dev/null || true)"
        if [ "$cur" = "$sha" ]; then
            ok "$name: at locked ${sha:0:10}"
        elif git -C "$dir" fetch --depth=1 origin "$sha" >/dev/null 2>&1 \
                && git -C "$dir" checkout --quiet --detach FETCH_HEAD >/dev/null 2>&1; then
            ok "$name: pinned to ${sha:0:10}"
        else
            warn "$name: locked SHA ${sha:0:10} unreachable (force-push/GC or offline) — staying at $branch tip"
        fi
    done < <(sources_list "$ROOT/corpus/sources.yml")
elif [ "$USE_LATEST" = true ]; then
    info "corpus left at branch tip (--latest); run scripts/update_corpus.sh to refresh the lockfile"
fi

"$PY" tools/dify_base/build_index.py 2>&1 | grep -E "Wrote" | sed 's/^/  /'

if [ -f scripts/regen_vscode_settings.py ]; then
    "$PY" scripts/regen_vscode_settings.py 2>&1 | sed 's/^/  /'
fi

# ---------------------------------------------------------------------------
# 5. Smoke test
# ---------------------------------------------------------------------------
bold "[5/5] Smoke tests"
$PY tools/dify_base/find.py --list-features >/dev/null && ok "find.py works"
$PY tools/dify_base/init_project.py --help >/dev/null && ok "init_project.py works"
$PY tools/dify_base/sync.py --help >/dev/null && ok "sync.py works"

if [ -x .venv/bin/pytest ]; then
    .venv/bin/pytest tests/ -q --no-header 2>&1 | tail -1 | sed 's/^/  /'
fi

# ---------------------------------------------------------------------------
echo
bold "Setup complete."
echo
echo "Next steps:"
echo "  • Create a project:    $PY tools/dify_base/init_project.py"
echo "  • Browse templates:    $PY tools/dify_base/find.py --has iteration"
echo "  • Regenerate schema:   .venv/bin/python schemas/gen_schema.py"
echo "  • Run tests:           .venv/bin/pytest tests/"
echo
echo "Dify source is vendored at vendor/dify-src/ (pinned via .dify-tag = $DIFY_TAG)."
echo "To switch versions: ./scripts/setup.sh --dify-tag <new-tag>"

#!/usr/bin/env bash
# Bootstrap a fresh clone of dify-projects.
#
# Re-clones gitignored skills + corpus, sets up the Python venv used by
# gen_schema.py / sync.py / pytest, and rebuilds INDEX.md.
#
# Usage:
#   ./scripts/setup.sh
#   ./scripts/setup.sh --skip-venv     # don't create .venv (use system Python)
#   ./scripts/setup.sh --skip-clones   # don't re-clone skills/corpus
#
# Idempotent — re-runs are safe (skips already-cloned repos and existing venv).

set -euo pipefail

cd "$(dirname "$0")/.."  # workspace root
ROOT="$PWD"

SKIP_VENV=false
SKIP_CLONES=false
for arg in "$@"; do
    case "$arg" in
        --skip-venv)   SKIP_VENV=true ;;
        --skip-clones) SKIP_CLONES=true ;;
        --help|-h)
            sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "Unknown arg: $arg"; exit 1 ;;
    esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
info() { printf '  • %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Skills + corpus
# ---------------------------------------------------------------------------
if [ "$SKIP_CLONES" = false ]; then
    bold "[1/4] Cloning skills + corpus"

    # Format: "<dir>|<url>" (one per line, bash 3.2 compatible — no assoc arrays)
    REPOS="
skills/mango-svip|https://github.com/mango-svip/dify-workflow-skills.git
skills/Tomatio13|https://github.com/Tomatio13/DifyWorkFlowGenerator.git
skills/lazeyliu|https://github.com/lazeyliu/dify-dsl-generator-skills.git
corpus/awesome-dify-workflow|https://github.com/svcvit/Awesome-Dify-Workflow.git
"

    while IFS='|' read -r dir url; do
        [ -z "$dir" ] && continue
        if [ -d "$dir/.git" ]; then
            ok "$dir already present (skipping)"
        else
            info "cloning $url → $dir/"
            git clone --depth=1 "$url" "$dir" >/dev/null 2>&1 && ok "$dir"
        fi
    done <<< "$REPOS"
else
    bold "[1/4] Skipping skills/corpus clones (--skip-clones)"
fi

# ---------------------------------------------------------------------------
# 2. Python venv + deps for gen_schema/sync/tests
# ---------------------------------------------------------------------------
if [ "$SKIP_VENV" = false ]; then
    bold "[2/4] Setting up Python venv"

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

    info "installing deps for gen_schema + sync + tests..."
    DEPS=(
        # Core for schema gen + sync + tests
        pydantic pydantic-settings pyyaml jsonschema python-dotenv requests pytest syrupy
        # Stubbed-at-import-time deps that gen_schema needs to traverse pydantic models
        pycryptodome httpx sqlalchemy charset-normalizer pytz flask redis yarl flask-login cachetools
    )

    if [ "$USE_UV" = true ]; then
        uv pip install --python .venv/bin/python --quiet "${DEPS[@]}"
    else
        .venv/bin/pip install --quiet "${DEPS[@]}"
    fi
    ok "installed $(printf '%s, ' "${DEPS[@]}" | sed 's/, $//' | tr ' ' '\n' | wc -l | tr -d ' ') deps"
else
    bold "[2/4] Skipping venv setup (--skip-venv)"
fi

# ---------------------------------------------------------------------------
# 3. Rebuild INDEX.md (catches newly cloned skills/corpus)
# ---------------------------------------------------------------------------
bold "[3/4] Rebuilding template index"
PY="python3"
[ -x .venv/bin/python ] && PY=".venv/bin/python"
"$PY" tools/dify_base/build_index.py 2>&1 | grep -E "Wrote" | sed 's/^/  /'

# ---------------------------------------------------------------------------
# 4. Smoke test
# ---------------------------------------------------------------------------
bold "[4/4] Smoke tests"
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
echo "Need a Dify workspace clone for schema regen? Defaults to:"
echo "  ~/Desktop/MyProjects/dify-workspace/"
echo "Override with: gen_schema.py --dify-src /path/to/dify"

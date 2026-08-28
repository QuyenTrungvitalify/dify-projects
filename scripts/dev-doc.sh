#!/usr/bin/env bash
# Maintainer-only. Nothing here is needed to run the Builder — a normal clone is complete
# without it, and this script does nothing useful on one.
#
# The development material (specs, test campaigns, state/watch notes, and the maintainer skills)
# lives in a separate private repo. It is checked out into .doc/ and symlinked back to the paths
# it has always occupied, so every document link and every skill keeps resolving. Nothing is
# copied: each file exists in exactly one repository.
#
# Run it on a fresh maintainer machine, or any time the links look wrong. Safe to re-run.
#
#   ./scripts/dev-doc.sh            # set up / repair
#   ./scripts/dev-doc.sh --check    # verify only, change nothing (exit 1 if broken)

set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd -P)"

DOC_REMOTE="${DIFY_DOC_REMOTE:-https://github.com/QuyenTrungvitalify/dify-projects-doc.git}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

# path:depth — depth is the number of `..` from the DIRECTORY HOLDING the link back to the repo
# root. Getting this wrong produces a link that resolves OUTSIDE the repo while `git status` still
# reports a clean tree, so it is verified by realpath below and never by git.
LINKS="
docs/specs:1
docs/prompts:1
docs/state:1
docs/watch:1
tests/test_state_docs_ownership.py:1
.claude/skills/campaign:2
.claude/skills/corpus-update:2
.claude/skills/e2e:2
.claude/skills/report/reports:3
.claude/skills/scout:2
.claude/skills/shelf-inbox:2
.claude/skills/spec-close:2
.claude/skills/template-promote:2
"

# ── 1. the .doc checkout ────────────────────────────────────────────────────────────────────────
if [ ! -d .doc/.git ]; then
    if [ "$CHECK_ONLY" = 1 ]; then echo "MISSING: .doc/ is not a checkout"; exit 1; fi
    echo "→ cloning the documentation repo into .doc/"
    git clone --quiet "$DOC_REMOTE" .doc
else
    [ "$CHECK_ONLY" = 1 ] || echo "→ .doc/ already checked out"
fi

# ── 2. the links ────────────────────────────────────────────────────────────────────────────────
made=0
while IFS=: read -r path depth; do
    [ -z "$path" ] && continue
    up=""; i=0; while [ "$i" -lt "$depth" ]; do up="../$up"; i=$((i + 1)); done
    target="${up}.doc/${path}"

    if [ -L "$path" ]; then
        [ "$(readlink "$path")" = "$target" ] || {
            [ "$CHECK_ONLY" = 1 ] && { echo "WRONG TARGET: $path -> $(readlink "$path")"; exit 1; }
            rm "$path"; ln -s "$target" "$path"; made=$((made + 1)); echo "  retargeted $path"
        }
    elif [ -e "$path" ]; then
        # A real file/dir sits where a link belongs. Never delete it — it may be unpushed work.
        echo "REFUSING: $path exists and is not a symlink. Move it into .doc/ yourself, then re-run."
        exit 1
    else
        [ "$CHECK_ONLY" = 1 ] && { echo "MISSING LINK: $path"; exit 1; }
        mkdir -p "$(dirname "$path")"; ln -s "$target" "$path"; made=$((made + 1)); echo "  linked $path"
    fi
done <<< "$LINKS"

# ── 3. verify by resolution, not by git ─────────────────────────────────────────────────────────
bad=0
while IFS=: read -r path _; do
    [ -z "$path" ] && continue
    real="$(cd "$(dirname "$path")" && cd "$(dirname "$(readlink "$(basename "$path")")")" 2>/dev/null && pwd -P || true)"
    if [ ! -e "$path" ]; then echo "DANGLING: $path"; bad=$((bad + 1))
    elif [ -n "$real" ] && case "$real" in "$ROOT"*) false ;; *) true ;; esac then
        echo "OUTSIDE REPO: $path -> $real"; bad=$((bad + 1))
    fi
done <<< "$LINKS"
[ "$bad" -eq 0 ] || { echo "$bad link(s) bad."; exit 1; }

# ── 4. the commit guard ─────────────────────────────────────────────────────────────────────────
# The ignore rules already do the real work: `git add -A` cannot reach these paths, verified. What
# remains is a deliberate `git add -f`, which stages the SYMLINK — committing that would put a
# dangling link on every user's machine, and the published history is append-only, so it cannot be
# taken back by rewriting. Cheap enough to stop at the door.
HOOK=.git/hooks/pre-commit
if [ "$CHECK_ONLY" = 0 ] && [ ! -e "$HOOK" ]; then
    cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# Installed by scripts/dev-doc.sh. Maintainer-only; never committed.
staged=$(git diff --cached --name-only | grep -E '^(docs/(specs|prompts|state|watch)|tests/test_state_docs_ownership\.py|\.claude/(projects|skills/(campaign|corpus-update|e2e|report/reports|scout|shelf-inbox|spec-close|template-promote)))' || true)
if [ -n "$staged" ]; then
    echo "This commit stages paths that belong to the documentation repo:"
    echo "$staged" | sed 's/^/  /'
    echo "Commit them in .doc/ instead. To override: git commit --no-verify"
    exit 1
fi
HOOK_EOF
    chmod +x "$HOOK"
    echo "  installed $HOOK"
elif [ "$CHECK_ONLY" = 0 ]; then
    echo "  $HOOK already present — left alone"
fi

if [ "$CHECK_ONLY" = 1 ]; then echo "all links resolve inside the repo."; else
    echo "✓ .doc/ ready, ${made} link(s) created/repaired, all resolve inside the repo."
fi

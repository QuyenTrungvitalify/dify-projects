#!/usr/bin/env bash
# Bump (or verify) the pinned toolchain — maintainer tool, never run on a user machine.
#
#   ./scripts/bump-toolchain.sh node 22.24.0   # repin node: version + all four checksums
#   ./scripts/bump-toolchain.sh uv 0.9.30      # repin uv
#   ./scripts/bump-toolchain.sh --verify       # confirm every COMMITTED checksum still matches upstream
#
# WHY THIS EXISTS. The pin is eight checksums across two tools and four platforms. Editing them by
# hand means a typo or an omission breaks exactly one platform — and only a user ON that platform
# ever finds out, late, with a message about a corrupt download. Generating each tool's four lines
# from the same upstream source in one shot removes that whole failure class (spec 110 Q8).
# `--verify` is the other half: anyone can confirm the committed bytes are the upstream bytes
# without trusting whoever ran the bump.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB="$ROOT/scripts/lib/toolchain.sh"
SUMS="$ROOT/scripts/toolchain-checksums.txt"
NODE_PLATFORMS="darwin-arm64 darwin-x64 linux-x64 linux-arm64"
UV_TARGETS="aarch64-apple-darwin x86_64-apple-darwin x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu"

. "$LIB"

die() { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }
ok()  { printf '\033[32m✓\033[0m %s\n' "$*"; }

# Print the four `<sha>  <file>` lines for a node release, straight from its SHASUMS256.txt.
node_lines() {
    local ver="$1" upstream line
    upstream="$(curl -fsSL "https://nodejs.org/dist/v${ver}/SHASUMS256.txt")" \
        || die "could not fetch SHASUMS256.txt for node v$ver (does that release exist?)"
    for plat in $NODE_PLATFORMS; do
        line="$(printf '%s\n' "$upstream" | awk -v f="node-v${ver}-${plat}.tar.gz" '$2 == f {print; exit}')"
        [ -n "$line" ] || die "upstream SHASUMS256.txt has no entry for node-v${ver}-${plat}.tar.gz"
        printf '%s\n' "$line"
    done
}

# uv publishes one .sha256 file per asset rather than a combined manifest.
uv_lines() {
    local ver="$1" sha
    for t in $UV_TARGETS; do
        sha="$(curl -fsSL "https://github.com/astral-sh/uv/releases/download/${ver}/uv-${t}.tar.gz.sha256" \
               | awk '{print $1}')" || die "could not fetch checksum for uv-${t} @ $ver"
        [ -n "$sha" ] || die "empty checksum for uv-${t} @ $ver"
        printf '%s  uv-%s.tar.gz\n' "$sha" "$t"
    done
}

render() {  # render <node-ver> <uv-ver>
    cat <<HDR
# sha256 of every prebuilt archive this repo pins, in \`<sha256>  <filename>\` form.
#
# GENERATED — do not hand-edit. Regenerate / verify with:
#   ./scripts/bump-toolchain.sh node <version>
#   ./scripts/bump-toolchain.sh uv <version>
#   ./scripts/bump-toolchain.sh --verify      # confirm committed values still match upstream
#
# Node lines are copied verbatim from https://nodejs.org/dist/v<ver>/SHASUMS256.txt
# uv lines are copied from each release asset's own .sha256 file on GitHub.

# node $1  (fetched $(date -u +%Y-%m-%d))
HDR
    node_lines "$1"
    printf '\n# uv %s  (fetched %s)\n' "$2" "$(date -u +%Y-%m-%d)"
    uv_lines "$2"
}

WHAT="${1:-}"
[ -z "$WHAT" ] && die "usage: $0 <node|uv> <version> | --verify"

if [ "$WHAT" = "--verify" ]; then
    tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
    render "$NODE_VERSION" "$UV_VERSION" > "$tmp"
    # Compare only the checksum lines — the header carries a fetch date that legitimately differs.
    a="$(grep -v '^#' "$SUMS" | grep -v '^[[:space:]]*$' | sort)"
    b="$(grep -v '^#' "$tmp"  | grep -v '^[[:space:]]*$' | sort)"
    if [ "$a" = "$b" ]; then
        ok "all $(printf '%s\n' "$b" | wc -l | tr -d ' ') committed checksums match upstream (node $NODE_VERSION, uv $UV_VERSION)"
        exit 0
    fi
    printf '\033[31m✗\033[0m committed checksums do NOT match upstream\n\n' >&2
    diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") >&2 || true
    exit 1
fi

VER="${2:-}"; VER="${VER#v}"
[ -n "$VER" ] && [ -n "$WHAT" ] || die "usage: $0 <node|uv> <version> | --verify"

case "$WHAT" in
  node)
    # A bump must never drop below the `engines` floor both package.json files declare.
    ENGINE_MIN="$(grep -ho '"node"[[:space:]]*:[[:space:]]*">=[0-9.]*"' \
        "$ROOT/apps/builder/package.json" "$ROOT/apps/builder/web/package.json" \
        | grep -o '[0-9][0-9.]*' | sort -V | tail -1)"
    if [ -n "$ENGINE_MIN" ]; then
        [ "$(printf '%s\n%s\n' "$ENGINE_MIN" "$VER" | sort -V | head -1)" = "$ENGINE_MIN" ] \
            || die "node $VER is below the engines floor (>=$ENGINE_MIN) declared in package.json"
        ok "node $VER satisfies engines >=$ENGINE_MIN"
    fi
    NEW_NODE="$VER"; NEW_UV="$UV_VERSION" ;;
  uv)
    NEW_NODE="$NODE_VERSION"; NEW_UV="$VER" ;;
  *) die "unknown target '$WHAT' (expected: node, uv, or --verify)" ;;
esac

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
render "$NEW_NODE" "$NEW_UV" > "$tmp"
cat "$tmp" > "$SUMS"

# Rewrite the pinned lines in lib/toolchain.sh, preserving their trailing comments.
tmp_lib="$(mktemp)"
sed -e "s/^NODE_VERSION=\"[^\"]*\"/NODE_VERSION=\"${NEW_NODE}\"/" \
    -e "s/^UV_VERSION=\"[^\"]*\"/UV_VERSION=\"${NEW_UV}\"/" "$LIB" > "$tmp_lib"
cat "$tmp_lib" > "$LIB"; rm -f "$tmp_lib"

ok "pinned node=$NEW_NODE uv=$NEW_UV"
ok "rewrote $(basename "$SUMS")"
echo
echo "Next: commit both files. A user machine picks the change up on its next launch —"
echo "update-and-run.sh re-runs bootstrap whenever the installed node no longer matches the pin."

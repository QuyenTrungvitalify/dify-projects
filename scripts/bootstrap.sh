#!/usr/bin/env bash
# ============================================================
#  bootstrap.sh — 新しいマシンで最初に一度だけ実行します
#
#  Node と Python を「インストール」しません。公式のビルド済みファイルを
#  リポジトリ内の .toolchain/ に展開するだけです。管理者権限は不要で、
#  お使いのマシンの他のプロジェクト（nvm / pyenv / brew）には一切触れません。
#  取り消しは  rm -rf .toolchain  だけです。
# ============================================================
#
# Usage:
#   ./scripts/bootstrap.sh              # full bootstrap
#   ./scripts/bootstrap.sh --toolchain-only   # fetch node+uv, skip setup.sh/setup-node.sh
#   NODE_MIRROR=http://host/dist ./scripts/bootstrap.sh   # corporate mirror / pre-staged tarballs
#
# Idempotent: re-running is safe and cheap (it re-downloads only what is missing or mismatched).
# Spec 110 S1/S6/S7.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$ROOT/scripts/lib/toolchain.sh"

TC="$(toolchain_dir "$ROOT")"
TOOLCHAIN_ONLY=false
[ "${1:-}" = "--toolchain-only" ] && TOOLCHAIN_ONLY=true

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
die()  { printf '\n  \033[31m✗\033[0m %s\n\n' "$*" >&2; exit 1; }

# sha256 with whichever tool this OS ships (macOS: shasum, most Linux: sha256sum).
sha256_of() {
    if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else die "sha256 を計算できません（shasum / sha256sum が見つかりません）"; fi
}

echo "======================================================"
echo "  Dify Builder — 初回セットアップ"
echo "======================================================"
echo ""

toolchain_lock "$ROOT" || die "すでに別のウィンドウで実行中です。そちらの終了をお待ちください。"

PLAT="$(node_platform)" || die "このマシンの種類には未対応です（$(uname -s)-$(uname -m)）。担当者にご連絡ください。"

if under_rosetta; then
    warn "このターミナルは Rosetta 上で動作しています（Intel 版をダウンロードします）。"
    warn "Apple Silicon 本来の速度で使うには、ターミナルの「情報を見る」で"
    warn "「Rosetta を使用して開く」のチェックを外してから、もう一度実行してください。"
fi

# One download path for BOTH tools: fetch, check the sha256 against the value committed in this
# repo, and only then unpack. Everything a user machine installs is verified the same way — an
# earlier draft let uv in through `curl … | sh`, which trusted the network for one tool while
# checksumming the other. Do not reintroduce that asymmetry.
fetch_verified() {   # fetch_verified <url> <filename-in-checksums> <dest-dir>
    local url="$1" name="$2" dest="$3" expected actual tmp
    expected="$(awk -v f="$name" '$2 == f {print $1}' "$ROOT/scripts/toolchain-checksums.txt")"
    [ -n "$expected" ] || die "$name のチェックサムが scripts/toolchain-checksums.txt にありません。担当者にご連絡ください。"

    tmp="$TC/.download.tmp"
    rm -f "$tmp"
    mkdir -p "$TC"
    curl -fL --progress-bar --retry 3 --retry-delay 2 "$url" -o "$tmp" \
        || die "ダウンロードに失敗しました:
       $url
     ネットワーク（社内プロキシ等）をご確認ください。社内ミラーがある場合は:
       NODE_MIRROR=http://<社内ホスト>/dist ./scripts/bootstrap.sh"

    actual="$(sha256_of "$tmp")"
    if [ "$actual" != "$expected" ]; then
        rm -f "$tmp"
        die "ダウンロードしたファイルが壊れているか、改ざんされています（チェックサム不一致）。
     file    : $name
     expected: $expected
     actual  : $actual
     もう一度実行しても直らない場合は、実行せずに担当者へご連絡ください。"
    fi

    mkdir -p "$dest"
    tar -xzf "$tmp" -C "$dest" --strip-components=1
    rm -f "$tmp"
}

# ── 1. Node — official prebuilt tarball ───────────────────────────────────────────────────────────
bold "[1/4] Node ${NODE_VERSION} を用意します"
if [ -x "$TC/node/bin/node" ] && [ "$("$TC/node/bin/node" --version 2>/dev/null)" = "v$NODE_VERSION" ]; then
    ok "すでに用意済み（v${NODE_VERSION}）"
else
    TARBALL="node-v${NODE_VERSION}-${PLAT}.tar.gz"
    rm -rf "$TC/node"
    fetch_verified "${NODE_MIRROR:-https://nodejs.org/dist}/v${NODE_VERSION}/${TARBALL}" "$TARBALL" "$TC/node"
    ok "node $("$TC/node/bin/node" --version)  (.toolchain/node/)"
fi

# ── 2. uv — prebuilt binary, into .toolchain/bin (no rc file touched, nothing installed globally) ──
bold "[2/4] uv（Python 用ツール）を用意します"
if [ -x "$TC/bin/uv" ] && [ "$("$TC/bin/uv" --version 2>/dev/null | awk '{print $2}')" = "$UV_VERSION" ]; then
    ok "すでに用意済み（uv ${UV_VERSION}）"
else
    UV_TARGET="$(uv_target)" || die "このマシンの種類には未対応です（uv）。"
    UV_TARBALL="uv-${UV_TARGET}.tar.gz"
    rm -rf "$TC/bin"
    fetch_verified "${UV_MIRROR:-https://github.com/astral-sh/uv/releases/download}/${UV_VERSION}/${UV_TARBALL}" \
        "$UV_TARBALL" "$TC/bin"
    [ -x "$TC/bin/uv" ] || die "uv を展開できませんでした。担当者にご連絡ください。"
    ok "uv $("$TC/bin/uv" --version 2>/dev/null | awk '{print $2}')  (.toolchain/bin/)"
fi

# From here on, everything runs on the repo's own toolchain — and with the user's NODE_ENV /
# PYTHONPATH / PYTHONHOME cleared, because those break this repo in ways that name something else
# in the error message (spec 110 §1.8).
use_toolchain "$ROOT"

if [ "$TOOLCHAIN_ONLY" = true ]; then
    echo ""; bold "ツールチェーンの準備が完了しました（--toolchain-only）"; exit 0
fi

# ── 3. Claude CLI — deliberately NOT vendored: one self-updating binary, no per-project conflict ──
bold "[3/4] Claude CLI を確認します"
if command -v claude >/dev/null 2>&1; then
    ok "claude は導入済みです"
else
    echo ""
    echo "  Claude CLI がまだ入っていません。次のコマンドでインストールします:"
    echo "      curl -fsSL https://claude.ai/install.sh | bash"
    echo ""
    printf "  いま実行しますか？ [y/N] "
    read -r ans
    case "$ans" in
        [yY]*) curl -fsSL https://claude.ai/install.sh | bash || die "Claude CLI のインストールに失敗しました。" ;;
        *) warn "スキップしました。あとで上のコマンドを実行してください（アプリのビルドに必要です）。" ;;
    esac
fi

# ── 4. The repo itself ────────────────────────────────────────────────────────────────────────────
bold "[4/4] リポジトリを準備します（初回は数分かかります）"
echo ""
# --skip-dify-src: the full Dify source clone is only needed to REGENERATE schemas/, which is a
# maintainer/CI job — the generated schema is committed. It was the largest and most failure-prone
# network step in a first-time setup, for something a user never runs (spec 110 S7).
"$ROOT/scripts/setup.sh" --skip-dify-src
echo ""
"$ROOT/scripts/setup-node.sh"

echo ""
echo "======================================================"
bold "  セットアップ完了"
echo "======================================================"
echo ""
echo "  次の手順:"
if ! claude auth status >/dev/null 2>&1; then
    echo "    1. claude auth login          ← まだログインしていません"
    echo "    2. scripts/update-and-run.command をダブルクリック"
else
    echo "    scripts/update-and-run.command をダブルクリックしてアプリを起動します"
fi
echo ""
echo "  うまくいかないときは:  ./scripts/doctor.sh"
echo ""

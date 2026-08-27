#!/usr/bin/env bash
# ============================================================
#  doctor.sh — 「動かない」ときに最初に実行してください
#
#  1つずつ確認して、✅ / ❌ の表を出します。❌ の行には直すためのコマンドが
#  1つだけ付きます。それでも直らないときは、この出力をそのまま担当者に送って
#  ください（これがあれば往復の質問がなくなります）。
# ============================================================
#
# HARD CONSTRAINT: this must run on a machine where NOTHING is installed yet — no node, no python,
# no .toolchain. So: plain bash only, nothing from node_modules, and no `set -e` (a failing probe is
# a RESULT here, not a crash). Spec 110 S3.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# Sourced for NODE_VERSION / node_platform / under_rosetta. If it is missing the checkout is broken,
# which is itself worth saying plainly.
if [ -r "$ROOT/scripts/lib/toolchain.sh" ]; then
    . "$ROOT/scripts/lib/toolchain.sh"
else
    echo "✗ scripts/lib/toolchain.sh がありません — リポジトリが壊れています。"
    echo "  直し方:  git checkout -- scripts/  （それでも直らなければ担当者へ）"
    exit 1
fi

TC="$(toolchain_dir "$ROOT")"
FAILED=0
G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; DIM=$'\033[2m'; N=$'\033[0m'

# row <label> <ok?> <detail> [fix command]
row() {
    local label="$1" good="$2" detail="$3" fix="${4:-}"
    if [ "$good" = "1" ]; then
        printf "  ${G}✅${N} %-26s %s\n" "$label" "$detail"
    else
        FAILED=$((FAILED + 1))
        printf "  ${R}❌${N} %-26s %s\n" "$label" "$detail"
        [ -n "$fix" ] && printf "     ${DIM}→ %s${N}\n" "$fix"
    fi
}
note() { printf "  ${DIM}·  %-26s %s${N}\n" "$1" "$2"; }
warnrow() { printf "  ${Y}⚠${N}  %-26s %s\n" "$1" "$2"; }

BOOTSTRAP="./scripts/bootstrap.sh を実行してください"

echo "======================================================"
echo "  Dify Builder — 環境チェック"
echo "======================================================"
echo ""
echo "  リポジトリ: $ROOT"
echo ""

# ── 1. リポジトリ専用のツールチェーン ─────────────────────────────────────────────
echo "── リポジトリ専用のツールチェーン（.toolchain/）──"
if [ -x "$TC/node/bin/node" ]; then
    have="$("$TC/node/bin/node" --version 2>/dev/null)"
    if [ "$have" = "v$NODE_VERSION" ]; then
        row "node" 1 "$have"
    else
        row "node" 0 "${have}（指定は v${NODE_VERSION}）" "$BOOTSTRAP"
    fi
else
    row "node" 0 "未導入" "$BOOTSTRAP"
fi

if [ -x "$TC/bin/uv" ]; then
    row "uv" 1 "$("$TC/bin/uv" --version 2>/dev/null | awk '{print $2}')"
else
    row "uv" 0 "未導入" "$BOOTSTRAP"
fi

if [ -x "$ROOT/.venv/bin/python" ]; then
    row "Python (.venv)" 1 "$("$ROOT/.venv/bin/python" --version 2>&1 | awk '{print $2}')"
else
    row "Python (.venv)" 0 "未作成" "$BOOTSTRAP"
fi

# ── 2. マシン側との切り分け ───────────────────────────────────────────────────────
# The single most useful thing this tool prints: which node is which. Confusing "the machine's node"
# with "the repo's node" is the root of the whole problem class this repo pins against (spec 110 §1.4).
echo ""
echo "── マシン側（このリポジトリは使いません・変更もしません）──"
if command -v node >/dev/null 2>&1; then
    note "node（マシン）" "$(node --version 2>/dev/null)  $(command -v node)"
else
    note "node（マシン）" "なし（問題ありません）"
fi
if command -v python3 >/dev/null 2>&1; then
    note "python3（マシン）" "$(python3 --version 2>&1 | awk '{print $2}')  $(command -v python3)"
fi
under_rosetta && warnrow "Rosetta" "ターミナルが Rosetta 上で動作しています（Intel 版が使われます）"

# ── 3. Claude CLI ─────────────────────────────────────────────────────────────────
echo ""
echo "── Claude ──"
CLAUDE_BIN=""
for c in "$HOME/.local/bin/claude" "$(command -v claude 2>/dev/null || true)"; do
    [ -n "$c" ] && [ -x "$c" ] && { CLAUDE_BIN="$c"; break; }
done
if [ -n "$CLAUDE_BIN" ]; then
    row "claude" 1 "$("$CLAUDE_BIN" --version 2>/dev/null | head -1)"
    if "$CLAUDE_BIN" auth status >/dev/null 2>&1; then
        row "ログイン" 1 "済み"
    else
        row "ログイン" 0 "未ログイン" "claude auth login"
    fi
else
    row "claude" 0 "未導入" "curl -fsSL https://claude.ai/install.sh | bash"
    row "ログイン" 0 "確認できません" "claude をインストールしてから claude auth login"
fi

# ── 4. リポジトリの中身 ───────────────────────────────────────────────────────────
echo ""
echo "── リポジトリの中身 ──"
[ -d "$ROOT/skills" ] && [ -n "$(ls -A "$ROOT/skills" 2>/dev/null | grep -v '^\.gitkeep$')" ] \
    && row "skills/" 1 "あり" \
    || row "skills/" 0 "空です" "./scripts/setup.sh"
[ -d "$ROOT/corpus" ] && [ -n "$(ls -A "$ROOT/corpus" 2>/dev/null | grep -v '^\.gitkeep$')" ] \
    && row "corpus/" 1 "あり" \
    || row "corpus/" 0 "空です" "./scripts/setup.sh"
[ -d "$ROOT/apps/builder/node_modules" ] \
    && row "依存パッケージ" 1 "インストール済み" \
    || row "依存パッケージ" 0 "未インストール" "./scripts/setup-node.sh"
[ -f "$ROOT/apps/builder/web/dist/index.html" ] \
    && row "ビルド成果物" 1 "あり" \
    || row "ビルド成果物" 0 "未ビルド" "./scripts/setup-node.sh"

# ── 5. Dify 連携（任意）───────────────────────────────────────────────────────────
# Existence only. NEVER print a value from .env — it holds the Dify token (spec 110 S3).
echo ""
echo "── Dify 連携（使わない場合は不要です）──"
if [ -f "$ROOT/apps/builder/.env" ]; then
    for key in DIFY_CONSOLE_URL DIFY_CONSOLE_TOKEN; do
        if grep -qE "^[[:space:]]*${key}=[^[:space:]]" "$ROOT/apps/builder/.env" 2>/dev/null; then
            note "$key" "設定あり"
        else
            note "$key" "未設定（「デプロイなし」で使う場合は問題ありません）"
        fi
    done
else
    note "apps/builder/.env" "なし（「デプロイなし」で使う場合は問題ありません）"
fi

# ── 6. ネットワーク / 実行環境 ────────────────────────────────────────────────────
echo ""
echo "── その他 ──"
# The user's ~/.npmrc is deliberately NOT overridden (a corporate machine may require its own
# registry) — but it decides where `npm ci` fetches from, so it must at least be visible (Q6).
if [ -x "$TC/node/bin/npm" ]; then
    reg="$(PATH="$TC/node/bin:$PATH" npm config get registry 2>/dev/null)"
    if [ "$reg" = "https://registry.npmjs.org/" ]; then
        note "npm registry" "$reg"
    else
        warnrow "npm registry" "$reg  ← 既定ではありません（~/.npmrc の設定）"
    fi
fi
if command -v lsof >/dev/null 2>&1 && lsof -ti:4123 >/dev/null 2>&1; then
    warnrow "ポート 4123" "使用中（アプリが既に起動しています）"
else
    note "ポート 4123" "空き"
fi
for v in NODE_ENV NODE_OPTIONS PYTHONHOME PYTHONPATH VIRTUAL_ENV; do
    # Not a failure: the launcher clears these. Shown because seeing them explains a puzzling machine.
    [ -n "${!v:-}" ] && warnrow "$v" "設定されています（アプリ実行時は自動で無視します）"
done

# ── まとめ ────────────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
if [ "$FAILED" -eq 0 ]; then
    printf "  ${G}すべて正常です。${N}\n"
    echo "  scripts/update-and-run.command をダブルクリックして起動できます。"
else
    printf "  ${R}%d 件の問題が見つかりました。${N}上の → のコマンドを順に実行してください。\n" "$FAILED"
    echo "  直らない場合は、この画面をすべてコピーして担当者にお送りください。"
fi
echo "======================================================"
echo ""
exit 0

#!/usr/bin/env bash
# ============================================================
#  update-and-run.sh — 更新して起動する本体
#
#  ダブルクリックで使うのは update-and-run.command（macOS）/ update-and-run.bat（Windows）です。
#  中身が二重にならないよう、実際の処理はこの1ファイルにまとめてあります。
# ============================================================
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.." || { echo "❌ フォルダに移動できませんでした"; exit 1; }
ROOT="$PWD"
. "$ROOT/scripts/lib/toolchain.sh"

# ここが肝心 — このリポジトリ専用の node / python を使い、お使いのシェルの PATH や
# NODE_ENV / PYTHONPATH などの設定には左右されないようにします（spec 110 S2/S6）。
# Finder から開いても、iTerm から開いても、ここから先はまったく同じ環境になります。
use_toolchain "$ROOT"

echo "======================================================"
echo "  Dify Builder — 更新して起動します"
echo "======================================================"

if ! toolchain_lock "$ROOT"; then
    echo ""
    echo "⚠ すでに別のウィンドウで起動処理が動いています。"
    echo "   そちらのウィンドウをご確認ください。"
    exit 1
fi

echo ""
echo "▶ 1/5  実行中のサーバーを停止します…"
lsof -ti:4123 | xargs kill 2>/dev/null || true

# ── ツールチェーンの自動追従（spec 110 S2）────────────────────────────────────
# NODE_VERSION を上げると、次に起動したときここで自動的に入れ替わります。
# 利用者は何もしなくて構いません（お知らせも、再インストールも不要です）。
echo ""
echo "▶ 2/5  実行環境を確認します…"
if [ ! -x "$ROOT/.toolchain/node/bin/node" ] \
   || [ "$("$ROOT/.toolchain/node/bin/node" --version 2>/dev/null)" != "v$NODE_VERSION" ]; then
    echo "   Node ${NODE_VERSION} を用意します（初回、またはバージョン更新時のみ）…"
    if ! "$ROOT/scripts/bootstrap.sh" --toolchain-only; then
        echo ""
        echo "❌ 実行環境を用意できませんでした。 ./scripts/doctor.sh を実行してください。"
        exit 1
    fi
else
    echo "   OK（node ${NODE_VERSION}）"
fi

echo ""
echo "▶ 3/5  最新コードを取得します (git pull)…"
# main にいるときだけ更新します。
#
# 以前はここで無条件に `git checkout main` していました。作業ツリーがきれいだと成功してしまうため、
# ブランチを取り出して動作確認していた人は「黙って main に戻され、main をビルドして、main をテスト
# していた」ことになります — 画面には何も出ないまま。テストの結論そのものが無意味になる壊れ方でした。
#
# いまは切り替えません。main 以外にいる場合は更新をスキップし、その理由を表示して、いま出ている
# ブランチのままビルド・起動します。ふつうの利用者は常に main にいるので、この行より下の動作は
# まったく変わりません。うっかり別ブランチにいる場合も、勝手に戻さず画面に表示するので、
# 「気づかないまま古いコードが動き続ける」ことはありません。
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [ "$BRANCH" = "main" ]; then
  if ! git pull --ff-only origin main; then
    echo ""
    echo "❌ git pull に失敗しました（競合や接続の問題の可能性）。"
    echo "   担当者に連絡してください。"
    exit 1
  fi
else
  echo ""
  echo "⚠ いま main ではなく「${BRANCH:-(不明)}」ブランチにいます。"
  echo "   更新（git pull）はスキップし、このブランチのままビルドして起動します。"
  echo "   最新版に戻すには:  git checkout main  を実行してから、もう一度このファイルを開いてください。"
fi

echo ""
echo "▶ 4/5  必要なものだけ更新します…"
if ! ./scripts/setup-node.sh; then
  echo ""
  echo "❌ ビルドに失敗しました。 ./scripts/doctor.sh を実行し、その出力を担当者にお送りください。"
  exit 1
fi

# ── 開発者モード（spec 080）────────────────────────────────────────────────
# リポジトリ直下に `.builder-dev` ファイルがあるマシンだけ、BUILDER_DEV=1 で起動し
# ?dev=1 付きでブラウザを開きます（shelf ダッシュボード等の dev 画面が有効になる）。
# このファイルは git 管理外（.gitignore 済み）— 他のユーザーには一切影響しません。
#   有効化: リポジトリ直下で  touch .builder-dev
#   無効化: rm .builder-dev  （ブラウザ側は ?dev=0 を一度開くと dev 表示も消えます）
DEV_QUERY=""
if [ -f .builder-dev ]; then
  export BUILDER_DEV=1
  DEV_QUERY="/?dev=1"
fi

# セットアップはここで終わり。ロックはアプリ起動の前に必ず解放します — このランチャーの
# 「もう一度ダブルクリックすれば入れ直る」動線（1/5 でポート 4123 を止めてから起動）を
# ロックが塞いでしまうためです（lib/toolchain.sh の SCOPE を参照）。
toolchain_unlock "$ROOT"

echo ""
echo "======================================================"
echo "  ▶ 5/5  アプリを起動します"
echo ""
echo "   ブラウザで  http://127.0.0.1:4123  を開いてください"
echo "   画面が古い場合は  Cmd + Shift + R  で更新（ハードリロード）"
if [ -n "$DEV_QUERY" ]; then
  echo ""
  echo "   🛠 開発者モードで起動します（.builder-dev を検出 → BUILDER_DEV=1）"
fi
echo ""
echo "   ⚠ このウィンドウは閉じないでください（閉じるとアプリが止まります）"
echo "   停止したいときは  Ctrl + C"
echo "======================================================"
echo ""

# ブラウザを開く手段は OS で異なります（WSL からは Windows 側のブラウザを開きます）。
open_browser() {
    local url="http://127.0.0.1:4123${DEV_QUERY}"
    sleep 3
    if command -v open >/dev/null 2>&1; then open "$url"
    elif command -v wslview >/dev/null 2>&1; then wslview "$url"
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"
    else echo "   ブラウザで $url を開いてください"; fi
}
open_browser >/dev/null 2>&1 &

cd apps/builder && npm start

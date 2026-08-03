#!/bin/bash
# ============================================================
#  update-and-run.command
#  最新コードを取得 → ビルド → アプリ起動 を一括で行います。
#  Finder でこのファイルをダブルクリックするだけでOK。
# ============================================================
set -uo pipefail

# このスクリプトが置かれている scripts/ の1つ上（リポジトリのルート）へ移動
cd "$(dirname "$0")/.." || { echo "❌ フォルダに移動できませんでした"; read -r _; exit 1; }

echo "======================================================"
echo "  Dify Builder — 更新して起動します"
echo "======================================================"

echo ""
echo "▶ 1/4  実行中のサーバーを停止します…"
lsof -ti:4123 | xargs kill 2>/dev/null || true

echo ""
echo "▶ 2/4  最新コードを取得します (git pull)…"
if ! git pull; then
  echo ""
  echo "❌ git pull に失敗しました（ローカルに未保存の変更や競合がある可能性）。"
  echo "   担当者に連絡してください。ウィンドウを閉じるには Enter キー。"
  read -r _
  exit 1
fi

echo ""
echo "▶ 3/4  インストール & ビルド中…（初回は数分かかることがあります）"
if ! ./scripts/setup-node.sh; then
  echo ""
  echo "❌ ビルドに失敗しました。担当者に連絡してください。Enter キーで閉じます。"
  read -r _
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

echo ""
echo "======================================================"
echo "  ▶ 4/4  アプリを起動します"
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

(sleep 3 && open "http://127.0.0.1:4123${DEV_QUERY}") &
cd apps/builder && npm start

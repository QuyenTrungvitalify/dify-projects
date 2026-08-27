#!/bin/bash
# ============================================================
#  update-and-run.command — macOS 用のダブルクリック入口
#
#  中身は update-and-run.sh にあります（Windows 版 .bat と共通の本体を使うため。
#  片方だけ直して食い違う、という事故を防ぎます — spec 110 S2）。
# ============================================================
cd "$(dirname "$0")/.." || { echo "❌ フォルダに移動できませんでした"; read -r _; exit 1; }
./scripts/update-and-run.sh
status=$?
# 失敗したときにウィンドウが即座に閉じると、原因が読めません。
if [ $status -ne 0 ]; then
  echo ""
  echo "ウィンドウを閉じるには Enter キーを押してください。"
  read -r _
fi
exit $status

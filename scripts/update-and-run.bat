@echo off
REM ============================================================
REM  update-and-run.bat - Windows 用のダブルクリック入口
REM
REM  Windows では WSL2 の中で動かします。中身は update-and-run.sh
REM  （macOS と共通の本体）です - spec 110 S2/§3。
REM
REM  ※ リポジトリは WSL の中（~/dify-projects）に置いてください。
REM     /mnt/c/... に置くと npm と git が極端に遅くなります。
REM ============================================================
setlocal

where wsl >nul 2>&1
if errorlevel 1 (
  echo.
  echo [X] WSL が見つかりません。PowerShell で次を実行してから再起動してください:
  echo       wsl --install
  echo.
  pause
  exit /b 1
)

REM このファイルは WSL 内のリポジトリにあるので、\\wsl$ 経由ではなく
REM WSL 側のパスに変換して実行します。
for /f "usebackq delims=" %%p in (`wsl wslpath -a "%~dp0.."`) do set "REPO=%%p"

wsl -- bash -lc "cd '%REPO%' && ./scripts/update-and-run.sh"
if errorlevel 1 (
  echo.
  echo 何か問題が起きました。次を実行して、その出力を担当者にお送りください:
  echo    wsl -- bash -lc "cd '%REPO%' && ./scripts/doctor.sh"
  echo.
  pause
)
endlocal

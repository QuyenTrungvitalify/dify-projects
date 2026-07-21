#!/usr/bin/env bash
# campaign-run.sh — sequential background runner for one /campaign (spec 073 S2).
#
#   campaign-run.sh <campaign-dir> [--timeout-min 25] [--max-wait-rounds 3]
#
# One invocation drives the whole approved campaign: verify → (next → fire → wait → record)* until
# `next` reports nothing pending. Designed to be launched IN THE BACKGROUND by the /campaign skill —
# a single build runs 8–13 real minutes, far beyond any interactive tool timeout, so the orchestrating
# session only starts this script and reads campaign.yml/status afterwards.
#
# Error policy (spec 073 §2 + v0.1.0 lessons): a settled-as-error run is retried exactly ONCE
# (both taskIds recorded — the report stage classifies infra vs propensity, this script does not
# guess); if the retry also errors, STOP THE WHOLE RUN — the most common cause is an exhausted
# quota, and there is no API that says when it resets, so burning the remaining prompts would fail
# them all. Resume = simply re-run this script: `next` skips settled entries.
#
# Exit: 0 campaign settled · 1 stopped after a double error · 2 usage/verify · 3 backend unreachable
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3
# CAMPAIGN_E2E: test seam — the error-path drill (tests/test_campaign.py) substitutes a stub
# e2e-run.sh so retry/double-error/resume run WITHOUT burning real turns. Production never sets it.
E2E="${CAMPAIGN_E2E:-$SCRIPT_DIR/e2e-run.sh}"
CAMPAIGN="$SCRIPT_DIR/campaign.py"

command -v jq >/dev/null || { echo "FATAL: jq is required" >&2; exit 2; }

CDIR=${1:-}; shift || true
[ -n "$CDIR" ] && [ -d "$CDIR" ] || { echo "usage: campaign-run.sh <campaign-dir> [--timeout-min N]" >&2; exit 2; }
TIMEOUT_MIN=25; MAX_WAIT_ROUNDS=3
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout-min)     TIMEOUT_MIN=$2; shift 2 ;;
    --max-wait-rounds) MAX_WAIT_ROUNDS=$2; shift 2 ;;
    *) echo "unknown flag $1" >&2; exit 2 ;;
  esac
done

"$PY" "$CAMPAIGN" verify "$CDIR" || exit 2

# fire_one <prompt-json> → sets TASK_ID, or returns the e2e-run exit code (3 unreachable, 4 busy…)
fire_one() {
  local pj=$1 args=() out
  args=(fire "$(jq -r '.prompt' <<<"$pj")" --mode "$(jq -r '.mode' <<<"$pj")")
  local proj wf
  proj=$(jq -r '.project // empty' <<<"$pj"); wf=$(jq -r '.workflow // empty' <<<"$pj")
  [ -n "$proj" ] && args+=(--project "$proj")
  [ -n "$wf" ] && args+=(--workflow "$wf")
  out=$("$E2E" "${args[@]}") || return $?
  TASK_ID=$(jq -r '.taskId' <<<"$out")
  [ -n "$TASK_ID" ] && [ "$TASK_ID" != null ]
}

# wait_one <taskId> — re-invokes e2e-run wait on its clean timeout (exit 5) up to MAX_WAIT_ROUNDS.
wait_one() {
  local id=$1 round=0 rc
  while :; do
    "$E2E" wait "$id" --timeout-min "$TIMEOUT_MIN"; rc=$?
    [ "$rc" = 5 ] || return $rc
    round=$((round + 1))
    if [ "$round" -ge "$MAX_WAIT_ROUNDS" ]; then
      echo "⏱ task $id vẫn chạy sau $((TIMEOUT_MIN * MAX_WAIT_ROUNDS)) phút — coi như treo, dừng đợt" >&2
      return 1
    fi
  done
}

while :; do
  PJ=$("$PY" "$CAMPAIGN" next "$CDIR"); NEXT_RC=$?
  if [ "$NEXT_RC" = 3 ]; then echo "🏁 campaign settled — mọi đề đã chạy"; exit 0; fi
  [ "$NEXT_RC" = 0 ] || exit 2
  FILE=$(jq -r '.file' <<<"$PJ"); ATTEMPT=$(jq -r '.attempt' <<<"$PJ")
  echo "▶ $FILE (attempt $ATTEMPT)"

  # Capture the exit code DIRECTLY — `if ! fire_one` would run the `!` negation and leave $? as 0,
  # so the busy-lock branch below became dead code and every 409 stopped the whole run instead of
  # waiting (found live: round-5 hit a lock held by another build and aborted with "exit 0"). The
  # stub-backed drills never exercised a real 409, so they missed it.
  fire_one "$PJ"; RC=$?
  if [ "$RC" != 0 ]; then
    # 4 = turn lock busy (another build mid-flight — e.g. a manual one): wait one round and retry
    # the SAME prompt; anything else (3 unreachable, 6 API) is fatal for the run.
    if [ "$RC" = 4 ]; then echo "🔒 turn busy — chờ ${CAMPAIGN_BUSY_WAIT:-120}s"; sleep "${CAMPAIGN_BUSY_WAIT:-120}"; continue; fi
    echo "❌ fire lỗi (exit $RC) — dừng đợt" >&2; exit "$RC"
  fi
  echo "  task $TASK_ID"

  wait_one "$TASK_ID" || { echo "❌ wait bất thường — dừng đợt" >&2; exit 1; }
  "$PY" "$CAMPAIGN" record "$CDIR" "$FILE" --task-id "$TASK_ID" || exit 2

  # Double-error stop: if this entry now sits at status=error with 2 attempts, halt the campaign.
  ERRS=$("$PY" - "$CDIR" "$FILE" <<'EOF'
import sys, yaml, pathlib
d = yaml.safe_load((pathlib.Path(sys.argv[1]) / "campaign.yml").read_text())
p = next(x for x in d["prompts"] if x["file"] == sys.argv[2])
print(f"{p['status']} {len(p.get('task_ids', []))}")
EOF
)
  STATUS=${ERRS% *}; ATTEMPTS=${ERRS#* }
  if [ "$STATUS" = error ]; then
    if [ "$ATTEMPTS" -ge 2 ]; then
      echo "🛑 $FILE lỗi 2 lần liên tiếp — DỪNG CẢ ĐỢT (nghi quota/hạ tầng; các đề còn lại giữ pending)." >&2
      echo "   Chạy lại chính script này để resume sau khi nguyên nhân được xử lý." >&2
      exit 1
    fi
    # first error → flip back to pending so `next` re-serves it exactly once
    "$PY" - "$CDIR" "$FILE" <<'EOF'
import sys, yaml, pathlib
mf = pathlib.Path(sys.argv[1]) / "campaign.yml"
d = yaml.safe_load(mf.read_text())
p = next(x for x in d["prompts"] if x["file"] == sys.argv[2])
p["status"] = "pending"
mf.write_text(yaml.safe_dump(d, allow_unicode=True, sort_keys=False), encoding="utf-8")
EOF
    echo "↻ $FILE lỗi lần 1 — retry một lần"
  fi
done

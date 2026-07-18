#!/usr/bin/env bash
# e2e-run.sh — spec 058: simulate a real user session against the Builder API.
#
# Subcommands (each invocation is ONE idempotent step — no daemon):
#   fire "<requirement>" [--mode auto|each_step] [--fast] [--deploy none|selfhost|cloud] [--project <p>] [--workflow <w>]
#   fire --entry <suite-id>            # prompt + parameters read from e2e-suite.yml
#   wait <taskId> [--timeout-min 20]   # poll until settled; timeout exits CLEANLY (code 5, re-invokable)
#   confirm <taskId> [actionId]        # no arg → auto-picks ONLY 'continue' (never accept/discard)
#   reply <taskId> "<feedback>"
#   check <taskId> --expect <suite-id> [--suite <path>] [--save-baseline]  # OFFLINE; cost gate (060)
#   time <taskId>                      # OFFLINE per-phase + total wall-clock (before/after speed fix)
#   userview <taskId>                  # OFFLINE user-facing text only (digest+notes), hide dev-view (063)
#   comprehension <taskId>             # OFFLINE deterministic jargon check over the user-facing text (063)
#   bench "<prompt>" | bench --entry <id>  # fire → wait → timing + check, one command one number
#   suite                              # list suite entry ids
#
# Exit codes: 0 ok · 1 check auto-fail · 2 usage · 3 backend unreachable · 4 turn busy (409)
#             5 wait timeout (still running — re-invoke wait) · 6 API error
#
# Prereqs: backend running (cd apps/builder && npm start), `claude` logged in, `jq` on PATH.
# COST: every build spends 2–4 REAL claude subscription turns (minutes each).
set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
BASE="${BUILDER_BASE:-http://127.0.0.1:4123}"
SUITE="${E2E_SUITE:-$SCRIPT_DIR/e2e-suite.yml}"
HTTP_CODE=""; RESP=""   # set by api(); read by callers (see api note below)
PY="$ROOT/.venv/bin/python"; [ -x "$PY" ] || PY=python3

command -v jq >/dev/null || { echo "FATAL: jq is required" >&2; exit 2; }

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; }

# api <method> <path> [json] — body on stdout; HTTP code in $HTTP_CODE; exit 3 when unreachable.
api() {
  local m=$1 p=$2 d=${3:-} out
  # Origin header is REQUIRED on mutations (spec 015 D6 local-CSRF defense — index.ts:122); $BASE
  # equals the allowlisted http://127.0.0.1:<port>. Harmless on GET.
  if [ -n "$d" ]; then
    out=$(curl -sS -m 60 -X "$m" "$BASE$p" -H 'content-type: application/json' -H "Origin: $BASE" -d "$d" -w $'\n%{http_code}' 2>/dev/null)
  else
    out=$(curl -sS -m 60 -X "$m" "$BASE$p" -H "Origin: $BASE" -w $'\n%{http_code}' 2>/dev/null)
  fi
  if [ -z "$out" ]; then
    echo "backend not reachable at $BASE — start it: cd apps/builder && npm start" >&2
    exit 3
  fi
  # Set globals (NOT via command substitution — a subshell assignment would be lost). Callers read
  # $RESP + $HTTP_CODE after `api ...` returns.
  HTTP_CODE=${out##*$'\n'}
  RESP=${out%$'\n'*}
}

summary() { jq '{taskId,phase,status,error:(.error//null),gate:{flag:(.gate.flag//null),actions:[.gate.actions[]?.id]},artifacts:(.artifacts//null)}' <<<"$1"; }

# need_val <remaining-argc> <flag> — clean usage() (exit 2) when a value-taking flag has no value,
# instead of a cryptic `$2: unbound variable` abort under set -u.
need_val() { [ "$1" -ge 2 ] || { echo "flag '$2' requires a value" >&2; usage; }; }

cmd_fire() {
  local req="" mode=auto fast=false deploy=none project="" workflow="" entry=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --entry)   need_val "$#" "$1"; entry=$2; shift 2 ;;
      --mode)    need_val "$#" "$1"; mode=$2; shift 2 ;;
      --fast)    fast=true; shift ;;
      --deploy)  need_val "$#" "$1"; deploy=$2; shift 2 ;;
      --project) need_val "$#" "$1"; project=$2; shift 2 ;;
      # --workflow = the EDIT-EXISTING seam. Without it the harness could only ever fire from-scratch
      # builds: a "add a feature to the flow you made before" prompt silently built a NEW workflow
      # (run 1784380636506 — task.workflow was null while the digest said "Extend an existing
      # workflow"), so the edit path had no e2e coverage at all. Pairs with --project.
      --workflow) need_val "$#" "$1"; workflow=$2; shift 2 ;;
      -*) echo "unknown flag $1" >&2; usage ;;
      *)  req=$1; shift ;;
    esac
  done
  if [ -n "$entry" ]; then
    local fp
    fp=$("$PY" "$SCRIPT_DIR/e2e_check.py" --suite "$SUITE" --entry "$entry" --emit-fire) || exit 2
    req=$(jq -r '.prompt' <<<"$fp"); mode=$(jq -r '.mode' <<<"$fp")
    deploy=$(jq -r '.deploy' <<<"$fp")
    [ "$(jq -r '.fast' <<<"$fp")" = true ] && fast=true
    project=$(jq -r '.project // empty' <<<"$fp")
    workflow=$(jq -r '.workflow // empty' <<<"$fp")   # suite entries may pin an edit-existing base
  fi
  [ -n "$req" ] || { echo "fire: requirement (or --entry) required" >&2; usage; }
  local cm=auto; [ "$mode" = each_step ] && cm="confirm each step"
  local body
  body=$(jq -nc --arg r "$req" --arg m "$cm" --arg d "$deploy" '{requirement:$r, confirm_mode:$m, deploy:$d}')
  [ "$fast" = true ] && body=$(jq -c '. + {fast_mode:true}' <<<"$body")
  [ -n "$project" ] && body=$(jq -c --arg p "$project" '. + {project:$p}' <<<"$body")
  [ -n "$workflow" ] && body=$(jq -c --arg w "$workflow" '. + {workflow:$w}' <<<"$body")
  api POST /api/tasks "$body"; local resp="$RESP"
  if [ "$HTTP_CODE" = 409 ]; then
    echo "turn lock BUSY — holder: $(jq -r '.holder // "?"' <<<"$resp") (wait for it or cancel it)" >&2
    exit 4
  fi
  [ "$HTTP_CODE" = 200 ] || { echo "POST /api/tasks → HTTP $HTTP_CODE: $resp" >&2; exit 6; }
  jq '{taskId,phase,status}' <<<"$resp"
}

cmd_wait() {
  local id=${1:-}; shift || true
  [ -n "$id" ] || { echo "wait: taskId required" >&2; usage; }
  local timeout_min=20
  if [ "${1:-}" = "--timeout-min" ]; then need_val "$#" "$1"; timeout_min=$2; fi
  local deadline=$(( $(date +%s) + timeout_min * 60 )) last="" resp status phase
  while :; do
    api GET "/api/tasks/$id"; resp="$RESP"
    [ "$HTTP_CODE" = 200 ] || { echo "GET /api/tasks/$id → HTTP $HTTP_CODE" >&2; exit 6; }
    status=$(jq -r '.status' <<<"$resp"); phase=$(jq -r '.phase' <<<"$resp")
    if [ "$phase/$status" != "$last" ]; then echo "  → $phase/$status" >&2; last="$phase/$status"; fi
    case "$status" in
      awaiting_confirm|error|done|cancelled)
        summary "$resp"
        if [ "$status" = error ]; then
          echo "TRIAGE (spec 045, verbatim): $(jq -r '.error // "?"' <<<"$resp")" >&2
        fi
        return 0 ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "wait: timeout after ${timeout_min}min — still $phase/$status (NOT an error; re-invoke: e2e-run.sh wait $id)" >&2
      exit 5
    fi
    sleep 5
  done
}

cmd_confirm() {
  local id=${1:-} action=${2:-}
  [ -n "$id" ] || { echo "confirm: taskId required" >&2; usage; }
  if [ -z "$action" ]; then
    api GET "/api/tasks/$id"; local resp="$RESP"
    [ "$HTTP_CODE" = 200 ] || { echo "GET /api/tasks/$id → HTTP $HTTP_CODE" >&2; exit 6; }
    # Safety: auto-pick ONLY the plain advance. Anything else (accept a lint failure, discard,
    # cleanup) is a human/judgment call — require it explicitly.
    if jq -e '[.gate.actions[]?.id] | index("continue")' <<<"$resp" >/dev/null; then
      action=continue
    else
      echo "no 'continue' action at this gate — pick one explicitly: $(jq -c '[.gate.actions[]?.id]' <<<"$resp")" >&2
      exit 2
    fi
  fi
  api POST "/api/tasks/$id/confirm" "$(jq -nc --arg a "$action" '{actionId:$a}')"; local resp="$RESP"
  [ "$HTTP_CODE" = 200 ] || { echo "confirm → HTTP $HTTP_CODE: $resp" >&2; exit 6; }
  summary "$resp"
}

cmd_reply() {
  local id=${1:-} text=${2:-}
  [ -n "$id" ] && [ -n "$text" ] || { echo "reply: taskId + text required" >&2; usage; }
  api POST "/api/tasks/$id/reply" "$(jq -nc --arg t "$text" '{text:$t}')"; local resp="$RESP"
  [ "$HTTP_CODE" = 200 ] || { echo "reply → HTTP $HTTP_CODE: $resp" >&2; exit 6; }
  summary "$resp"
}

cmd_time() {
  # Post-hoc timing from a completed run — OFFLINE, no polling. taskId = fire time (ms); each
  # artifact mtime = that phase's completion. Repeatable → use it to compare before/after a speed fix.
  local id=${1:-}
  [ -n "$id" ] || { echo "time: taskId required" >&2; usage; }
  local tj="$ROOT/apps/builder/.runs/$id/task.json"
  [ -f "$tj" ] || { echo "time: no $tj — wrong taskId or run pruned" >&2; exit 6; }
  local a s w r args=(--timing --taskid "$id" --task-json "$tj")  # --task-json → spec-059 cost table
  [ "$(jq -r '.fastMode // false' "$tj")" = true ] && args+=(--fast)  # ⚡ merge analyze+spec
  a=$(jq -r '.artifacts.analyze   // empty' "$tj")
  s=$(jq -r '.artifacts.spec      // empty' "$tj")
  w=$(jq -r '.artifacts.implement // empty' "$tj")
  r=$(jq -r '.artifacts.report    // empty' "$tj")
  [ -n "$a" ] && args+=(--analyze   "$ROOT/$a")
  [ -n "$s" ] && args+=(--spec-path "$ROOT/$s")
  [ -n "$w" ] && args+=(--workflow  "$ROOT/$w")
  [ -n "$r" ] && args+=(--report    "$ROOT/$r")
  exec "$PY" "$SCRIPT_DIR/e2e_check.py" "${args[@]}"
}

# spec 063 — user-facing text only (userview) / deterministic jargon check (comprehension). OFFLINE.
cmd_uv() {   # <mode-flag> <taskId>
  local mode=$1 id=${2:-}
  [ -n "$id" ] || { echo "${mode#--}: taskId required" >&2; usage; }
  local tj="$ROOT/apps/builder/.runs/$id/task.json"
  [ -f "$tj" ] || { echo "${mode#--}: no $tj — wrong taskId or run pruned" >&2; exit 6; }
  local a r args=("$mode")
  a=$(jq -r '.artifacts.analyze // empty' "$tj"); r=$(jq -r '.artifacts.report // empty' "$tj")
  [ -n "$a" ] && args+=(--analyze "$ROOT/$a")
  [ -n "$r" ] && args+=(--report  "$ROOT/$r")
  "$PY" "$SCRIPT_DIR/e2e_check.py" "${args[@]}"
}

cmd_bench() {
  # One command → fire (auto) → wait → [check, for --entry] → timing + cost table. For the
  # before/after speed-comparison workflow. Accepts a raw prompt OR --entry <suite-id>. With
  # --entry it ALSO runs the 3-bucket + cost `check` (spec 060); a raw prompt has no entry to check
  # against, so it prints PERFORMANCE only (timing + cost).
  local entry="" i
  local a=("$@")
  for ((i=0; i<${#a[@]}; i++)); do [ "${a[i]}" = "--entry" ] && entry="${a[i+1]:-}"; done
  local out id
  out=$(cmd_fire "$@") || { local rc=$?; echo "$out" >&2; exit "$rc"; }  # keep fire's exit code
  id=$(jq -r '.taskId' <<<"$out")
  echo "fired $id — waiting..." >&2
  # Subshell so cmd_wait's `exit 5` (timeout) / `exit 6` can't abort bench — we still want timing.
  ( cmd_wait "$id" ) >/dev/null 2>&1 || true
  local status; status=$(jq -r '.status' "$ROOT/apps/builder/.runs/$id/task.json" 2>/dev/null)
  echo "=== run $id (status=$status) ==="
  # Subshell + || true so a check auto-fail (or its exit paths) never aborts the timing display.
  [ -n "$entry" ] && { ( cmd_check "$id" --expect "$entry" ) || true; echo; }
  cmd_time "$id"
}

cmd_cancel() {
  local id=${1:-}
  [ -n "$id" ] || { echo "cancel: taskId required" >&2; usage; }
  api POST "/api/tasks/$id/cancel" '{}'; local resp="$RESP"
  [ "$HTTP_CODE" = 200 ] || { echo "cancel → HTTP $HTTP_CODE: $resp" >&2; exit 6; }
  summary "$resp"
}

cmd_check() {
  local id=${1:-}; shift || true
  local expect="" suite="$SUITE" save_baseline=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --expect)        need_val "$#" "$1"; expect=$2; shift 2 ;;
      --suite)         need_val "$#" "$1"; suite=$2; shift 2 ;;
      --save-baseline) save_baseline=1; shift ;;   # spec 060: record this run's cost profile
      *) echo "unknown flag $1" >&2; usage ;;
    esac
  done
  [ -n "$id" ] && [ -n "$expect" ] || { echo "check: taskId + --expect required" >&2; usage; }
  # OFFLINE by design — task.json.artifacts is server-authoritative and survives a backend stop.
  local tj="$ROOT/apps/builder/.runs/$id/task.json"
  [ -f "$tj" ] || { echo "check: no $tj — wrong taskId or run pruned" >&2; exit 6; }
  local a w r
  local args=(--suite "$suite" --entry "$expect" --task-json "$tj" --baselines "$SCRIPT_DIR/e2e-baselines.json")
  [ "$(jq -r '.fastMode // false' "$tj")" = true ] && args+=(--fast)   # spec 060 expected-phase set
  [ -n "$save_baseline" ] && args+=(--save-baseline)
  a=$(jq -r '.artifacts.analyze   // empty' "$tj")
  w=$(jq -r '.artifacts.implement // empty' "$tj")
  r=$(jq -r '.artifacts.report    // empty' "$tj")
  [ -n "$a" ] && args+=(--analyze  "$ROOT/$a")
  [ -n "$w" ] && args+=(--workflow "$ROOT/$w")
  [ -n "$r" ] && args+=(--report   "$ROOT/$r")
  # NOT exec — so a caller (cmd_bench) can continue to cmd_time after this. Standalone `check`
  # still propagates e2e_check.py's exit code (0 ok / 1 auto-fail / 2 usage) as the function return.
  "$PY" "$SCRIPT_DIR/e2e_check.py" "${args[@]}"
}

case "${1:-}" in
  fire)    shift; cmd_fire "$@" ;;
  wait)    shift; cmd_wait "$@" ;;
  confirm) shift; cmd_confirm "$@" ;;
  reply)   shift; cmd_reply "$@" ;;
  cancel)  shift; cmd_cancel "$@" ;;
  time)    shift; cmd_time "$@" ;;
  bench)   shift; cmd_bench "$@" ;;
  userview)      shift; cmd_uv --userview "$@" ;;
  comprehension) shift; cmd_uv --comprehension "$@" ;;
  check)   shift; cmd_check "$@" ;;
  suite)   exec "$PY" "$SCRIPT_DIR/e2e_check.py" --suite "$SUITE" --list ;;
  *) usage ;;
esac

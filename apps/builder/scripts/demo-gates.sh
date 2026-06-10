#!/usr/bin/env bash
# demo-gates.sh — curl through every Lát 3 gate (spec 009). Drives the REAL backend on localhost.
#
# Prereqs:
#   - `claude auth login` done (turns spawn the user's subscription, model C).
#   - Backend running:  cd apps/builder && npm run dev    (or: npm run build && npm start)
#   - `jq` on PATH (pretty JSON + field extraction).
#
# Usage:
#   ./scripts/demo-gates.sh all        # guided run of every scenario (spawns REAL turns — minutes each)
#   ./scripts/demo-gates.sh s1         # one scenario (s1..s7)
#   ./scripts/demo-gates.sh validate   # cheap checks only (400/404/409) — NO turns spawned
#
# Each ①②③ phase is a real `claude` turn (~1–2 min). ④ is backend (instant). Be patient at gates.
set -uo pipefail

BASE="${BUILDER_BASE:-http://127.0.0.1:4123}"
command -v jq >/dev/null || { echo "FATAL: jq is required"; exit 1; }

# ── helpers ──────────────────────────────────────────────────────────────────
hr()   { printf '\n\033[1;36m── %s ─────────────────────────────────────\033[0m\n' "$*"; }
note() { printf '\033[0;33m   %s\033[0m\n' "$*"; }
post() { curl -fsS -X POST "$BASE$1" -H 'content-type: application/json' -d "${2:-{}}"; }
# post_code <path> <json> → prints the HTTP status code only (for negative tests)
post_code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE$1" -H 'content-type: application/json' -d "${2:-{}}"; }
get()  { curl -fsS "$BASE$1"; }
field(){ jq -r "$2" <<<"$1"; }       # field "$json" '.status'
show() { jq '{taskId,phase,status,slug,name,flag:.gate.flag,actions:[.gate.actions[]?.id]}' <<<"$1"; }

start_build() { # <requirement> <confirm_mode> [extra-json-fields]
  local req="$1" mode="$2" extra="${3:-}"
  local body
  body=$(jq -nc --arg r "$req" --arg m "$mode" '{requirement:$r, confirm_mode:$m, deploy:"none"}')
  [ -n "$extra" ] && body=$(jq -c ". + $extra" <<<"$body")
  post /api/tasks "$body"
}

# ── validate: cheap negative checks, NO turns ────────────────────────────────
validate() {
  hr "validate (cheap — no turns spawned)"
  note "GET /health"; get /health | jq .
  note "POST /api/tasks with no requirement → expect 400"
  echo "  got HTTP $(post_code /api/tasks '{}')"
  note "GET /api/tasks/does-not-exist → expect 404"
  echo "  got HTTP $(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tasks/nope")"
  note "POST /api/tasks/nope/confirm with no actionId → expect 400"
  echo "  got HTTP $(post_code /api/tasks/nope/confirm '{}')"
}

# ── s1: each_step pauses at EVERY boundary; /confirm advances (AC #6, #15, #18) ──
s1() {
  hr "S1 — each_step pauses at ①②③, /confirm advances (AC #6/#15/#18)"
  local t id g
  t=$(start_build "Build a workflow that takes a topic string and returns a 3-sentence summary." "confirm each step")
  id=$(field "$t" '.taskId'); show "$t"
  note "expect: awaiting_confirm @ analyze"

  t=$(post "/api/tasks/$id/confirm" '{"actionId":"continue"}'); show "$t"
  note "expect: awaiting_confirm @ spec"

  # Closing Spec carries a user-edited slug/name → scaffold fires here (AC #18).
  t=$(post "/api/tasks/$id/confirm" '{"actionId":"continue","slug":"topic_summary_demo","name":"Topic Summary Demo"}'); show "$t"
  note "expect: awaiting_confirm @ implement (clean), slug=topic_summary_demo, projects/topic_summary_demo/ scaffolded"

  t=$(post "/api/tasks/$id/confirm" '{"actionId":"continue"}'); show "$t"
  note "expect: status=done (④ backend report, deploy=none). report.json written."
  get "/api/tasks/$id" | jq '.artifacts'
}

# ── s2: /reply revises Spec WITHOUT advancing (AC #7) ────────────────────────
s2() {
  hr "S2 — /reply revises Spec without advancing (AC #7)"
  local t id
  t=$(start_build "Summarize a topic string into 3 sentences." "confirm each step")
  id=$(field "$t" '.taskId')
  t=$(post "/api/tasks/$id/confirm" '{"actionId":"continue"}')   # → spec
  note "at: $(field "$t" '.status') @ $(field "$t" '.phase')"
  t=$(post "/api/tasks/$id/reply" '{"text":"Add a Japanese-translation step after the summary."}')
  show "$t"
  note "expect: STILL awaiting_confirm @ spec (no advance); SPEC.md revised in place"
}

# ── s3: Implement self-corrects a fixable error in ≤5, still STOPS (AC #8/#20) ──
s3() {
  hr "S3 — Implement validate→fix self-corrects, then still stops (AC #8/#20)"
  note "The cap-5 validate→fix loop runs INSIDE the single Implement turn (implement.md); the"
  note "backend re-runs the 3 linters ONCE to pick the gate variant. A clean result → awaiting_confirm"
  note "@ implement with [continue,changes]. (Forcing a *fixable* seed deterministically needs the"
  note "Lát-5 seed picker; with a plain requirement the agent usually emits clean YAML directly.)"
  local t id
  t=$(start_build "Workflow: one code node that echoes its input string field." "auto")
  id=$(field "$t" '.taskId'); show "$t"
  note "auto runs ①②③ then stops at the implement gate (clean) or done at ④; inspect:"
  get "/api/tasks/$id" | jq '{phase,status,flag:.gate.flag,lint:.artifacts}'
}

# ── s4: still-failing cap-5 hard-stop; auto does NOT reach ④ (AC #20/#25) ─────
s4() {
  hr "S4 — still-failing gate; auto hard-stops, never imports lint≠0 (AC #20/#25)"
  note "A still-failing result (cap-5, lint≠0 but file present+parseable) → awaiting_confirm @"
  note "implement with gate.flag=still_failing + actions [accept,keep,abandon]. In 'auto' the build"
  note "HARD-STOPS here (does NOT advance to ④). Deterministically forcing lint≠0 after 5 agent"
  note "passes needs a crafted seed (Lát 5); the state-machine path is unit-verified (computeGate +"
  note "maybeAutoAdvance still_failing hard-stop). Manual override to ④:"
  note '  curl -XPOST $BASE/api/tasks/<id>/confirm -d {"actionId":"accept"}   # human-only; report notes accepted_lint_failure'
  note '  curl -XPOST $BASE/api/tasks/<id>/reply   -d {"text":"keep trying"}  # another implement attempt'
  note '  curl -XPOST $BASE/api/tasks/<id>/cancel                            # Abandon → cancelled + lock freed'
}

# ── s5: 409 on a 2nd build while one holds the lock (AC #21) ──────────────────
s5() {
  hr "S5 — 409 while a build holds the lock, even paused at a gate (AC #21)"
  local t id code
  t=$(start_build "Summarize a topic into three sentences." "confirm each step")
  id=$(field "$t" '.taskId')
  note "build #1 is awaiting_confirm @ $(field "$t" '.phase') — it HOLDS the lock"
  code=$(post_code /api/tasks "$(jq -nc '{requirement:"second build", confirm_mode:"auto"}')")
  echo "  2nd POST /api/tasks → HTTP $code   (expect 409)"
  note "leaving build #1 at its gate (cancel it in S6 to free the lock)"
  echo "$id" > /tmp/lat3_s5_id
}

# ── s6: cancel frees the lock → a new build succeeds (AC #24) ─────────────────
s6() {
  hr "S6 — cancel frees the lock; new build succeeds (AC #24)"
  local id t code
  id=$(cat /tmp/lat3_s5_id 2>/dev/null || true)
  if [ -z "$id" ]; then note "run S5 first (need a build holding the lock)"; return; fi
  t=$(post "/api/tasks/$id/cancel"); show "$t"
  note "expect: status=cancelled"
  code=$(post_code /api/tasks "$(jq -nc '{requirement:"now the lock is free", confirm_mode:"confirm each step"}')")
  echo "  new POST /api/tasks → HTTP $code   (expect 200)"
}

# ── s7: boot reconcile — kill mid-running, restart → error + lock cleared (AC #19/#24) ──
s7() {
  hr "S7 — boot reconcile (AC #19/#24) — MANUAL steps"
  note "1) start a build:  curl -XPOST \$BASE/api/tasks -d '{\"requirement\":\"...\",\"confirm_mode\":\"auto\"}'"
  note "2) while it is 'running' (a turn is live), KILL the server (Ctrl-C / kill the npm process)"
  note "3) restart: cd apps/builder && npm run dev"
  note "4) GET /api/tasks/<id> → status:error ('interrupted by backend restart — phase re-runnable')"
  note "   and a fresh POST /api/tasks succeeds (lock cleared on boot). reconcileOnBoot runs at startup."
}

case "${1:-all}" in
  validate) validate ;;
  s1) s1 ;; s2) s2 ;; s3) s3 ;; s4) s4 ;; s5) s5 ;; s6) s6 ;; s7) s7 ;;
  all) validate; s1; s2; s3; s4; s5; s6; s7 ;;
  *) echo "usage: $0 {validate|s1|s2|s3|s4|s5|s6|s7|all}"; exit 2 ;;
esac

#!/bin/bash
# 23-smoke-test.command
# Phase F — quick smoke test against a deployed backend.
#
# Prompts for the backend URL (defaulting to localhost:3001 for local runs,
# or pass it as $1 for non-interactive). Curls every endpoint the frontend
# actually uses and summarizes the result.
#
# Usage:
#   ./23-smoke-test.command                              # prompts
#   ./23-smoke-test.command https://xxx.up.railway.app   # non-interactive

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/23-smoke-test.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }

BASE="${1:-}"
if [[ -z "$BASE" ]]; then
  echo ""
  read -r -p "Backend base URL (default http://localhost:3001): " BASE
  BASE="${BASE:-http://localhost:3001}"
fi
BASE="${BASE%/}"  # strip trailing slash

log "=== 23-smoke-test.command ==="
log "Started: $(date)"
log "Base:    $BASE"
log ""

PASS=0
FAIL=0

check() {
  local label="$1"
  local path="$2"
  local expected="$3"   # substring to grep in response body
  local url="$BASE$path"

  log "────────────────────────────────────────────────────────────────"
  log "► $label"
  log "  GET $url"

  # Capture status + body separately
  local status body tmp
  tmp="$(mktemp)"
  status=$(curl -sS -o "$tmp" -w "%{http_code}" --max-time 15 "$url" 2>>"$LOG" || echo "000")
  body="$(cat "$tmp")"
  rm -f "$tmp"

  log "  status: $status"
  # Log body but trim long ones
  local short
  short="$(echo "$body" | head -c 400)"
  log "  body:   $short"
  [[ ${#body} -gt 400 ]] && log "          … (${#body} chars total)"

  if [[ "$status" == "200" ]] && echo "$body" | grep -q "$expected"; then
    log "  ✅ OK  (found '$expected')"
    PASS=$((PASS+1))
  else
    log "  ❌ FAIL (expected '$expected' in 200 response)"
    FAIL=$((FAIL+1))
  fi
}

# Sanity endpoints — frontend hits each of these
check "health"            "/api/health"                   '"status"'
check "bundles"           "/api/bundles"                  '"id"\|\[\]'
check "markets"           "/api/markets"                  '"data"\|"id"\|\[\]'
check "onchain status"    "/api/onchain/status"           '"configured"\|"programId"\|"rpcUrl"'
check "demo status"       "/api/demo/status"              '"status"\|"active"\|"bundles"'

# Optional but nice: verify CORS is permissive enough for the Vercel frontend
log ""
log "────────────────────────────────────────────────────────────────"
log "► CORS preflight (OPTIONS /api/health from https://senthos.vercel.app)"
CORS_HDR=$(curl -sS -X OPTIONS -H "Origin: https://senthos.vercel.app" \
              -H "Access-Control-Request-Method: GET" \
              -D - -o /dev/null --max-time 10 "$BASE/api/health" 2>>"$LOG" \
              | grep -i "access-control-allow-origin" || true)
log "  $CORS_HDR"
if [[ -n "$CORS_HDR" ]]; then
  log "  ✅ CORS header present"
  PASS=$((PASS+1))
else
  log "  ⚠️  No CORS header — frontend may be blocked"
  FAIL=$((FAIL+1))
fi

log ""
log "================================================================"
log "  Smoke-test summary: $PASS pass / $FAIL fail"
log "================================================================"
log "Finished: $(date)"

echo ""
if [[ $FAIL -eq 0 ]]; then
  echo "✅ All endpoints healthy at $BASE"
else
  echo "⚠️  $FAIL check(s) failed. See .logs/23-smoke-test.log for details."
fi
echo ""
# Only prompt if run interactively (no URL arg)
if [[ -z "${1:-}" ]]; then
  read -r -p "Press ENTER to close this window..."
fi

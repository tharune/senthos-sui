#!/bin/bash
# 32-install-and-smoketest.command
#
# Installs the new @solana/web3.js root dependency (needed for the Phantom
# wallet integration in app/app/_lib/wallet.tsx), runs a Next.js typecheck,
# starts the backend in the background, and hits every endpoint the UI
# relies on to confirm things are healthy.
#
# Writes a human-readable report to .logs/32-smoke.txt so the sandbox can
# verify the run. Safe to re-run.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
OUT=".logs/32-smoke.txt"
: > "$OUT"

log() { echo "$@" | tee -a "$OUT"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

BACKEND_PORT="${PORT:-3001}"
BACKEND_URL="http://localhost:$BACKEND_PORT"

banner "32-install-and-smoketest"

# ----- Step 1: npm install at root (picks up @solana/web3.js) -----

log ""
log "=== npm install at repo root ==="
if ! command -v npm >/dev/null 2>&1; then
  log "❌ npm not on PATH. Install Node first."
  read -r -p "Press ENTER to close..."
  exit 1
fi
npm install 2>&1 | tail -40 | tee -a "$OUT"

log ""
log "=== npm install in backend/ ==="
(cd backend && npm install 2>&1 | tail -40) | tee -a "$OUT"

# ----- Step 2: Next.js typecheck (just a build-type pass) -----

banner "typecheck"
log ""
log "Running: npx tsc --noEmit (tsconfig.json is noEmit=true anyway)"
npx tsc --noEmit 2>&1 | tee -a "$OUT"
TC_RC=${PIPESTATUS[0]}
if [[ $TC_RC -ne 0 ]]; then
  log ""
  log "⚠️  tsc reported errors. Continuing to smoke-test but review above."
fi

# ----- Step 3: kill anything on backend port, then boot -----

banner "backend smoke test"
log ""
log "Killing anything already bound to :$BACKEND_PORT..."
# `lsof -nP -iTCP:$BACKEND_PORT` returns PIDs; kill them.
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -nP -iTCP:$BACKEND_PORT -sTCP:LISTEN -t 2>/dev/null || true)
  if [[ -n "$PIDS" ]]; then
    log "  killing: $PIDS"
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

log ""
log "Starting backend in background (log: .logs/32-backend.log)..."
(cd backend && npm run dev >../.logs/32-backend.log 2>&1) &
BACKEND_PID=$!
log "  PID: $BACKEND_PID"

# Wait up to 30s for /api/health
log ""
log "Waiting for $BACKEND_URL/api/health ..."
READY=0
for i in $(seq 1 30); do
  if curl -s --max-time 2 "$BACKEND_URL/api/health" >/dev/null 2>&1; then
    READY=1
    log "  ready after ${i}s"
    break
  fi
  sleep 1
done

if [[ $READY -eq 0 ]]; then
  log ""
  log "❌ backend didn't become ready in 30s. See .logs/32-backend.log:"
  tail -40 .logs/32-backend.log 2>&1 | tee -a "$OUT"
  kill -9 $BACKEND_PID 2>/dev/null || true
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ----- Step 4: hit the endpoints the UI depends on -----

hit() {
  local path="$1"
  log ""
  log "=== GET $path ==="
  curl -s --max-time 10 "$BACKEND_URL$path" 2>&1 | head -40 | tee -a "$OUT"
}

hit "/api/health"
hit "/api/onchain/status"
hit "/api/bundles"
hit "/api/markets/curated?limit=3"

# Stop the backend now that we've captured the snapshot
log ""
log "Stopping backend (PID $BACKEND_PID)..."
kill $BACKEND_PID 2>/dev/null || true
sleep 1
kill -9 $BACKEND_PID 2>/dev/null || true

# ----- Step 5: summary -----

banner "summary"
log ""
log "backend/.env program IDs:"
grep -E '^TRAXIS_VAULT_PROGRAM_ID=|^TRAXIS_PPN_PROGRAM_ID=|^SOLANA_RPC_URL=|^USDC_MINT=' backend/.env 2>&1 | tee -a "$OUT"

log ""
log "Frontend deps installed in node_modules:"
for pkg in @solana/web3.js next react; do
  if [[ -d "node_modules/$pkg" ]]; then
    v=$(node -e "console.log(require('$pkg/package.json').version)" 2>/dev/null || echo "?")
    log "  ✅ $pkg @ $v"
  else
    log "  ❌ $pkg missing"
  fi
done

log ""
log "DONE. Full log: $OUT"
log "Backend log:    .logs/32-backend.log"
log ""
log "Next: double-click DO-NEXT.command to:"
log "  1. Start backend in one terminal (cd backend && npm run dev)"
log "  2. Start frontend in another (npm run dev)"
log "  3. Open http://localhost:3000/app/basket, pick LK-90-0430 or LK-70-0515,"
log "     connect Phantom (devnet, funded wallet), and click Deposit."
log ""
read -r -p "Press ENTER to close..."

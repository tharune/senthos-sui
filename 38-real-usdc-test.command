#!/bin/bash
# 38-real-usdc-test.command
# Runs backend/test-real-usdc.cjs on the Mac: actually signs with the
# authority keypair and sends USDC on devnet. Proves on-chain movement
# end-to-end with a Solscan URL you can click.
set -u

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/backend" || { echo "❌ backend dir missing"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/38-real-usdc-test.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "38 — REAL USDC devnet test"

# --- Pre-flight: .env + keypair + deps ---
if [ ! -f ".env" ]; then
  log "❌ backend/.env missing — run an earlier setup .command first."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# shellcheck disable=SC2046
export $(grep -E '^[A-Z_]+=' .env | xargs -I{} echo {})

if [ -z "${AUTHORITY_KEYPAIR:-}" ]; then
  log "❌ AUTHORITY_KEYPAIR missing from backend/.env"
  read -r -p "Press ENTER to close..."
  exit 1
fi

# Expand ~ if present
AUTH_PATH="${AUTHORITY_KEYPAIR/#\~/$HOME}"
if [ ! -f "$AUTH_PATH" ]; then
  log "❌ AUTHORITY_KEYPAIR not found at: $AUTH_PATH"
  log "   Edit backend/.env or run: solana-keygen new --outfile \$HOME/.config/solana/id.json"
  read -r -p "Press ENTER to close..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  log "Installing backend deps..."
  npm install 2>&1 | tee -a "$LOG"
fi

log ""
log "Running real-USDC test..."
log "Log will also stream to: $LOG"
log ""

node test-real-usdc.cjs 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}

log ""
if [ "$RC" -eq 0 ]; then
  banner "✅ REAL USDC TEST PASSED"
  log "Click the Solscan tx URL above to verify the USDC transfer on-chain."
elif [ "$RC" -eq 3 ]; then
  banner "⏸ AUTHORITY HAS NO USDC — fund it"
  log "Follow the instructions printed above (Circle faucet), then re-run this."
elif [ "$RC" -eq 2 ]; then
  banner "⏸ AUTHORITY HAS NO SOL — airdrop it"
  log "Follow the instructions printed above, then re-run this."
else
  banner "❌ REAL USDC TEST FAILED (rc=$RC)"
  log "Check the log above + backend/.env values."
fi

log ""
log "Full log: $LOG"
read -r -p "Press ENTER to close..."

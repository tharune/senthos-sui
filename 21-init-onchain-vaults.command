#!/bin/bash
# 21-init-onchain-vaults.command
# Phase C — bootstrap the on-chain state on Solana devnet.
#
# What this does:
#   1. Verifies solana CLI + devnet wallet exist and are funded.
#   2. Ensures the FEE_RECIPIENT's USDC Associated Token Account (ATA)
#      exists on devnet. The Traxis vault init CPI references this ATA;
#      without it, the first deposit fails.
#   3. Runs scripts/init-demo-vaults.ts — creates a vault PDA + TRAX mint
#      for every active bundle in Supabase (15 total after seeding).
#   4. Prints each bundle's vault_pda so we can sanity-check.
#
# Requires: Phase B (20-supabase-setup.command) to have run successfully
# so the bundles exist in Supabase.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/21-init-onchain-vaults.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

log "=== 21-init-onchain-vaults.command ==="
log "Started: $(date)"
log ""

# ---------- 1. Sanity checks ----------
echo ""
echo "================================================================"
echo "  STEP 1 — Pre-flight checks"
echo "================================================================"

if ! command -v solana >/dev/null 2>&1; then
  log "ERROR: solana CLI not found on PATH."
  log "       Run ./02-install-toolchain.command first."
  exit 1
fi
if ! command -v spl-token >/dev/null 2>&1; then
  log "ERROR: spl-token CLI not found. Install with:"
  log "       cargo install spl-token-cli"
  exit 1
fi

# Load env
if [[ ! -f backend/.env ]]; then
  log "ERROR: backend/.env missing."
  exit 1
fi
# shellcheck disable=SC1091
set -o allexport; source backend/.env; set +o allexport

: "${FEE_RECIPIENT:?FEE_RECIPIENT not set in backend/.env}"
: "${USDC_MINT:?USDC_MINT not set in backend/.env}"
: "${AUTHORITY_KEYPAIR:?AUTHORITY_KEYPAIR not set in backend/.env}"
: "${SOLANA_RPC_URL:?SOLANA_RPC_URL not set in backend/.env}"
: "${TRAXIS_VAULT_PROGRAM_ID:?TRAXIS_VAULT_PROGRAM_ID not set}"

if [[ ! -f "$AUTHORITY_KEYPAIR" ]]; then
  log "ERROR: AUTHORITY_KEYPAIR path does not exist: $AUTHORITY_KEYPAIR"
  exit 1
fi

log "FEE_RECIPIENT:           $FEE_RECIPIENT"
log "USDC_MINT:               $USDC_MINT"
log "TRAXIS_VAULT_PROGRAM_ID: $TRAXIS_VAULT_PROGRAM_ID"
log "SOLANA_RPC_URL:          $SOLANA_RPC_URL"

# Point solana CLI at devnet + the authority keypair
solana config set --url "$SOLANA_RPC_URL" --keypair "$AUTHORITY_KEYPAIR" 2>&1 | tee -a "$LOG"

AUTH_PUBKEY="$(solana-keygen pubkey "$AUTHORITY_KEYPAIR" 2>/dev/null)"
log "Authority pubkey: $AUTH_PUBKEY"

BAL_RAW="$(solana balance 2>&1 || true)"
log "Authority balance: $BAL_RAW"
# Extract SOL amount (format: "1.234 SOL")
BAL_SOL="$(echo "$BAL_RAW" | grep -oE '^[0-9]+(\.[0-9]+)?' | head -n1)"
if [[ -z "$BAL_SOL" ]]; then BAL_SOL=0; fi
# Require ~0.5 SOL minimum to cover all the rent-exempt mints + ATAs
NEED="0.5"
if awk "BEGIN{exit !($BAL_SOL < $NEED)}"; then
  log "WARN: authority has only $BAL_SOL SOL. Airdropping 2 SOL from devnet..."
  logcmd solana airdrop 2 || log "WARN: airdrop failed — retry manually with: solana airdrop 2"
fi

# ---------- 2. Ensure FEE_RECIPIENT USDC ATA ----------
echo ""
echo "================================================================"
echo "  STEP 2 — FEE_RECIPIENT USDC ATA"
echo "================================================================"

# Compute the expected ATA address
FEE_ATA="$(spl-token address --owner "$FEE_RECIPIENT" --token "$USDC_MINT" --verbose 2>&1 | grep -i 'Associated token' | awk -F': *' '{print $2}' | tr -d '[:space:]' || true)"

if [[ -z "$FEE_ATA" ]]; then
  # Fallback: let spl-token compute (newer CLIs print differently)
  FEE_ATA="$(spl-token address --owner "$FEE_RECIPIENT" --token "$USDC_MINT" 2>&1 | tail -n1 | tr -d '[:space:]')"
fi

log "Expected fee-recipient ATA: $FEE_ATA"

# Check existence
ATA_INFO="$(solana account "$FEE_ATA" 2>&1 || true)"
if echo "$ATA_INFO" | grep -q "AccountNotFound\|not found\|was not found"; then
  log "ATA does not exist — creating it..."
  # spl-token create-account uses current keypair as fee-payer and creates
  # the ATA owned by --owner.
  logcmd spl-token create-account "$USDC_MINT" --owner "$FEE_RECIPIENT" --fee-payer "$AUTHORITY_KEYPAIR"
  ATA_RC=$?
  if [[ $ATA_RC -ne 0 ]]; then
    log "ERROR: failed to create FEE_RECIPIENT USDC ATA. See log above."
    exit 1
  fi
else
  log "✓ FEE_RECIPIENT USDC ATA already exists."
fi

# ---------- 3. Init vault PDAs ----------
echo ""
echo "================================================================"
echo "  STEP 3 — Initializing vault PDAs for every active bundle"
echo "================================================================"

# Make sure backend deps are present (init-demo-vaults.ts imports from there)
if [[ ! -d backend/node_modules ]]; then
  log "backend/node_modules missing — installing..."
  logcmd bash -lc "cd backend && npm install"
fi

# Make sure root-level tsx is usable. Use backend's tsx if no root package.
if command -v npx >/dev/null 2>&1; then
  log ""
  log "Running: npx tsx scripts/init-demo-vaults.ts"
  logcmd npx --yes tsx scripts/init-demo-vaults.ts
  INIT_RC=$?
else
  log "ERROR: npx not available."
  exit 1
fi

# ---------- 4. Report ----------
echo ""
echo "================================================================"
echo "  STEP 4 — Summary"
echo "================================================================"

log ""
log "init-demo-vaults.ts exit: $INIT_RC"
log ""

# Pull a quick count from Supabase via the backend check endpoint if running,
# otherwise parse the log.
VAULTS_WRITTEN=$(grep -c '✓ vault=' "$LOG" || true)
VAULTS_ALREADY=$(grep -c 'already initialized' "$LOG" || true)
log "vaults newly initialized this run: $VAULTS_WRITTEN"
log "vaults already initialized:        $VAULTS_ALREADY"

log ""
log "Finished: $(date)"

echo ""
if [[ $INIT_RC -eq 0 ]]; then
  echo "✅ On-chain bootstrap complete."
  echo "   • FEE_RECIPIENT USDC ATA ready"
  echo "   • $VAULTS_WRITTEN new vaults + $VAULTS_ALREADY pre-existing"
  echo ""
  echo "   Next: ./22-railway-env-export.command   (build the Railway env list)"
else
  echo "⚠️  init-demo-vaults.ts failed. See .logs/21-init-onchain-vaults.log"
fi
echo ""
read -r -p "Press ENTER to close this window..."

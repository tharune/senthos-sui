#!/bin/bash
# 00-onboard.command
#
# New-teammate onboarding. Run this once after cloning the repo.
# Generates a devnet keypair, airdrops SOL, writes a pre-filled backend/.env
# template, and prints the exact list of things you still need from Victor.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/00-onboard.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "00-onboard — set up your devnet dev env"

# --- 1. Prereq checks ---
log ""
log "[step 1] Check prerequisites"
MISSING=""
for cmd in node npm solana git; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "  ❌ missing: $cmd"
    MISSING="$MISSING $cmd"
  else
    log "  ✅ $cmd: $($cmd --version 2>/dev/null | head -1)"
  fi
done
if [ -n "$MISSING" ]; then
  log ""
  log "Install the missing tools and rerun this script."
  log "  node:     brew install node     (or use nvm)"
  log "  solana:   sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
  read -r -p "Press ENTER to close..."
  exit 1
fi

# --- 2. Solana config ---
log ""
log "[step 2] Configure Solana CLI to devnet"
solana config set --url devnet 2>&1 | tee -a "$LOG" >/dev/null
CURRENT_RPC="$(solana config get | grep 'RPC URL' | awk '{print $3}')"
log "  RPC URL: $CURRENT_RPC"

# --- 3. Keypair ---
log ""
log "[step 3] Create or reuse your dev-authority keypair"
KEYPAIR_PATH="$HOME/.config/solana/dev-authority.json"
if [ -f "$KEYPAIR_PATH" ]; then
  log "  ✅ keypair already exists: $KEYPAIR_PATH"
else
  mkdir -p "$(dirname "$KEYPAIR_PATH")"
  log "  generating a new keypair..."
  solana-keygen new --no-bip39-passphrase -o "$KEYPAIR_PATH" 2>&1 | tee -a "$LOG"
fi
AUTHORITY_PUBKEY="$(solana-keygen pubkey "$KEYPAIR_PATH")"
log "  authority address: $AUTHORITY_PUBKEY"
log "  Solscan:  https://solscan.io/account/${AUTHORITY_PUBKEY}?cluster=devnet"

# --- 4. SOL airdrop ---
log ""
log "[step 4] Airdrop 2 SOL on devnet"
CURRENT_SOL="$(solana balance "$AUTHORITY_PUBKEY" --url devnet 2>/dev/null | awk '{print $1}')"
log "  current balance: ${CURRENT_SOL:-0} SOL"
if awk "BEGIN {exit !(${CURRENT_SOL:-0} < 1)}"; then
  log "  requesting airdrop..."
  if ! solana airdrop 2 "$AUTHORITY_PUBKEY" --url devnet 2>&1 | tee -a "$LOG"; then
    log "  ⚠️  airdrop failed (devnet faucet is rate-limited)."
    log "     Try https://faucet.solana.com in a browser, or wait a few minutes."
  fi
else
  log "  (already funded; skipping airdrop)"
fi

# --- 5. backend/.env template ---
log ""
log "[step 5] Create backend/.env from .env.example"
ENV_PATH="$REPO_ROOT/backend/.env"
EXAMPLE_PATH="$REPO_ROOT/backend/.env.example"
if [ ! -f "$EXAMPLE_PATH" ]; then
  log "  ❌ backend/.env.example missing — are you on the right branch?"
  read -r -p "Press ENTER to close..."
  exit 1
fi
if [ -f "$ENV_PATH" ]; then
  log "  ⚠️  backend/.env already exists — not overwriting."
  log "     If you want a clean template, delete it and rerun this script."
else
  cp "$EXAMPLE_PATH" "$ENV_PATH"
  # Pre-fill the public values + your keypair path. Secrets stay as placeholders.
  sed -i.bak \
    -e "s|^SOLANA_RPC_URL=.*|SOLANA_RPC_URL=https://api.devnet.solana.com|" \
    -e "s|^TRAXIS_VAULT_PROGRAM_ID=.*|TRAXIS_VAULT_PROGRAM_ID=E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb|" \
    -e "s|^TRAXIS_PPN_PROGRAM_ID=.*|TRAXIS_PPN_PROGRAM_ID=4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE|" \
    -e "s|^USDC_MINT=.*|USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU|" \
    -e "s|^FEE_RECIPIENT=.*|FEE_RECIPIENT=${AUTHORITY_PUBKEY}|" \
    -e "s|^AUTHORITY_KEYPAIR=.*|AUTHORITY_KEYPAIR=${KEYPAIR_PATH}|" \
    "$ENV_PATH"
  rm -f "$ENV_PATH.bak"
  log "  ✅ wrote $ENV_PATH with public values + your keypair path"
fi

# --- 6. Install backend deps ---
log ""
log "[step 6] Install backend dependencies"
if [ -d "$REPO_ROOT/backend/node_modules" ]; then
  log "  (backend/node_modules already present; skipping)"
else
  (cd "$REPO_ROOT/backend" && npm install 2>&1 | tail -20) | tee -a "$LOG"
fi

# --- 7. Final instructions ---
banner "✅ ONBOARDING DONE — next steps"
log ""
log "You still need to do these manually:"
log ""
log "  1. FUND YOUR AUTHORITY WITH DEVNET USDC"
log "     Open:    https://faucet.circle.com"
log "     Network: Solana Devnet"
log "     Address: ${AUTHORITY_PUBKEY}"
log "     Request 10 USDC (test only uses 1)"
log ""
log "  2. ASK VICTOR FOR THE SUPABASE SECRETS (via Signal / 1Password)"
log "     Fill in these lines in backend/.env:"
log "       SUPABASE_URL=..."
log "       SUPABASE_ANON_KEY=..."
log "       HELIUS_API_KEY=...     (optional)"
log ""
log "  3. VERIFY IT WORKS"
log "     ./38-real-usdc-test.command"
log ""
log "  4. RUN BACKEND + FRONTEND"
log "     cd backend  && npm run dev     # :3001"
log "     cd frontend && npm run dev     # :3000"
log ""
log "Full setup guide: see TEAMMATE-SETUP.md in the repo root."
log ""
log "Log: $LOG"
read -r -p "Press ENTER to close..."

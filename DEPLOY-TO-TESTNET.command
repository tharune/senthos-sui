#!/bin/bash
# DEPLOY-TO-TESTNET.command
#
# One-shot testnet bring-up. Double-click to run on macOS.
#
# This script:
#   1. Checks solana-cli + anchor-cli are installed + prints their versions
#   2. Sets the Solana CLI to testnet cluster
#   3. Airdrops testnet SOL to your authority if balance is low
#   4. anchor build  (so target/deploy/*.so is fresh)
#   5. anchor deploy --provider.cluster testnet  (redeploys programs)
#   6. Runs scripts/mint-testnet-usdc.ts  (creates mock USDC SPL mint)
#   7. Runs scripts/init-meteora-mock.ts  (initialises the PPN mock adapter)
#   8. Runs scripts/init-demo-vaults.ts   (initialises every STHS vault PDA)
#   9. Prints the testnet USDC mint so you can paste it into your .env files
#
# Safe to re-run — every step is idempotent.
#
# Prerequisites (one-time setup on your Mac):
#   - brew install solana               (or see docs.solana.com/cli/install-solana-cli-tools)
#   - cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.30.1
#   - backend/.env.testnet filled in (copy from backend/.env.testnet.example)
#   - .env.local.testnet filled in     (copy from .env.local.testnet.example)
#   - npm install                      (at repo root, for the new spl-token dep)

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "cd failed"; exit 1; }

mkdir -p .logs
MAIN_LOG=".logs/TESTNET-DEPLOY.log"
: > "$MAIN_LOG"

banner() {
  echo ""
  echo "████████████████████████████████████████████████████████████████"
  echo "  $1"
  echo "████████████████████████████████████████████████████████████████"
  echo ""
  echo "$(date)  $1" >> "$MAIN_LOG"
}

fail() {
  echo ""
  echo "❌ $1"
  echo ""
  read -r -p "Press ENTER to close..."
  exit 1
}

banner "DEPLOY-TO-TESTNET  (Senthos/Traxis testnet bring-up)"
echo "Repo: $REPO_ROOT"
echo ""

# ───────── 0. Sanity checks ─────────
banner "STEP 0/8 — toolchain check"
command -v solana >/dev/null 2>&1 || fail "solana CLI not found. Install: brew install solana"
command -v anchor >/dev/null 2>&1 || fail "anchor CLI not found. Install: cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.30.1"
command -v npx    >/dev/null 2>&1 || fail "npx not found (install Node.js via nvm or brew install node)"

echo "solana: $(solana --version)"
echo "anchor: $(anchor --version)"
echo "node:   $(node --version)"

# Ensure root deps are installed so scripts/ can resolve @solana/spl-token + tsx.
if [[ ! -d "node_modules/@solana/spl-token" ]]; then
  echo ""
  echo "• @solana/spl-token not installed at root — running npm install..."
  npm install || fail "npm install failed"
fi

# ───────── 1. Load testnet env ─────────
banner "STEP 1/8 — load backend/.env.testnet"
if [[ ! -f "backend/.env.testnet" ]]; then
  fail "backend/.env.testnet not found.
Copy backend/.env.testnet.example → backend/.env.testnet and fill it in first."
fi
if [[ ! -f ".env.local.testnet" ]]; then
  echo "⚠  .env.local.testnet not found — frontend won't work until you create it."
  echo "   Copy .env.local.testnet.example → .env.local.testnet and fill it in."
  echo ""
  read -r -p "Continue anyway? [y/N] " ans
  case "$ans" in y|Y|yes|YES) : ;; *) fail "Aborted." ;; esac
fi

set -o allexport
# shellcheck disable=SC1091
source backend/.env.testnet
set +o allexport

if [[ -z "${AUTHORITY_KEYPAIR:-}" ]]; then
  fail "AUTHORITY_KEYPAIR not set in backend/.env.testnet"
fi

# Resolve ~ in AUTHORITY_KEYPAIR if it's a file path.
if [[ "$AUTHORITY_KEYPAIR" != "["* ]]; then
  AUTHORITY_KEY_PATH="${AUTHORITY_KEYPAIR/#\~/$HOME}"
  if [[ ! -f "$AUTHORITY_KEY_PATH" ]]; then
    fail "AUTHORITY_KEYPAIR file not found: $AUTHORITY_KEY_PATH"
  fi
  AUTHORITY_PUBKEY="$(solana-keygen pubkey "$AUTHORITY_KEY_PATH")"
else
  echo "(AUTHORITY_KEYPAIR is a JSON array — using backend script to derive pubkey)"
  AUTHORITY_PUBKEY="$(node -e '
    const k = JSON.parse(process.env.AUTHORITY_KEYPAIR);
    const { Keypair } = require("@solana/web3.js");
    console.log(Keypair.fromSecretKey(Uint8Array.from(k)).publicKey.toBase58());
  ')"
fi

echo "Authority pubkey: $AUTHORITY_PUBKEY"

# ───────── 2. Point solana CLI at testnet ─────────
banner "STEP 2/8 — configure solana CLI for testnet"
solana config set --url "${SOLANA_RPC_URL:-https://api.testnet.solana.com}" --commitment confirmed
if [[ -n "${AUTHORITY_KEY_PATH:-}" ]]; then
  solana config set --keypair "$AUTHORITY_KEY_PATH"
fi
solana config get

# ───────── 3. Check balance + airdrop if needed ─────────
banner "STEP 3/8 — check authority SOL balance on testnet"
BALANCE="$(solana balance "$AUTHORITY_PUBKEY" 2>/dev/null | awk '{print $1}')"
BALANCE="${BALANCE:-0}"
echo "Current balance: ${BALANCE} SOL"
MIN_SOL=5
# Compare as integer by multiplying by 1e9 — bash doesn't do floats.
BAL_LAMPORTS="$(awk -v b="$BALANCE" 'BEGIN{printf "%d", b*1e9}')"
MIN_LAMPORTS=$((MIN_SOL * 1000000000))
if [[ "$BAL_LAMPORTS" -lt "$MIN_LAMPORTS" ]]; then
  echo ""
  echo "Low balance (need ~5 SOL for anchor deploy). Attempting airdrop..."
  # Testnet airdrop is heavily rate-limited; try a few small ones.
  for i in 1 2 3 4 5; do
    echo "  airdrop attempt $i (1 SOL)..."
    solana airdrop 1 "$AUTHORITY_PUBKEY" --url testnet || true
    sleep 2
  done
  BALANCE="$(solana balance "$AUTHORITY_PUBKEY" 2>/dev/null | awk '{print $1}')"
  echo ""
  echo "Balance after airdrops: ${BALANCE} SOL"
  BAL_LAMPORTS="$(awk -v b="$BALANCE" 'BEGIN{printf "%d", b*1e9}')"
  if [[ "$BAL_LAMPORTS" -lt "$MIN_LAMPORTS" ]]; then
    echo ""
    echo "⚠  Still under 5 SOL. Testnet airdrop faucet is often rate-limited."
    echo "   Try https://faucet.solana.com/ (select 'Testnet') or wait + rerun."
    echo ""
    read -r -p "Continue anyway (risky — deploy may fail for lack of SOL)? [y/N] " ans
    case "$ans" in y|Y|yes|YES) : ;; *) fail "Aborted." ;; esac
  fi
fi

# ───────── 4. anchor build ─────────
banner "STEP 4/8 — anchor build"
anchor build 2>&1 | tee -a "$MAIN_LOG"
[[ "${PIPESTATUS[0]}" -eq 0 ]] || fail "anchor build failed — see $MAIN_LOG"

# ───────── 5. anchor deploy to testnet ─────────
banner "STEP 5/8 — anchor deploy --provider.cluster testnet"
echo "This deploys BOTH traxis_vault and traxis_ppn to testnet."
echo "First deploy for a fresh cluster takes 2-5 minutes and costs ~4 SOL."
echo ""
anchor deploy --provider.cluster testnet 2>&1 | tee -a "$MAIN_LOG"
[[ "${PIPESTATUS[0]}" -eq 0 ]] || fail "anchor deploy failed — see $MAIN_LOG"

# ───────── 6. Mint mock USDC ─────────
banner "STEP 6/8 — mint mock USDC on testnet"
npx tsx scripts/mint-testnet-usdc.ts 2>&1 | tee -a "$MAIN_LOG"
[[ "${PIPESTATUS[0]}" -eq 0 ]] || fail "mint-testnet-usdc failed — see $MAIN_LOG"

MINT_ADDRESS="$(cat .logs/testnet-usdc-mint.txt 2>/dev/null | tr -d '[:space:]')"
if [[ -n "$MINT_ADDRESS" ]]; then
  echo ""
  echo "Mock USDC mint address: $MINT_ADDRESS"
  echo ""
  # Auto-patch USDC_MINT in backend/.env.testnet if it's still the placeholder.
  if grep -q "replace_with_testnet_mock_usdc_mint" backend/.env.testnet 2>/dev/null; then
    echo "• Auto-updating USDC_MINT in backend/.env.testnet..."
    # BSD sed (macOS) wants -i ''
    sed -i '' "s|USDC_MINT=replace_with_testnet_mock_usdc_mint|USDC_MINT=$MINT_ADDRESS|" backend/.env.testnet
  fi
  if [[ -f .env.local.testnet ]] && grep -q "replace_with_testnet_mock_usdc_mint" .env.local.testnet 2>/dev/null; then
    echo "• Auto-updating NEXT_PUBLIC_USDC_MINT in .env.local.testnet..."
    sed -i '' "s|NEXT_PUBLIC_USDC_MINT=replace_with_testnet_mock_usdc_mint|NEXT_PUBLIC_USDC_MINT=$MINT_ADDRESS|" .env.local.testnet
  fi
  # Re-source so the init scripts below see the new USDC_MINT.
  set -o allexport
  # shellcheck disable=SC1091
  source backend/.env.testnet
  set +o allexport
fi

# ───────── 7. Initialize mock Meteora adapter (PPN) ─────────
banner "STEP 7/8 — initialise mock Meteora adapter on testnet"
# init-meteora-mock.ts loads env from backend/.env by default. We override by
# pre-sourcing backend/.env.testnet above and passing it explicitly via env.
#
# The script uses dotenv.config({ path: backend/.env }) — we copy our testnet
# env to backend/.env temporarily ONLY for the init scripts, then restore.
if [[ -f backend/.env ]]; then
  cp backend/.env ".logs/backend-env-before-testnet.bak"
fi
cp backend/.env.testnet backend/.env

npx tsx scripts/init-meteora-mock.ts 2>&1 | tee -a "$MAIN_LOG"
METEORA_RC="${PIPESTATUS[0]}"

# ───────── 8. Initialize demo vaults ─────────
banner "STEP 8/8 — initialise STHS vault PDAs on testnet"
if [[ "$METEORA_RC" -eq 0 ]]; then
  npx tsx scripts/init-demo-vaults.ts 2>&1 | tee -a "$MAIN_LOG"
  VAULTS_RC="${PIPESTATUS[0]}"
else
  echo "Skipping vault init because Meteora mock init failed."
  VAULTS_RC=1
fi

# Restore backend/.env so devnet still works.
if [[ -f .logs/backend-env-before-testnet.bak ]]; then
  mv .logs/backend-env-before-testnet.bak backend/.env
fi

if [[ "$METEORA_RC" -ne 0 || "$VAULTS_RC" -ne 0 ]]; then
  fail "Vault init failed. See $MAIN_LOG. backend/.env restored to previous state."
fi

# ───────── Summary ─────────
banner "TESTNET DEPLOY COMPLETE"
echo "Summary:"
echo "  Authority:     $AUTHORITY_PUBKEY"
echo "  RPC:           ${SOLANA_RPC_URL:-https://api.testnet.solana.com}"
echo "  Vault program: ${TRAXIS_VAULT_PROGRAM_ID:-?}"
echo "  PPN program:   ${TRAXIS_PPN_PROGRAM_ID:-?}"
echo "  Mock USDC:     ${MINT_ADDRESS:-(see .logs/testnet-usdc-mint.txt)}"
echo ""
echo "Next steps:"
echo "  1. Switch active env:      ./SWITCH-CLUSTER.command testnet"
echo "  2. Reset Supabase rows:    ./TESTNET-RESET-DB.command"
echo "  3. Reseed bundles:         cd backend && npm run seed"
echo "  4. Restart dev servers:    ./RUN-BACKEND.command + ./RUN-FRONTEND.command"
echo "  5. In Phantom: Settings → Developer Settings → Testnet Mode ON"
echo "  6. Airdrop mock USDC to your wallet:"
echo "       npx tsx scripts/airdrop-testnet-usdc.ts <YOUR_WALLET> 1000"
echo ""
read -r -p "Press ENTER to close this window..."

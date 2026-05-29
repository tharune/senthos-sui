#!/bin/bash
# Phase 14: Deploy the two programs built by phase 13 to Solana devnet.
#
# Uses the HOST solana CLI (2.3.9) + the host's funded devnet wallet
# (~/.config/solana/id.json). Assumes target/deploy/traxis_vault.so and
# target/deploy/traxis_ppn.so already exist (run 13-build-both.command first).
#
# `solana program deploy` is used directly rather than `anchor deploy` to
# avoid any anchor-side rebuild triggered by a drift between host and
# container toolchains. The .so files from the Docker build are the source
# of truth; they're deployed as-is.

set +e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

clear
echo "=================================================="
echo " Phase 14: Deploy to devnet                      "
echo "=================================================="

# --- 1. Preflight ---
if ! command -v solana >/dev/null 2>&1; then
  echo "solana CLI not found on host. Install via https://docs.solanalabs.com/cli/install."
  read -p "Press Return..."
  exit 1
fi
if [ ! -f "target/deploy/traxis_vault.so" ] || [ ! -f "target/deploy/traxis_ppn.so" ]; then
  echo "Missing .so file(s). Run 13-build-both.command first."
  ls -la target/deploy/ 2>/dev/null
  read -p "Press Return..."
  exit 1
fi
for f in traxis_vault.so traxis_ppn.so; do
  SZ=$(stat -f%z "target/deploy/$f" 2>/dev/null || stat -c%s "target/deploy/$f")
  if [ "$SZ" -lt 100000 ]; then
    echo "target/deploy/$f is ${SZ} bytes — likely a stub. Re-run 13-build-both.command."
    read -p "Press Return..."
    exit 1
  fi
  echo "  target/deploy/$f — ${SZ} bytes OK"
done

# Sanity: verify declare_id! bytes in .so match the keypair pubkeys. Catches
# the bug where an old .so + new keypair lead to runtime DeclaredProgramIdMismatch.
echo
echo "---- declare_id! sanity check ----"
python3 - <<'PYEOF' || { echo "declare_id sanity check failed — rebuild or re-patch."; read -p "Press Return..."; exit 1; }
import json, sys
try:
    import base58
except ImportError:
    print("base58 not installed; skipping sanity check (pip install base58).")
    sys.exit(0)

for name in ("traxis_vault", "traxis_ppn"):
    with open(f"target/deploy/{name}-keypair.json") as f:
        arr = json.load(f)
    pk = bytes(arr[32:])
    with open(f"target/deploy/{name}.so", "rb") as f:
        data = f.read()
    if pk not in data:
        print(f"  {name}.so MISSING the pubkey from {name}-keypair.json")
        print(f"  -> expected {base58.b58encode(pk).decode()} in the .so")
        sys.exit(1)
    print(f"  {name}.so contains declare_id {base58.b58encode(pk).decode()}  OK")
PYEOF

# --- 2. Cluster + balance ---
echo
echo "---- Setting cluster to devnet ----"
solana config set --url https://api.devnet.solana.com >/dev/null
solana config get

echo
echo "---- Balance check ----"
BALANCE=$(solana balance | awk '{print $1}')
echo "Current balance: ${BALANCE} SOL"
# Deploy cost is ~5 SOL for both programs (vault upgrade ~2.5 + ppn deploy ~2.5).
# Devnet airdrop caps out at 2 SOL per request, so may need two.
NEED=5
TRIES=0
while awk "BEGIN {exit !($BALANCE < $NEED)}" && [ $TRIES -lt 3 ]; do
  echo "Balance below ${NEED} SOL, requesting 2 SOL airdrop (attempt $((TRIES+1)))..."
  solana airdrop 2 2>&1 | tail -3 || true
  sleep 3
  BALANCE=$(solana balance | awk '{print $1}')
  echo "Balance now: ${BALANCE} SOL"
  TRIES=$((TRIES+1))
done
if awk "BEGIN {exit !($BALANCE < 3)}"; then
  echo "WARNING: balance is only ${BALANCE} SOL; deploy may fail with InsufficientFunds."
  echo "If so, fund via https://faucet.solana.com/ and re-run."
fi

# --- 3. Program IDs (must already match declare_id! from phase 13 build) ---
VAULT_ID=$(solana address -k target/deploy/traxis_vault-keypair.json)
PPN_ID=$(solana address -k target/deploy/traxis_ppn-keypair.json)
DEPLOYER=$(solana address)

echo
echo "---- Deploying ----"
echo "  deployer: $DEPLOYER"
echo "  vault id: $VAULT_ID"
echo "  ppn id:   $PPN_ID"

# --- 4. Deploy vault first (PPN depends on vault's program-id via CPI). ---
echo
echo "---- solana program deploy traxis_vault ----"
solana program deploy \
  --program-id target/deploy/traxis_vault-keypair.json \
  target/deploy/traxis_vault.so 2>&1 | tee deploy-vault.log

echo
echo "---- solana program deploy traxis_ppn ----"
solana program deploy \
  --program-id target/deploy/traxis_ppn-keypair.json \
  target/deploy/traxis_ppn.so 2>&1 | tee deploy-ppn.log

# --- 5. Sanity-check: confirm each program shows up on chain. ---
echo
echo "---- On-chain verification ----"
for PID in "$VAULT_ID" "$PPN_ID"; do
  echo ">> solana program show $PID"
  solana program show "$PID" 2>&1 | tail -10
  echo
done

# --- 6. Sync IDL if anchor build produced it; otherwise warn. ---
echo
echo "---- Syncing IDL to backend ----"
if [ -f "target/idl/traxis_vault.json" ] && [ -f "target/idl/traxis_ppn.json" ]; then
  if [ -x scripts/sync-idl.sh ]; then
    bash scripts/sync-idl.sh
  else
    mkdir -p backend/src/idl
    cp target/idl/traxis_vault.json backend/src/idl/traxis_vault.json
    cp target/idl/traxis_ppn.json   backend/src/idl/traxis_ppn.json
    echo "Copied IDL files to backend/src/idl/"
  fi
  ls -la backend/src/idl/ 2>/dev/null
else
  echo "IDL files not found in target/idl/ — unexpected."
  echo "The hand-written IDLs (from gen_idl.py) should already be there. Check:"
  echo "  target/idl/traxis_vault.json"
  echo "  target/idl/traxis_ppn.json"
fi

# --- 7. Emit backend/.env block so the user can paste it. ---
echo
echo "=============================================="
echo " Paste into backend/.env                      "
echo "=============================================="
cat <<ENVEOF
SOLANA_RPC_URL=https://api.devnet.solana.com
TRAXIS_VAULT_PROGRAM_ID=${VAULT_ID}
TRAXIS_PPN_PROGRAM_ID=${PPN_ID}
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
FEE_RECIPIENT=${DEPLOYER}
AUTHORITY_KEYPAIR=${HOME}/.config/solana/id.json
ENVEOF

echo
echo "Explorer links:"
echo "  https://explorer.solana.com/address/${VAULT_ID}?cluster=devnet"
echo "  https://explorer.solana.com/address/${PPN_ID}?cluster=devnet"

echo
read -p "Press Return..."

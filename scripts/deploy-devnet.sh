#!/usr/bin/env bash
# Build + deploy Traxis programs to Solana devnet.
#
# Prerequisites:
#   - solana-cli installed and configured (`solana config set --url https://api.devnet.solana.com`)
#   - anchor CLI installed (0.30.1 recommended: `avm install 0.30.1 && avm use 0.30.1`)
#   - Rust toolchain (1.79+)
#   - A funded devnet wallet at ~/.config/solana/id.json (`solana airdrop 2` will help)
#
# What this does:
#   1. Generates fresh program keypairs if they don't exist.
#   2. Builds both Anchor programs.
#   3. Deploys to devnet.
#   4. Syncs IDL to backend/src/idl/ so the API server can load them.
#   5. Prints the program IDs and a suggested .env block.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Checking prerequisites"
command -v solana >/dev/null || { echo "solana-cli not found. Install: https://docs.solanalabs.com/cli/install"; exit 1; }
command -v anchor >/dev/null || { echo "anchor not found. Install: https://www.anchor-lang.com/docs/installation"; exit 1; }
command -v cargo >/dev/null || { echo "cargo not found. Install rust: https://rustup.rs"; exit 1; }

echo "==> Devnet cluster config"
solana config set --url https://api.devnet.solana.com >/dev/null
solana config get

echo "==> Balance check"
BALANCE=$(solana balance | awk '{print $1}')
if awk "BEGIN {exit !($BALANCE < 1)}"; then
  echo "Low balance ($BALANCE SOL). Airdropping 2 SOL..."
  solana airdrop 2 || true
  echo "New balance: $(solana balance)"
fi

echo "==> Generating program keypairs (if missing)"
mkdir -p target/deploy
for NAME in traxis_vault traxis_ppn; do
  KP="target/deploy/${NAME}-keypair.json"
  if [ ! -f "$KP" ]; then
    solana-keygen new --no-bip39-passphrase -s -o "$KP" >/dev/null
    echo "  Created $KP"
  else
    echo "  Using existing $KP"
  fi
done

VAULT_ID=$(solana address -k target/deploy/traxis_vault-keypair.json)
PPN_ID=$(solana address -k target/deploy/traxis_ppn-keypair.json)

echo "==> Program IDs"
echo "  traxis_vault: $VAULT_ID"
echo "  traxis_ppn:   $PPN_ID"

echo "==> Syncing declare_id! macros"
# Replace placeholder in lib.rs files so Anchor can derive accounts correctly.
# Uses `|` as sed delimiter since base58 has no pipes.
sed -i.bak -E "s|declare_id!\(\"[^\"]+\"\);|declare_id!(\"${VAULT_ID}\");|" programs/traxis_vault/src/lib.rs
sed -i.bak -E "s|declare_id!\(\"[^\"]+\"\);|declare_id!(\"${PPN_ID}\");|" programs/traxis_ppn/src/lib.rs
sed -i.bak -E "s|^traxis_vault\s*=.*$|traxis_vault = \"${VAULT_ID}\"|" Anchor.toml
sed -i.bak -E "s|^traxis_ppn\s*=.*$|traxis_ppn = \"${PPN_ID}\"|" Anchor.toml
rm -f programs/*/src/lib.rs.bak Anchor.toml.bak

echo "==> Building (anchor build)"
anchor build

echo "==> Deploying (anchor deploy)"
anchor deploy --provider.cluster devnet

echo "==> Syncing IDL to backend"
bash "$ROOT/scripts/sync-idl.sh"

echo
echo "==> Done. Paste the block below into backend/.env:"
echo
cat <<EOF
SOLANA_RPC_URL=https://api.devnet.solana.com
TRAXIS_VAULT_PROGRAM_ID=${VAULT_ID}
TRAXIS_PPN_PROGRAM_ID=${PPN_ID}
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
# FEE_RECIPIENT=<your treasury pubkey>
# AUTHORITY_KEYPAIR=$HOME/.config/solana/id.json
EOF
echo
echo "Explorer links:"
echo "  https://explorer.solana.com/address/${VAULT_ID}?cluster=devnet"
echo "  https://explorer.solana.com/address/${PPN_ID}?cluster=devnet"

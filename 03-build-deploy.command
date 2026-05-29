#!/bin/bash
# Traxis Phase 3: build Anchor programs, airdrop SOL if needed, deploy to devnet, sync IDL.
# Run this after 02-install-toolchain.command and 02b-fix-anchor.command.
set +e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
clear
echo "==============================================="
echo " Phase 3: build + deploy Traxis to devnet     "
echo "==============================================="
echo "Started at $(date)"
echo

# --- Sanity check toolchain ---
echo "---- Toolchain ----"
for CMD in rustc cargo solana anchor; do
  if command -v "$CMD" >/dev/null 2>&1; then
    printf "  ✓ %-8s %s\n" "$CMD" "$("$CMD" --version 2>&1 | head -1)"
  else
    echo "  ✗ $CMD MISSING — run 02-install-toolchain.command first"
    read -p "Press Return to close..."
    exit 1
  fi
done
echo

# --- Check balance and top up ---
DEPLOYER=$(solana address)
echo "Deployer: $DEPLOYER"
echo "Balance:  $(solana balance)"

BAL=$(solana balance 2>&1 | awk '{print $1}')
if awk "BEGIN{exit !($BAL+0 < 4)}" 2>/dev/null; then
  echo
  echo "Balance < 4 SOL. Deployment needs ~3-5 SOL total."
  echo "Attempting airdrops..."
  for AMT in 2 2 1 1; do
    solana airdrop $AMT 2>&1 | tail -1
    sleep 3
    BAL2=$(solana balance 2>&1 | awk '{print $1}')
    if awk "BEGIN{exit !($BAL2+0 >= 4)}" 2>/dev/null; then break; fi
  done
  echo "Balance now: $(solana balance)"
fi

BAL=$(solana balance 2>&1 | awk '{print $1}')
if awk "BEGIN{exit !($BAL+0 < 2)}" 2>/dev/null; then
  echo
  echo "=================================================="
  echo "  MANUAL SOL AIRDROP REQUIRED                    "
  echo "=================================================="
  echo "Devnet faucet is rate-limited. Open this URL in"
  echo "your browser, paste your deployer address, click"
  echo "DevNet, and confirm the captcha to get 5 SOL:"
  echo
  echo "  https://faucet.solana.com/"
  echo
  echo "Your address: $DEPLOYER"
  echo
  echo "After topping up, re-run this .command file."
  read -p "Press Return to close..."
  exit 1
fi
echo

# --- Generate program keypairs if missing ---
echo "---- Program keypairs ----"
mkdir -p target/deploy
for NAME in traxis_vault traxis_ppn; do
  KP="target/deploy/${NAME}-keypair.json"
  if [ ! -f "$KP" ]; then
    solana-keygen new --no-bip39-passphrase -s -o "$KP"
    echo "  created $KP"
  else
    echo "  keeping $KP"
  fi
done
VAULT_ID=$(solana address -k target/deploy/traxis_vault-keypair.json)
PPN_ID=$(solana address -k target/deploy/traxis_ppn-keypair.json)
echo "  traxis_vault program id: $VAULT_ID"
echo "  traxis_ppn   program id: $PPN_ID"
echo

# --- Sync declare_id! and Anchor.toml ---
echo "---- Syncing declare_id! and Anchor.toml ----"
# lib.rs declare_id! lines
python3 -c "
import re, sys
for p, pid in [('programs/traxis_vault/src/lib.rs', '${VAULT_ID}'),
               ('programs/traxis_ppn/src/lib.rs',   '${PPN_ID}')]:
    with open(p) as f: s = f.read()
    s = re.sub(r'declare_id!\(\"[^\"]+\"\);', f'declare_id!(\"{pid}\");', s, count=1)
    with open(p,'w') as f: f.write(s)
    print('  updated', p)
# Anchor.toml [programs.localnet] / [programs.devnet]
with open('Anchor.toml') as f: s = f.read()
s = re.sub(r'traxis_vault\s*=\s*\"[^\"]+\"', 'traxis_vault = \"${VAULT_ID}\"', s)
s = re.sub(r'traxis_ppn\s*=\s*\"[^\"]+\"',   'traxis_ppn   = \"${PPN_ID}\"',   s)
with open('Anchor.toml','w') as f: f.write(s)
print('  updated Anchor.toml')
"

# --- Build ---
echo
echo "---- anchor build ----"
echo "(first build compiles many deps — expect 3-8 min)"
anchor build 2>&1 | tail -30
if [ ! -f "target/deploy/traxis_vault.so" ]; then
  echo
  echo "FATAL: anchor build did not produce target/deploy/traxis_vault.so"
  echo "Scroll up in this window to see the full error."
  read -p "Press Return to close..."
  exit 1
fi
echo "Build artifacts:"
ls -la target/deploy/*.so

# --- Deploy ---
echo
echo "---- anchor deploy ----"
anchor deploy --provider.cluster devnet 2>&1 | tail -30
echo

# --- Sync IDL to backend ---
echo "---- Syncing IDL to backend ----"
bash scripts/sync-idl.sh

# --- Write env block ---
echo
echo "==============================================="
echo " Deployment complete. Paste into backend/.env:"
echo "==============================================="
cat <<EOF
SOLANA_RPC_URL=https://api.devnet.solana.com
TRAXIS_VAULT_PROGRAM_ID=${VAULT_ID}
TRAXIS_PPN_PROGRAM_ID=${PPN_ID}
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
FEE_RECIPIENT=${DEPLOYER}
AUTHORITY_KEYPAIR=${HOME}/.config/solana/id.json
EOF
echo
echo "Explorer:"
echo "  https://explorer.solana.com/address/${VAULT_ID}?cluster=devnet"
echo "  https://explorer.solana.com/address/${PPN_ID}?cluster=devnet"
echo
read -p "Press Return to close..."

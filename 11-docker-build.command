#!/bin/bash
# Phase 11 v2: Docker build with frozen Cargo.lock from anchor 0.30.1.
set +e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Close stale terminal windows
osascript <<'APPLESCRIPT' 2>/dev/null
tell application "Terminal"
  set frontWin to name of front window
  repeat with w in (get windows)
    if name of w is not frontWin then
      try
        close w saving no
      end try
    end if
  end repeat
end tell
APPLESCRIPT

clear
echo "=================================================="
echo " Phase 11 v2: Docker + frozen Cargo.lock         "
echo "=================================================="

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI not found."
  read -p "Press Return..."
  exit 1
fi

# Boot Docker if not running
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  for i in {1..60}; do sleep 1; docker info >/dev/null 2>&1 && break; done
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is still not running. Start Docker Desktop and retry."
  read -p "Press Return..."
  exit 1
fi

# Sync Cargo.toml to anchor 0.30.1 (matches the image)
python3 <<'PYEOF'
import re
for p in ["programs/traxis_vault/Cargo.toml", "programs/traxis_ppn/Cargo.toml"]:
    with open(p) as f: s = f.read()
    s = re.sub(r'anchor-lang\s*=\s*\{\s*version\s*=\s*"[^"]+"', 'anchor-lang = { version = "=0.30.1"', s)
    s = re.sub(r'anchor-spl\s*=\s*\{\s*version\s*=\s*"[^"]+"',  'anchor-spl  = { version = "=0.30.1"', s)
    # Remove any [patch.crates-io] block that previous attempts left behind
    i = s.find("[patch.crates-io]")
    if i > 0:
        s = s[:i].rstrip() + "\n"
    with open(p,'w') as f: f.write(s)
    print("Patched", p)
PYEOF
# Also clean root Cargo.toml
python3 <<'PYEOF'
with open("Cargo.toml") as f: s = f.read()
i = s.find("[patch.crates-io]")
if i > 0:
    s = s[:i].rstrip() + "\n"
    with open("Cargo.toml","w") as f: f.write(s)
    print("Cleaned root Cargo.toml")
PYEOF

rm -f Cargo.lock
rm -rf target/debug target/release target/idl target/types 2>/dev/null
mkdir -p target/deploy

echo
echo "---- (Re)build Docker image ----"
docker build -f Dockerfile.build -t traxis-build . 2>&1 | tail -40

echo
echo "---- Running anchor build inside container ----"
docker run --rm \
  -v "$PWD:/workdir" \
  -w /workdir \
  traxis-build 2>&1 | tee /tmp/docker-build.log | tail -80

echo
if [ -f "target/deploy/traxis_vault.so" ] && [ -f "target/deploy/traxis_ppn.so" ]; then
  echo "=============================================="
  echo " ✓ BUILD SUCCEEDED (inside Docker)           "
  echo "=============================================="
  ls -la target/deploy/*.so

  echo
  echo "---- anchor deploy (from host) ----"
  anchor deploy --provider.cluster devnet 2>&1 | tail -30
  bash scripts/sync-idl.sh

  VAULT_ID=$(solana address -k target/deploy/traxis_vault-keypair.json)
  PPN_ID=$(solana address -k target/deploy/traxis_ppn-keypair.json)
  DEPLOYER=$(solana address)
  echo
  echo "=============================================="
  echo " Paste into backend/.env:                     "
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
  echo "Explorer:"
  echo "  https://explorer.solana.com/address/${VAULT_ID}?cluster=devnet"
  echo "  https://explorer.solana.com/address/${PPN_ID}?cluster=devnet"
else
  echo "=============================================="
  echo " Build failed again. Log: /tmp/docker-build.log"
  echo "=============================================="
  tail -40 /tmp/docker-build.log
fi

echo
read -p "Press Return..."

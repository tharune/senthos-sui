#!/bin/bash
# Traxis Phase 2: install Rust + Solana CLI + Anchor.
# Idempotent — safe to re-run if a step fails mid-way.
# Expected runtime: 15-30 minutes (Anchor compile dominates).
set +e
cd "$(dirname "$0")"
clear
echo "======================================================"
echo "  Traxis onchain setup — Phase 2: toolchain install  "
echo "======================================================"
echo "Started at $(date)"
echo

# Ensure cargo + solana paths are picked up inside this script
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

# ---- Xcode Command Line Tools ----
echo "---- Xcode Command Line Tools ----"
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Missing. Triggering Apple installer. A GUI dialog should appear."
  xcode-select --install 2>/dev/null
  echo "Please finish the Apple install and re-run this .command file."
  echo
  read -p "Press Return to close this window..."
  exit 1
fi
echo "OK — $(xcode-select -p)"
echo

# ---- Rust via rustup ----
echo "---- Rust (rustup) ----"
if ! command -v rustc >/dev/null 2>&1; then
  echo "Installing Rust (non-interactive)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain stable --profile minimal
  source "$HOME/.cargo/env" 2>/dev/null || true
  export PATH="$HOME/.cargo/bin:$PATH"
fi
if command -v rustc >/dev/null 2>&1; then
  echo "rustc : $(rustc --version)"
  echo "cargo : $(cargo --version)"
else
  echo "FATAL: Rust install failed."
  read -p "Press Return to close..."
  exit 1
fi
echo

# ---- Solana CLI ----
echo "---- Solana CLI 1.18.26 ----"
if ! command -v solana >/dev/null 2>&1; then
  echo "Installing solana-install (trying release.anza.xyz)..."
  # Anza took over Solana CLI maintenance; new URL is the correct one.
  # Fall back to release.solana.com if anza is unreachable.
  if ! sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)" 2>&1; then
    echo "Anza URL failed, trying release.solana.com..."
    sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)" 2>&1
  fi
  export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
if command -v solana >/dev/null 2>&1; then
  echo "solana: $(solana --version)"
  solana config set --url https://api.devnet.solana.com >/dev/null
  echo "Cluster set to devnet."
else
  echo "FATAL: Solana install failed."
  read -p "Press Return to close..."
  exit 1
fi
echo

# ---- Deployer keypair ----
echo "---- Deployer keypair ----"
if [ ! -f ~/.config/solana/id.json ]; then
  mkdir -p ~/.config/solana
  solana-keygen new --no-bip39-passphrase -s -o ~/.config/solana/id.json
  echo "Generated ~/.config/solana/id.json"
else
  echo "Existing ~/.config/solana/id.json — keeping it."
fi
DEPLOYER=$(solana address)
echo "Deployer pubkey: $DEPLOYER"
echo

# ---- Airdrop ----
echo "---- Devnet airdrop ----"
BAL_RAW=$(solana balance 2>&1)
BAL=$(echo "$BAL_RAW" | awk '{print $1}')
if awk "BEGIN{exit !($BAL+0 < 1.5)}" 2>/dev/null; then
  echo "Current: $BAL_RAW. Airdropping 2 SOL (may require retry on rate limit)..."
  solana airdrop 2 2>&1 | tee /tmp/airdrop.log
  # Fallback to 1 SOL if rate-limited
  if grep -qi "limit" /tmp/airdrop.log; then
    sleep 5; solana airdrop 1 2>&1 | tail -2
  fi
fi
echo "Balance: $(solana balance)"
echo

# ---- avm + anchor ----
echo "---- Anchor 0.30.1 via avm ----"
echo "(this step compiles Rust — expect 5-10 minutes)"
if ! command -v avm >/dev/null 2>&1; then
  echo "Installing avm..."
  cargo install --git https://github.com/coral-xyz/anchor avm --tag v0.30.1 --force 2>&1 | tail -30
fi
if ! command -v avm >/dev/null 2>&1; then
  echo "FATAL: avm install failed."
  read -p "Press Return to close..."
  exit 1
fi
echo "avm: $(avm --version)"

if ! command -v anchor >/dev/null 2>&1 || ! anchor --version 2>/dev/null | grep -q "0.30.1"; then
  echo "Installing anchor-cli 0.30.1 (long)..."
  avm install 0.30.1 2>&1 | tail -30
  avm use 0.30.1
fi
if command -v anchor >/dev/null 2>&1; then
  echo "anchor: $(anchor --version)"
else
  echo "FATAL: Anchor install failed."
  read -p "Press Return to close..."
  exit 1
fi
echo

# ---- Write PATH hint to user's shell profile ----
PROFILE="$HOME/.zprofile"
[ -n "$BASH_VERSION" ] && [ ! -f "$PROFILE" ] && PROFILE="$HOME/.bash_profile"
if ! grep -q "SCBC-HACKATHON-TRAXIS-PATH" "$PROFILE" 2>/dev/null; then
  cat >> "$PROFILE" <<'EOF'

# SCBC-HACKATHON-TRAXIS-PATH
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
EOF
  echo "Added Cargo + Solana to PATH in $PROFILE"
fi

echo
echo "======================================================"
echo "  Phase 2 DONE at $(date)"
echo "======================================================"
echo "Next: double-click 03-build-deploy.command"
echo
read -p "Press Return to close this window..."

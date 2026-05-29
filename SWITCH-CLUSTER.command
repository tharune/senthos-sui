#!/bin/bash
# SWITCH-CLUSTER.command
#
# Swap between devnet and testnet configurations in one command.
#
# Usage (from Finder — you can't pass args by double-clicking):
#   Rename the file to SWITCH-TO-TESTNET.command or SWITCH-TO-DEVNET.command
#   OR call from Terminal:  ./SWITCH-CLUSTER.command testnet
#                           ./SWITCH-CLUSTER.command devnet
#
# What it does:
#   1. Backs up current backend/.env and .env.local to .logs/
#   2. Copies backend/.env.<target>   → backend/.env
#   3. Copies .env.local.<target>     → .env.local
#   4. Kills anything running on :3000 and :3001 so the next RUN-*.command
#      picks up the new config cleanly.
#
# Expects these files to already exist (created once, filled with secrets):
#   - backend/.env.devnet
#   - backend/.env.testnet
#   - .env.local.devnet
#   - .env.local.testnet

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

# Target can come from argv OR from filename (SWITCH-TO-TESTNET.command).
SCRIPT_NAME="$(basename "$0")"
case "$SCRIPT_NAME" in
  *TESTNET*|*testnet*) TARGET="testnet" ;;
  *DEVNET*|*devnet*)   TARGET="devnet"  ;;
  *)
    TARGET="${1:-}"
    if [[ -z "$TARGET" ]]; then
      echo "Which cluster do you want to switch to?"
      echo "  1) devnet"
      echo "  2) testnet"
      read -r -p "Choice [1-2]: " choice
      case "$choice" in
        1) TARGET="devnet"  ;;
        2) TARGET="testnet" ;;
        *) echo "Invalid choice"; exit 1 ;;
      esac
    fi
    ;;
esac

case "$TARGET" in
  devnet|testnet) : ;;
  *) echo "Unknown target: $TARGET (expected devnet or testnet)"; exit 1 ;;
esac

echo "===================================================================="
echo "  Switching active cluster → $TARGET"
echo "===================================================================="
echo ""

mkdir -p .logs

# Check the target envs exist.
BACKEND_TARGET="backend/.env.$TARGET"
FRONTEND_TARGET=".env.local.$TARGET"

if [[ ! -f "$BACKEND_TARGET" ]]; then
  echo "❌ $BACKEND_TARGET not found."
  if [[ -f "backend/.env.$TARGET.example" ]]; then
    echo ""
    echo "First-time setup:"
    echo "   cp backend/.env.$TARGET.example $BACKEND_TARGET"
    echo "   # fill in secrets (Supabase URL + keys, Anthropic key, etc.)"
  fi
  exit 1
fi
if [[ ! -f "$FRONTEND_TARGET" ]]; then
  echo "❌ $FRONTEND_TARGET not found."
  if [[ -f ".env.local.$TARGET.example" ]]; then
    echo ""
    echo "First-time setup:"
    echo "   cp .env.local.$TARGET.example $FRONTEND_TARGET"
    echo "   # edit if needed (backend URL, RPC override, etc.)"
  fi
  exit 1
fi

# Back up current active files so we can roll back.
TS="$(date +%Y%m%d-%H%M%S)"
if [[ -f backend/.env ]]; then
  cp backend/.env ".logs/backend-env-before-$TARGET-$TS.bak"
  echo "• backed up backend/.env → .logs/backend-env-before-$TARGET-$TS.bak"
fi
if [[ -f .env.local ]]; then
  cp .env.local ".logs/env-local-before-$TARGET-$TS.bak"
  echo "• backed up .env.local → .logs/env-local-before-$TARGET-$TS.bak"
fi

# Swap.
cp "$BACKEND_TARGET" backend/.env
cp "$FRONTEND_TARGET" .env.local
echo "• $BACKEND_TARGET → backend/.env"
echo "• $FRONTEND_TARGET → .env.local"
echo ""

# Kill anything on the dev ports so the next RUN-* command picks up new env.
for port in 3000 3001; do
  if command -v lsof >/dev/null 2>&1; then
    PIDS="$(lsof -ti:$port 2>/dev/null || true)"
    if [[ -n "$PIDS" ]]; then
      echo "• killing stale PIDs on :$port — $PIDS"
      kill -9 $PIDS 2>/dev/null || true
    fi
  fi
done

# Print a quick summary of the active solana config.
CLUSTER_ENV="$(grep -E '^SOLANA_CLUSTER=' backend/.env | cut -d= -f2- || echo '(not set)')"
RPC_ENV="$(grep -E '^SOLANA_RPC_URL=' backend/.env | cut -d= -f2- || echo '(not set)')"
USDC_ENV="$(grep -E '^USDC_MINT=' backend/.env | cut -d= -f2- || echo '(not set)')"
echo ""
echo "Active backend/.env:"
echo "  SOLANA_CLUSTER = $CLUSTER_ENV"
echo "  SOLANA_RPC_URL = $RPC_ENV"
echo "  USDC_MINT      = $USDC_ENV"
echo ""
echo "✓ Switched to $TARGET."
echo ""
echo "Next:"
echo "  - Restart backend:  ./RUN-BACKEND.command"
echo "  - Restart frontend: ./RUN-FRONTEND.command"
if [[ "$TARGET" == "testnet" ]]; then
  echo "  - Switch Phantom to Testnet Mode (Settings → Developer Settings)"
fi
echo ""
read -r -p "Press ENTER to close..."

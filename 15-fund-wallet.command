#!/bin/bash
# Phase 15: Fund the devnet deploy wallet.
#
# Phase-14 deploys cost ~5 SOL total (vault upgrade ~2.5 + PPN deploy ~2.5).
# The devnet CLI faucet rate-limits after ~2 requests/day/IP. If this script's
# airdrops fail, use https://faucet.solana.com/ in your browser (it has a
# separate rate-limit pool) — paste your wallet address shown below.

set +e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

clear
echo "=================================================="
echo " Phase 15: Fund devnet wallet for deploy"
echo "=================================================="

solana config set --url https://api.devnet.solana.com >/dev/null

WALLET=$(solana address)
echo "Wallet: $WALLET"
echo "Current balance: $(solana balance)"
echo

echo "---- Requesting 4 airdrops of 2 SOL each (separated by 10s) ----"
for i in 1 2 3 4; do
  echo
  echo ">> Airdrop attempt $i"
  solana airdrop 2 2>&1 | tail -4
  sleep 10
  BAL=$(solana balance | awk '{print $1}')
  echo "   balance now: ${BAL} SOL"
  if awk "BEGIN {exit !($BAL >= 5)}"; then
    echo "   ready — balance >= 5 SOL"
    break
  fi
done

echo
FINAL_BAL=$(solana balance | awk '{print $1}')
echo "---- Final balance: ${FINAL_BAL} SOL ----"
if awk "BEGIN {exit !($FINAL_BAL < 5)}"; then
  echo
  echo "Balance is below 5 SOL. The CLI faucet rate-limit is hit."
  echo "Use the WEB faucet: https://faucet.solana.com/"
  echo "Your wallet: $WALLET"
  echo "Request 2 SOL at a time until balance >= 5 SOL, then"
  echo "run 14-deploy-devnet.command."
else
  echo "Ready to deploy — re-run 14-deploy-devnet.command now."
fi

echo
read -p "Press Return..."

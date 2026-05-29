#!/bin/bash
# Traxis Phase 1: environment + toolchain check.
# Safe to run — read-only, no installs, no deployments.
set +e
cd "$(dirname "$0")"
clear
echo "=================================================="
echo "  Traxis onchain setup — Phase 1: environment    "
echo "=================================================="
echo "Date: $(date)"
echo "Dir : $(pwd)"
echo
echo "---- Git ----"
git status --short
echo
echo "---- Toolchain (✓ = installed) ----"
for CMD in node npm rustc cargo solana anchor avm; do
  if command -v "$CMD" >/dev/null 2>&1; then
    V=$("$CMD" --version 2>&1 | head -1)
    printf "  ✓ %-8s %s\n" "$CMD" "$V"
  else
    printf "  ✗ %-8s NOT INSTALLED\n" "$CMD"
  fi
done
echo
echo "---- Solana config ----"
if command -v solana >/dev/null 2>&1; then
  solana config get 2>&1 | sed 's/^/  /'
  echo "  Balance: $(solana balance 2>&1)"
else
  echo "  (skipped — solana CLI not installed yet)"
fi
echo
echo "---- Existing env files ----"
if [ -f backend/.env ]; then
  echo "  backend/.env exists. Keys present:"
  grep -oE "^(TRAXIS_VAULT_PROGRAM_ID|TRAXIS_PPN_PROGRAM_ID|SOLANA_RPC_URL|USDC_MINT|FEE_RECIPIENT|AUTHORITY_KEYPAIR|SUPABASE_URL|HELIUS_API_KEY)=" backend/.env | sed 's/^/    /'
else
  echo "  backend/.env does NOT exist"
fi
echo
echo "---- Onchain files present (should all be ✓) ----"
for F in programs/traxis_vault/src/lib.rs programs/traxis_ppn/src/lib.rs programs/traxis_vault/src/instructions/deposit.rs programs/traxis_ppn/src/instructions/harvest_yield.rs Anchor.toml Cargo.toml ONCHAIN.md SECURITY.md backend/src/solana/anchor.ts backend/src/solana/client.ts backend/src/services/onchain-bridge.ts backend/src/db/schema_onchain.sql tests/traxis_vault.test.ts scripts/deploy-devnet.sh; do
  if [ -f "$F" ]; then
    SIZE=$(wc -c <"$F" | tr -d ' ')
    printf "  ✓ %-70s %s bytes\n" "$F" "$SIZE"
  else
    printf "  ✗ %-70s MISSING\n" "$F"
  fi
done
echo
echo "=================================================="
echo "  Done. Close this window when you're ready.     "
echo "=================================================="

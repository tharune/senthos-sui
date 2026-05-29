#!/bin/bash
# FIX-VAULTS.command — backfill the `initialize_vault_tokens` step for every
# bundle whose vault PDA exists on-chain but whose TRAX mint + USDC vault
# don't. Fixes the "Unexpected error" buy flow.
#
# Must run from the `backend/` directory so node_modules resolves correctly
# (scripts/init-vault-tokens-backfill.ts imports @solana/* and backend deps).
set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "--- Backfill initialize_vault_tokens for STHS bundles ---"
echo ""

cd "$REPO_ROOT/backend"

# Export KEY=VALUE from .env so the tsx child inherits ANTHROPIC_API_KEY,
# AUTHORITY_KEYPAIR, SUPABASE_URL, etc.
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

# Resolve ~ in AUTHORITY_KEYPAIR if it's set as a path.
if [[ -n "${AUTHORITY_KEYPAIR:-}" && "${AUTHORITY_KEYPAIR:0:1}" == "~" ]]; then
  AUTHORITY_KEYPAIR="${HOME}${AUTHORITY_KEYPAIR:1}"
  export AUTHORITY_KEYPAIR
fi

echo "Authority keypair: ${AUTHORITY_KEYPAIR:-(unset)}"
echo "RPC:               ${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
echo "Vault program:     ${TRAXIS_VAULT_PROGRAM_ID:-(unset)}"
echo ""

npx --yes tsx ../scripts/init-vault-tokens-backfill.ts
EXIT_CODE=$?

echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  echo "✅ Done. Refresh the basket page and retry buy."
else
  echo "⚠️  Script exited with code $EXIT_CODE — scroll up for errors."
fi
echo ""
read -r -p "Press ENTER to close this window..."

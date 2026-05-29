#!/bin/bash
# RESET-CLUSTER-STATE.command
#
# Wipe cluster-scoped Supabase rows (ppn_vaults, positions) and null out
# on-chain address columns on bundles/legs/transactions so the app can be
# re-seeded on a different Solana cluster.
#
# Run AFTER ./SWITCH-CLUSTER.command <target> has swapped your .env files,
# so this script uses the Supabase creds for the cluster you're switching to.
#
# Requires: SUPABASE_SERVICE_ROLE_KEY in backend/.env (copy from Supabase
# Dashboard → Project Settings → API → service_role).

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

# Sanity: make sure root deps are installed (for @supabase/supabase-js
# to resolve from node_modules for the scripts/ dir, it's fine — scripts
# import it via the backend node_modules chain via tsx).
if [[ ! -d backend/node_modules/@supabase/supabase-js ]]; then
  echo "• Installing backend deps first..."
  (cd backend && npm install) || exit 1
fi
if [[ ! -d node_modules ]] || [[ ! -d node_modules/tsx ]]; then
  echo "• Installing root deps (tsx missing)..."
  npm install || exit 1
fi

echo "===================================================================="
echo "  RESET-CLUSTER-STATE"
echo "===================================================================="
echo ""
echo "This wipes ppn_vaults + positions and clears on-chain pointers on"
echo "bundles/legs. Bundle definitions (names, legs, risk tiers) stay."
echo ""

npx tsx scripts/reset-cluster-state.ts
RC=$?

echo ""
if [[ $RC -eq 0 ]]; then
  echo "✓ Reset complete."
else
  echo "❌ Reset failed with exit code $RC."
fi

read -r -p "Press ENTER to close..."
exit $RC

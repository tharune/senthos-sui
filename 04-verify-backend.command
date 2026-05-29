#!/bin/bash
# Phase 4: verify the backend installs and typechecks with the REAL
# @solana/web3.js, @coral-xyz/anchor, @solana/spl-token packages
# (unreachable from my sandbox, reachable from your Mac).
set +e
cd "$(dirname "$0")/backend"
clear
echo "================================================="
echo " Phase 4: backend npm install + typecheck       "
echo "================================================="
echo

echo "---- npm install ----"
npm install 2>&1 | tail -20
echo

echo "---- npx tsc --noEmit ----"
npx tsc --noEmit 2>&1 | tail -40
TSC_EXIT=$?

echo
if [ $TSC_EXIT -eq 0 ]; then
  echo "✓ Backend typechecks cleanly."
else
  echo "Typecheck found issues (above)."
fi
echo
read -p "Press Return..."

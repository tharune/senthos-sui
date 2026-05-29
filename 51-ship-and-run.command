#!/bin/bash
# 51-ship-and-run.command
# Finalize the STHS-bundles + composer-key work:
#   1. Clean any stale .git/index.lock left by the sandbox.
#   2. Push local main (already has commit b05df29) to origin.
#   3. Initialize on-chain vaults for the 9 new STHS-* bundles.
#   4. Open RUN-BACKEND.command and RUN-FRONTEND.command in fresh Terminal windows.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

echo ""
echo "================================================================"
echo "  STEP 1 — Clear stale git lock (if any) and show local status"
echo "================================================================"
rm -f .git/index.lock .git/HEAD.lock .git/refs/heads/main.lock 2>/dev/null || true
git status --short || true
git log --oneline -3 || true

echo ""
echo "================================================================"
echo "  STEP 2 — Push main to origin"
echo "================================================================"
git push origin main
PUSH_RC=$?
if [[ $PUSH_RC -ne 0 ]]; then
  echo ""
  echo "❌ git push failed (exit $PUSH_RC). Fix auth then re-run."
  read -r -p "Press ENTER to close..."
  exit $PUSH_RC
fi
echo "✓ pushed"

echo ""
echo "================================================================"
echo "  STEP 3 — Initialize on-chain vaults for 9 STHS-* bundles"
echo "================================================================"
if [[ -x ./21-init-onchain-vaults.command ]]; then
  # Run it in-line (not as a new window) so we see the output here.
  ./21-init-onchain-vaults.command || {
    echo "⚠️ vault init returned non-zero; review above."
  }
else
  echo "21-init-onchain-vaults.command missing — falling back to direct call"
  npx --yes tsx scripts/init-demo-vaults.ts
fi

echo ""
echo "================================================================"
echo "  STEP 4 — Launch backend + frontend in fresh Terminal windows"
echo "================================================================"
# Kill anything already holding ports 3001 (backend) and 3000 (frontend)
lsof -ti:3001 | xargs -r kill -9 2>/dev/null || true
lsof -ti:3000 | xargs -r kill -9 2>/dev/null || true

open "$REPO_ROOT/RUN-BACKEND.command"
sleep 1
open "$REPO_ROOT/RUN-FRONTEND.command"

echo ""
echo "✅ Done. Backend (3001) and Frontend (3000) launching in new windows."
echo "   Open http://localhost:3000 once the frontend prints 'Ready'."
echo ""
read -r -p "Press ENTER to close this window..."

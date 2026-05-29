#!/bin/bash
# PUSH-FIX.command — push any locally-committed fixes to origin/main.
# Currently this pushes the portfolio-tab fix (wallet gating + honest
# residual P&L + disconnect sweep). Safe to rerun — it just pushes
# whatever's ahead of origin.
set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "--- Pushing to origin/main ---"
echo ""
echo "Commits that will be pushed:"
git log --oneline origin/main..HEAD || true
echo ""
git push origin main
echo ""
echo "✅ Pushed. You can close this window."
read -r -p "Press ENTER to close..."

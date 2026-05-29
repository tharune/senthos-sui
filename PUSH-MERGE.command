#!/bin/bash
# ------------------------------------------------------------------------------
# PUSH-MERGE.command
#
# The merge commit (958ea97 "merge: alex-ui — UI polish, nav rename, tier-label
# cleanup") is already on your local main. This just pushes it.
#
# Run from Finder by double-clicking, or:
#   bash PUSH-MERGE.command
# ------------------------------------------------------------------------------

set -e
cd "$(dirname "$0")"

echo "==> Cleanup stale lock crud from prior sandbox sessions"
find .git -name "*.lock.gone*" -type f -print -delete 2>/dev/null || true
find .git -name "*.lock" -size 0 -type f -print -delete 2>/dev/null || true

echo
echo "==> Local main log:"
git log --oneline -5

echo
echo "==> Push to origin/main"
git push origin main

echo
echo "==> Done. Merge commit is now on origin/main."

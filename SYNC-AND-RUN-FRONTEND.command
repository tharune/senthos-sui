#!/bin/bash
# SYNC-AND-RUN-FRONTEND.command
# Fetches latest main (Tharun's newest commits), fast-forwards, wipes caches, starts dev server.
set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

echo "--- SYNC + RUN FRONTEND ---"
echo ""
echo "[1/7] Clearing any stale git lock..."
rm -f .git/index.lock .git/ORIG_HEAD.lock 2>/dev/null || true

echo "[2/7] Stashing ALL tracked modifications (safe to pop later)..."
git stash push -m "auto-sync $(date +%H%M%S)" 2>/dev/null || true

echo "[2b/7] Moving aside untracked files that collide with origin/main..."
mkdir -p _pre-main-sync-backup
for f in app/app/_lib/demo-state.tsx app/app/layout.tsx; do
  if [ -e "$f" ] && git cat-file -e "origin/main:$f" 2>/dev/null; then
    echo "    backing up: $f"
    mkdir -p "_pre-main-sync-backup/$(dirname "$f")"
    mv "$f" "_pre-main-sync-backup/$f" 2>/dev/null || true
  fi
done
if [ -d app/app/portfolio ] && git ls-tree origin/main app/app/portfolio/ 2>/dev/null | grep -q .; then
  echo "    backing up: app/app/portfolio/"
  mv app/app/portfolio "_pre-main-sync-backup/app_app_portfolio_dir" 2>/dev/null || true
fi

echo "[3/7] Fetching latest from GitHub..."
git fetch origin main

echo "[4/7] Fast-forwarding to origin/main..."
if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  git merge --ff-only origin/main
  echo "    fast-forwarded."
else
  echo "    HEAD is NOT ancestor of main — a merge would be needed. Stopping."
  echo "    Current: $(git rev-parse --short HEAD)   Main: $(git rev-parse --short origin/main)"
  exit 1
fi

echo "[5/7] Clearing .next Turbopack cache..."
rm -rf .next

echo "[6/7] Killing any process on :3000..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

echo "[7/7] Starting Next.js dev server..."
echo ""
git log --oneline -3
echo ""
exec npm run dev

#!/bin/bash
# RESTART-BACKEND.command — kill everything on :3001 and relaunch the
# backend with a freshly-sourced .env so ANTHROPIC_API_KEY and friends
# take effect. Use this when the composer says "ANTHROPIC_API_KEY not
# set" even though backend/.env has the key.
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "--- Restarting Senthos backend ---"

# 1. Kill everything on :3001 (tsx, node, nodemon, whatever).
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti:3001 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "Killing :3001 PIDs — $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
fi
# 2. Belt-and-suspenders: also kill tsx watchers for our backend entry.
pkill -9 -f "tsx.*backend/src/index" 2>/dev/null || true
pkill -9 -f "npm.*run.*dev.*backend" 2>/dev/null || true

sleep 1

# 3. Launch RUN-BACKEND.command in a NEW Terminal window so logs are clean.
open -a Terminal "$REPO_ROOT/RUN-BACKEND.command"

echo ""
echo "✅ Old backend killed, new one starting in a fresh Terminal window."
echo "   Wait ~3 s then refresh the Portfolio page."
echo ""
read -r -p "Press ENTER to close this window..."

#!/bin/bash
# RUN-FRONTEND.command — Next.js frontend on localhost:3000.
# Wipes .next Turbopack cache before starting so stale native-binary resolution errors go away.
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1
echo "--- Senthos frontend dev (port 3000) ---"
echo "Clearing .next Turbopack cache..."
rm -rf .next
echo "Killing any process on :3000..."
lsof -ti :3000 | xargs kill -9 2>/dev/null
echo "Starting Next.js dev server..."
exec npm run dev

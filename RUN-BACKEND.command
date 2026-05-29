#!/bin/bash
# RUN-BACKEND.command — start Senthos backend on port 3001 with env
# variables explicitly exported from backend/.env so every process
# (including the tsx child watcher) inherits them. Previously we
# relied on dotenv.config() inside the backend, which works but
# fails silently if a stale backend is already holding the port.
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT/backend" || exit 1

# Free port 3001 if something else is holding it.
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti:3001 2>/dev/null || true)"
  if [[ -n "$PIDS" ]]; then
    echo "Killing stale PIDs on :3001 — $PIDS"
    kill -9 $PIDS 2>/dev/null || true
  fi
fi

# Export every KEY=VALUE in .env so children inherit them.
if [[ -f .env ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
  if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
    echo "✓ ANTHROPIC_API_KEY loaded (ends …${ANTHROPIC_API_KEY: -6})"
  else
    echo "⚠️  ANTHROPIC_API_KEY missing from backend/.env"
  fi
fi

echo "--- Senthos backend dev (port 3001) ---"
exec npm run dev

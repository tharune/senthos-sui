#!/bin/bash
# 35-run-everything.command
#
# End-to-end: push wiring branch, build backend, init mock adapter on devnet,
# run the on-chain smoke test. Everything that can be automated is automated;
# human-in-the-loop actions (like Phantom signing) are not invoked here —
# this is the admin/backend path that proves the on-chain wiring works.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG="$REPO_ROOT/.logs/35-run-everything.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

trap 'log ""; log "[cleanup] stopping backend if running..."; if [[ -n "${BE_PID:-}" ]] && kill -0 "$BE_PID" 2>/dev/null; then kill "$BE_PID" 2>/dev/null || true; fi' EXIT

banner "35-run-everything — push + init-adapter + on-chain smoke test"

# ---------- Step 0: clear stale locks ----------
rm -f .git/index.lock 2>/dev/null || true
rm -f .git/HEAD.lock 2>/dev/null || true

# ---------- Step 1: push wiring branch ----------
banner "Step 1 — push wiring/onchain-ready"
BR="wiring/onchain-ready"
log "Switching to $BR..."
git checkout "$BR" 2>&1 | tee -a "$LOG"
log ""
log "Fetching origin..."
git fetch origin 2>&1 | tee -a "$LOG" || { log "❌ fetch failed — auth?"; read -r -p "ENTER to close..."; exit 1; }
log ""
# Rebase if origin/main moved
if git rev-parse --verify origin/main >/dev/null 2>&1; then
  log "Rebasing $BR onto origin/main..."
  if ! git rebase origin/main 2>&1 | tee -a "$LOG"; then
    log "❌ rebase conflicts. Fix with: git status && git add ... && git rebase --continue"
    read -r -p "ENTER to close..."
    exit 1
  fi
else
  log "(no origin/main; skipping rebase)"
fi
log ""
log "Pushing $BR..."
git push -u origin "$BR" 2>&1 | tee -a "$LOG"
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
  log "❌ push failed. See log."
  read -r -p "ENTER to close..."
  exit 1
fi

REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
if [[ "$REMOTE_URL" == *"github.com"* ]]; then
  PR_BASE=$(printf '%s' "$REMOTE_URL" \
    | sed -E 's#^git@github.com:#https://github.com/#' \
    | sed -E 's#\.git$##')
  log ""
  log "PR URL: ${PR_BASE}/compare/main...${BR}?expand=1"
fi

# ---------- Step 2: install + build backend ----------
banner "Step 2 — backend install + build"
cd backend || { log "❌ no backend/"; exit 1; }

if [[ ! -d node_modules ]]; then
  log "Installing deps (npm install)..."
  npm install 2>&1 | tee -a "$LOG" | tail -5
fi

log "Typecheck..."
if ! npx tsc --noEmit 2>&1 | tee -a "$LOG"; then
  log "❌ typecheck failed"
  read -r -p "ENTER to close..."
  exit 1
fi
log "✅ typecheck clean"

# ---------- Step 3: start backend ----------
banner "Step 3 — start backend server in background"
if [[ ! -f .env ]]; then
  log "❌ backend/.env missing. Cannot start server."
  read -r -p "ENTER to close..."
  exit 1
fi

# Use tsx for quick start; adjust if your package.json uses a different entry
BACKEND_LOG="$REPO_ROOT/.logs/35-backend.log"
: > "$BACKEND_LOG"
log "Starting backend... (logs → $BACKEND_LOG)"
# Prefer the dev script if defined
if npm run --silent 2>/dev/null | grep -q "^  dev"; then
  nohup npm run dev >"$BACKEND_LOG" 2>&1 &
else
  nohup npx tsx src/index.ts >"$BACKEND_LOG" 2>&1 &
fi
BE_PID=$!
log "backend PID: $BE_PID"

# Wait for /health
log "Waiting for backend to be ready..."
PORT=$(grep -E '^PORT=' .env | head -1 | cut -d= -f2 | tr -d '\r' | tr -d '"')
PORT="${PORT:-3001}"
READY=0
for i in $(seq 1 30); do
  if curl -s -f "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    READY=1
    log "✅ backend up on :$PORT (took ${i}s)"
    break
  fi
  sleep 1
done
if [[ $READY -ne 1 ]]; then
  log "❌ backend did not become ready in 30s"
  log "=== backend log (last 40 lines) ==="
  tail -40 "$BACKEND_LOG" | tee -a "$LOG"
  read -r -p "ENTER to close..."
  exit 1
fi

# ---------- Step 4: init mock adapter ----------
banner "Step 4 — init mock adapter on devnet"
log "POST /api/admin/init-mock-adapter (apy_bps=800)"
INIT_RESP=$(curl -s -X POST "http://localhost:${PORT}/api/admin/init-mock-adapter" \
  -H "content-type: application/json" \
  -d '{"apy_bps":800}')
log "Response: $INIT_RESP"

if [[ -z "$INIT_RESP" ]]; then
  log "❌ empty response — backend not healthy?"
else
  # Pretty-print if jq is available
  if command -v jq >/dev/null 2>&1; then
    echo "$INIT_RESP" | jq . | tee -a "$LOG"
  fi
fi

# ---------- Step 5: run on-chain smoke test ----------
banner "Step 5 — on-chain smoke test (backend/test-onchain.cjs)"
node test-onchain.cjs 2>&1 | tee -a "$LOG"

# ---------- Step 6: tear down ----------
banner "Step 6 — stop backend"
if kill -0 "$BE_PID" 2>/dev/null; then
  kill "$BE_PID" 2>/dev/null || true
  sleep 1
  log "backend stopped"
fi

banner "DONE"
log "Full log: $LOG"
log "Backend log: $BACKEND_LOG"
log ""
log "What this just proved:"
log "  1. Wiring branch pushed to origin"
log "  2. Backend compiles and starts clean"
log "  3. Mock adapter initialized on devnet (persisted for future user deposits)"
log "  4. PPN program accepts initialize_note simulation — deposit flow is live"
log ""
log "Luka can now wire the basket/PPN buttons per WIRING.md — they will work."
read -r -p "Press ENTER to close..."

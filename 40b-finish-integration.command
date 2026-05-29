#!/bin/bash
# 40b-finish-integration.command
#
# Recovery script: 40-integrate.command ran successfully through steps 1–5
# (abort-rebase, stash, fetch, reset to origin/Tharun-changes, overlay wiring
# backend files, pop stash). It failed at step 6 because the commit message
# heredoc had a bash quoting bug.
#
# The working tree already holds the fully integrated state — we just need
# to COMMIT it and TYPECHECK. That's what this script does.
#
# If you ran the fixed 40-integrate.command and everything worked, you don't
# need this script — 40-integrate already commits + typechecks on its own.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/40b-finish.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "40b-finish-integration — commit + typecheck"

# Sanity: must be on integration/full-wiring.
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
log "Current branch: $CURRENT_BRANCH"
if [ "$CURRENT_BRANCH" != "integration/full-wiring" ]; then
  log ""
  log "⚠️  Not on integration/full-wiring. Switching..."
  if git show-ref --verify --quiet refs/heads/integration/full-wiring; then
    git checkout integration/full-wiring 2>&1 | tee -a "$LOG"
  else
    log "❌ integration/full-wiring does not exist. Run 40-integrate.command first."
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi

# --- 1. Stage + commit ---
log ""
log "[step 1] Stage + commit the integration state"
git add -A 2>&1 | tee -a "$LOG"
if ! git diff --cached --quiet; then
  MSGFILE="$(mktemp -t integrate-msg)"
  cat >"$MSGFILE" <<'COMMIT_MSG'
integration: Tharun-changes + wiring/onchain-ready + tranche/lending/real-USDC

Rebuild integration/full-wiring as a clean blend of:
  - origin/Tharun-changes: live-polymarket baskets, responsive detail chart,
    wallet-connect UI and the vault BPF-stack-overflow fix from main
  - origin/wiring/onchain-ready: backend PPN/deposit/admin routes, Anchor
    client helpers, lending program scaffold, smoke-test scripts
  - Claude follow-up:
      - backend/src/routes/tranches.ts: prepare/confirm/user endpoints
      - backend/src/services/tranching.ts already existed; reused here
      - backend/src/db/schema_tranche.sql: tranche_kind/attach/detach/price
      - backend/test-real-usdc.cjs + 38-real-usdc-test.command: REAL devnet
        deposit test that prints a Solscan URL to verify on-chain movement
      - programs/traxis_lending: errors + checked-arith cleanup

Next: run 38-real-usdc-test.command to verify USDC actually moves on-chain,
then 41-merge-main.command to merge to main.
COMMIT_MSG
  git commit -F "$MSGFILE" 2>&1 | tee -a "$LOG"
  RC_COMMIT=${PIPESTATUS[0]}
  rm -f "$MSGFILE"
  if [ "${RC_COMMIT:-1}" != "0" ]; then
    log "❌ commit failed — see output above"
    read -r -p "Press ENTER to close..."
    exit 1
  fi
  log "  ✅ commit created"
else
  log "  (nothing staged — integration is already committed)"
fi

# Show the last commit for sanity.
log ""
log "Last commit:"
git log -1 --oneline 2>&1 | tee -a "$LOG"

# --- 2. Typecheck the backend ---
log ""
log "[step 2] Typecheck backend"
cd backend || { log "❌ no backend/"; exit 1; }
if [ ! -d node_modules ]; then
  log "  installing deps..."
  npm install 2>&1 | tee -a "$LOG"
fi
if npx tsc --noEmit 2>&1 | tee -a "$LOG"; then
  log "  ✅ typecheck passed"
  RC_TYPECHECK=0
else
  log "  ❌ typecheck failed — fix errors above before merging to main"
  RC_TYPECHECK=1
fi
cd "$REPO_ROOT" || true

log ""
banner "DONE"
log "Integration branch: integration/full-wiring"
log "Log: $LOG"
log ""
if [ "${RC_TYPECHECK:-1}" = "0" ]; then
  log "✅ GREEN — ready to proceed:"
  log "  1. ./38-real-usdc-test.command    # real USDC deposit, check Solscan URL"
  log "  2. ./41-merge-main.command        # merge integration → main (only if green)"
else
  log "🛑 RED — fix typecheck errors first."
fi
log ""
read -r -p "Press ENTER to close..."

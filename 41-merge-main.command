#!/bin/bash
# 41-merge-main.command
#
# Merge `integration/full-wiring` into `main` and push. Run ONLY after:
#   1. 40-integrate.command succeeded (backend typechecks)
#   2. 38-real-usdc-test.command passed (real USDC moved on-chain; Solscan
#      URL is clickable)
#
# This script:
#   - Confirms the integration branch typechecks cleanly
#   - Merges integration/full-wiring into main (no-ff so the merge commit
#     records the integration rationale)
#   - Pushes main
#   - Pushes the integration branch as a backup
#
# It does NOT force-push. If main has moved, it will stop so you can resolve.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "❌ bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/41-merge-main.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "41-merge-main"

# --- 1. Safety gate: confirm real-USDC test was run ---
log ""
log "Before merging to main, you need to have:"
log "  1. Run 38-real-usdc-test.command"
log "  2. Clicked the Solscan URL and seen 1 USDC actually move"
log ""
read -r -p "Has the real-USDC test passed and Solscan confirmed? [y/N] " ANS
if [ "$ANS" != "y" ] && [ "$ANS" != "Y" ]; then
  log "Bailing. Run 38-real-usdc-test.command first."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# --- 2. Verify no uncommitted changes ---
log ""
log "[step 1] Verify clean working tree"
if [ -n "$(git status --porcelain)" ]; then
  log "❌ Working tree has uncommitted changes. Commit or stash first."
  git status --short 2>&1 | tee -a "$LOG"
  read -r -p "Press ENTER to close..."
  exit 1
fi
log "  ✅ clean"

# --- 3. Checkout integration, typecheck one more time ---
log ""
log "[step 2] Checkout integration/full-wiring + typecheck"
git checkout integration/full-wiring 2>&1 | tee -a "$LOG" || {
  log "❌ integration/full-wiring not found. Run 40-integrate.command first."
  read -r -p "Press ENTER to close..."
  exit 1
}
cd backend || { log "❌ no backend/"; exit 1; }
if ! npx tsc --noEmit 2>&1 | tee -a "$LOG"; then
  log "❌ typecheck failed — aborting merge"
  read -r -p "Press ENTER to close..."
  exit 1
fi
log "  ✅ typecheck passed"
cd "$REPO_ROOT" || true

# --- 4. Fetch main and check it hasn't moved past us ---
log ""
log "[step 3] Fetch origin/main + verify integration descends from it"
git fetch origin main 2>&1 | tee -a "$LOG"

MERGE_BASE="$(git merge-base integration/full-wiring origin/main)"
ORIGIN_MAIN="$(git rev-parse origin/main)"
if [ "$MERGE_BASE" != "$ORIGIN_MAIN" ]; then
  log ""
  log "⚠️  main has moved since integration was built. New commits on main:"
  git log --oneline "$MERGE_BASE..origin/main" 2>&1 | tee -a "$LOG"
  log ""
  log "You should re-run 40-integrate.command to pull them in before merging."
  read -r -p "Continue anyway and merge main → integration first? [y/N] " ANS
  if [ "$ANS" != "y" ] && [ "$ANS" != "Y" ]; then
    read -r -p "Press ENTER to close..."
    exit 1
  fi
  git merge origin/main --no-edit 2>&1 | tee -a "$LOG" || {
    log "❌ merge failed — resolve conflicts manually and rerun"
    read -r -p "Press ENTER to close..."
    exit 1
  }
fi

# --- 5. Merge integration → main ---
log ""
log "[step 4] Checkout main + merge integration/full-wiring"
git checkout main 2>&1 | tee -a "$LOG" || {
  log "❌ cannot checkout main"
  read -r -p "Press ENTER to close..."
  exit 1
}
git pull --ff-only origin main 2>&1 | tee -a "$LOG" || true

MERGE_MSGFILE="$(mktemp -t merge-msg)"
cat >"$MERGE_MSGFILE" <<'MERGE_MSG'
Merge integration/full-wiring: Tharun UI + wiring backend + tranche/lending

Includes:
  - Tharun's live Polymarket baskets, responsive detail chart, wallet-connect UI
  - Vault BPF-stack-overflow fix from main
  - Backend PPN on-chain prepare/confirm routes + Anchor client helpers
  - Lending program scaffold + error code cleanup
  - Tranche backend: POST /api/tranches/prepare|confirm, GET /user/:wallet
  - schema_tranche.sql overlay (non-destructive)
  - backend/test-real-usdc.cjs proof-of-movement test
  - Command scripts for build, deploy, integrate, test, merge
MERGE_MSG
if ! git merge --no-ff integration/full-wiring -F "$MERGE_MSGFILE" 2>&1 | tee -a "$LOG"; then
  rm -f "$MERGE_MSGFILE"
  log "❌ merge failed"
  log "   Resolve conflicts manually, commit, then push main."
  read -r -p "Press ENTER to close..."
  exit 1
fi
rm -f "$MERGE_MSGFILE"

# --- 6. Push ---
log ""
log "[step 5] Push main + integration branch"
git push origin main 2>&1 | tee -a "$LOG" || {
  log "❌ push failed"
  read -r -p "Press ENTER to close..."
  exit 1
}
git push origin integration/full-wiring 2>&1 | tee -a "$LOG" || true

log ""
banner "✅ MERGED TO MAIN"
log "Next: trigger backend redeploy (Railway / Docker) to pick up the new"
log "      routes + schema. Run backend/src/db/schema_tranche.sql in Supabase"
log "      SQL editor to add the tranche_kind columns."
log ""
log "Log: $LOG"
read -r -p "Press ENTER to close..."

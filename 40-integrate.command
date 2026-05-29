#!/bin/bash
# 40-integrate.command
#
# Build a clean `integration/full-wiring` branch that contains:
#   - origin/Tharun-changes (latest frontend + main's vault fix)
#   - backend wiring files from origin/wiring/onchain-ready
#     (backend/src/routes/{admin,ppn}.ts, solana/client.ts, services/solana.ts,
#      db/queries.ts, types/index.ts, schema_ppn_onchain.sql, test-onchain.cjs,
#      programs/traxis_lending/, WIRING.md, all 3x-*.command scripts)
#   - Claude's new tranche backend + lending fixes + real-USDC test
#     (already in the working tree as uncommitted edits — this script stages
#      and commits them as part of the integration)
#
# Run this BEFORE 38-real-usdc-test.command and BEFORE merging to main.
#
# Flow:
#   1. Abort any in-progress rebase/merge on the repo.
#   2. Stash uncommitted changes (Claude's new tranche/lending/test work).
#   3. Fetch origin and reset `integration/full-wiring` to `origin/Tharun-changes`.
#   4. Checkout the wiring backend files + new program scaffolds from
#      `origin/wiring/onchain-ready` on top.
#   5. Pop the stash → re-applies Claude's new changes on top of the blend.
#   6. Commit the combined state on integration/full-wiring.
#   7. Run backend typecheck to confirm nothing is broken.
#
# After this completes, run 38-real-usdc-test.command to verify USDC moves
# on devnet, then 41-merge-main.command to merge into main (only if green).

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "❌ bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/40-integrate.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "40-integrate — build integration/full-wiring"

# --- 1. Clean up any in-progress git op ---
log ""
log "[step 1] Clean any in-progress rebase / merge"
if [ -d ".git/rebase-merge" ] || [ -d ".git/rebase-apply" ]; then
  log "  rebase in progress — aborting"
  git rebase --abort 2>&1 | tee -a "$LOG" || true
fi
if [ -f ".git/MERGE_HEAD" ]; then
  log "  merge in progress — aborting"
  git merge --abort 2>&1 | tee -a "$LOG" || true
fi
if [ -f ".git/index.lock" ]; then
  log "  stale index.lock — removing"
  rm -f .git/index.lock
fi

# --- 2. Stash any uncommitted work (Claude's new changes) ---
log ""
log "[step 2] Stash current working-tree changes"
STASH_NAME="integration-stash-$(date +%s)"
# `git stash -u` includes untracked files too
if git diff --quiet HEAD && [ -z "$(git status --porcelain)" ]; then
  log "  nothing to stash"
  STASHED=0
else
  git stash push -u -m "$STASH_NAME" 2>&1 | tee -a "$LOG"
  STASHED=1
fi

# --- 3. Fetch + reset integration branch to Tharun's latest ---
log ""
log "[step 3] Fetch origin + reset integration/full-wiring to origin/Tharun-changes"
git fetch origin --prune 2>&1 | tee -a "$LOG" || {
  log "❌ fetch failed"
  read -r -p "Press ENTER to close..."
  exit 1
}

# Create or reset integration/full-wiring on top of Tharun-changes.
if git show-ref --verify --quiet refs/heads/integration/full-wiring; then
  git checkout integration/full-wiring 2>&1 | tee -a "$LOG"
  git reset --hard origin/Tharun-changes 2>&1 | tee -a "$LOG"
else
  git checkout -b integration/full-wiring origin/Tharun-changes 2>&1 | tee -a "$LOG"
fi

# --- 4. Overlay wiring backend + new programs/scripts ---
log ""
log "[step 4] Overlay wiring backend + program scaffolds + scripts"
#
# The following paths were developed on origin/wiring/onchain-ready and are
# zero-diff from the merge-base for Tharun's branch (verified earlier), so
# a straight checkout is a clean overlay. `programs/traxis_lending` and all
# new .command scripts are new-files-on-wiring (not present in Tharun-changes).
#
WIRING_PATHS=(
  "backend/src/routes/admin.ts"
  "backend/src/routes/ppn.ts"
  "backend/src/services/solana.ts"
  "backend/src/types/index.ts"
  "backend/src/db/queries.ts"
  "backend/src/db/schema_ppn_onchain.sql"
  "backend/src/solana/client.ts"
  "backend/test-onchain.cjs"
  "programs/traxis_lending"
  "WIRING.md"
)
for p in "${WIRING_PATHS[@]}"; do
  if git cat-file -e "origin/wiring/onchain-ready:$p" 2>/dev/null || \
     git ls-tree -r origin/wiring/onchain-ready -- "$p" | grep -q .; then
    log "  checkout $p"
    git checkout origin/wiring/onchain-ready -- "$p" 2>&1 | tee -a "$LOG"
  else
    log "  (skip missing $p)"
  fi
done

# Checkout every new .command script from wiring that isn't already on Tharun.
for f in $(git ls-tree -r --name-only origin/wiring/onchain-ready | grep -E '\.command$'); do
  if ! git cat-file -e "origin/Tharun-changes:$f" 2>/dev/null; then
    log "  checkout $f (new script from wiring)"
    git checkout origin/wiring/onchain-ready -- "$f" 2>&1 | tee -a "$LOG"
  fi
done

# --- 5. Pop stash to re-apply Claude's new tranche/lending/test work ---
log ""
log "[step 5] Pop stash to re-apply Claude's new changes"
if [ "$STASHED" = "1" ]; then
  if ! git stash pop 2>&1 | tee -a "$LOG"; then
    log ""
    log "⚠️  Stash pop had conflicts — inspect manually. The stash is still"
    log "   in \`git stash list\` so nothing is lost."
    read -r -p "Press ENTER to continue anyway..."
  fi
fi

# --- 6. Commit the combined state ---
log ""
log "[step 6] Stage + commit the integration state"
git add -A 2>&1 | tee -a "$LOG"
if ! git diff --cached --quiet; then
  # Write commit message to a temp file to avoid heredoc-in-$(…) quoting pitfalls.
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
  rm -f "$MSGFILE"
else
  log "  (nothing staged — working tree already matches integration target)"
fi

# --- 7. Typecheck the backend ---
log ""
log "[step 7] Typecheck backend"
cd backend || { log "❌ no backend/"; exit 1; }
if [ ! -d node_modules ]; then
  log "  installing deps..."
  npm install 2>&1 | tee -a "$LOG"
fi
if npx tsc --noEmit 2>&1 | tee -a "$LOG"; then
  log "  ✅ typecheck passed"
else
  log "  ❌ typecheck failed — fix errors above before merging to main"
  RC=1
fi
cd "$REPO_ROOT" || true

log ""
banner "DONE"
log "Integration branch: integration/full-wiring"
log "Log: $LOG"
log ""
log "Next steps on your Mac:"
log "  1. ./38-real-usdc-test.command    # real USDC deposit, check Solscan URL"
log "  2. ./41-merge-main.command        # merge integration → main (only if green)"
log ""
read -r -p "Press ENTER to close..."

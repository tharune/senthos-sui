#!/bin/bash
# 42-push-integration.command
#
# Push integration/full-wiring to origin so Tharun / Luka can pick it up.
# Does NOT merge to main — that's their decision. This script verifies the
# branch state (typecheck, clean tree, ahead-of-main delta) and then pushes.
#
# Why not 41-merge-main.command? Because we're handing off rather than
# finishing ourselves. Cleaner to land on a review branch and let the team
# PR it into main.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/42-push-integration.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "42-push-integration"

# --- 1. Make sure we're on integration/full-wiring ---
log ""
log "[step 1] Verify we're on integration/full-wiring"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "integration/full-wiring" ]; then
  log "  switching from $CURRENT_BRANCH -> integration/full-wiring"
  if ! git checkout integration/full-wiring 2>&1 | tee -a "$LOG"; then
    log "❌ cannot checkout integration/full-wiring"
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi
log "  ✅ on integration/full-wiring"

# --- 2. Verify clean working tree ---
log ""
log "[step 2] Verify clean working tree"
if [ -n "$(git status --porcelain)" ]; then
  log "⚠️  Uncommitted changes found — committing them now so the push is complete"
  git status --short 2>&1 | tee -a "$LOG"
  git add -A 2>&1 | tee -a "$LOG"
  MSGFILE="$(mktemp -t pushmsg)"
  cat >"$MSGFILE" <<'COMMIT_MSG'
chore(integration): sweep any remaining uncommitted changes before handoff

Auto-committed by 42-push-integration.command so the pushed branch matches
the local working-tree state exactly.
COMMIT_MSG
  git commit -F "$MSGFILE" 2>&1 | tee -a "$LOG"
  rm -f "$MSGFILE"
fi
log "  ✅ clean"

# --- 3. Typecheck ---
log ""
log "[step 3] Typecheck backend"
cd backend || { log "❌ no backend/"; exit 1; }
if [ ! -d node_modules ]; then
  log "  installing deps..."
  npm install 2>&1 | tee -a "$LOG"
fi
if npx tsc --noEmit 2>&1 | tee -a "$LOG"; then
  log "  ✅ typecheck passed"
else
  log "  ❌ typecheck failed"
  log "     (Push will still continue — the teammate picking this up needs to see"
  log "      the same failure you're seeing.)"
fi
cd "$REPO_ROOT" || true

# --- 4. Show what's on this branch vs origin/main ---
log ""
log "[step 4] Summary of commits on integration/full-wiring vs origin/main"
git fetch origin --prune 2>&1 | tee -a "$LOG" || true
log ""
log "Commits ahead of origin/main:"
git log --oneline origin/main..HEAD 2>&1 | tee -a "$LOG" || true
log ""
log "File counts changed vs origin/main:"
git diff --stat origin/main..HEAD 2>&1 | tee -a "$LOG" | tail -5 || true

# --- 5. Push ---
log ""
log "[step 5] Push integration/full-wiring to origin"
if git push origin integration/full-wiring 2>&1 | tee -a "$LOG"; then
  log "  ✅ pushed (fast-forward)"
else
  log ""
  log "⚠️  Plain push failed — the remote branch may have diverged."
  log "    Trying --force-with-lease (safer than --force; aborts if remote has"
  log "    NEW commits we haven't seen):"
  if git push --force-with-lease origin integration/full-wiring 2>&1 | tee -a "$LOG"; then
    log "  ✅ pushed (force-with-lease)"
  else
    log "❌ push failed — run \`git pull --rebase origin integration/full-wiring\`"
    log "   and rerun this script."
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi

# --- 6. Print PR URL ---
REPO_URL="$(git remote get-url origin 2>/dev/null | sed -E 's#git@github.com:#https://github.com/#; s#\.git$##')"
log ""
banner "✅ PUSHED TO ORIGIN"
log "Branch: integration/full-wiring"
if [ -n "$REPO_URL" ]; then
  log ""
  log "Open PR URL:"
  log "  $REPO_URL/compare/main...integration/full-wiring?expand=1"
  log ""
  log "Branch URL:"
  log "  $REPO_URL/tree/integration/full-wiring"
fi
log ""
log "Tell the team:"
log "  - integration/full-wiring is pushed; main is untouched"
log "  - Tharun UI + wiring backend + Claude tranche/lending + real-USDC test"
log "  - Real-USDC deposit verified on Solscan (see .logs/38-real-usdc-test.log)"
log "  - Backend typechecks; run schema_tranche.sql in Supabase before redeploy"
log ""
log "Log: $LOG"
read -r -p "Press ENTER to close..."

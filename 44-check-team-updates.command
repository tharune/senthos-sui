#!/bin/bash
# 44-check-team-updates.command
#
# Fetches all remote refs and prints a summary of what Tharun / Luka have
# pushed in the last few hours, plus whether integration/full-wiring is
# behind any of them.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/44-check-team-updates.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "44-check-team-updates"

# --- 1. Fetch everything ---
log ""
log "[step 1] git fetch origin --prune"
git fetch origin --prune 2>&1 | tee -a "$LOG"
log ""

# --- 2. Show all remote branches with last-commit time + author ---
log "[step 2] All remote branches — last commit (sorted newest first)"
log ""
git for-each-ref \
  --sort=-committerdate \
  --format='  %(committerdate:relative)%09%(authorname)%09%(refname:short)%09%(subject)' \
  refs/remotes/origin 2>&1 | tee -a "$LOG"
log ""

# --- 3. Anything pushed in the last 3 hours, across ALL remote branches ---
log "[step 3] Commits pushed in the last 3 hours on ANY remote branch"
log ""
git log --all --remotes \
  --since='3 hours ago' \
  --pretty=format:'  %h  %ar  <%an>  [%d]  %s' 2>&1 | tee -a "$LOG"
log ""
log ""

# --- 4. Tharun-specific (by author name OR by branch) ---
log "[step 4] Commits authored by Tharun in the last 8 hours"
log ""
git log --all --remotes \
  --author='Tharun' \
  --since='8 hours ago' \
  --pretty=format:'  %h  %ar  %d  %s' 2>&1 | tee -a "$LOG"
log ""
log ""
log "  Commits on origin/Tharun-changes in the last 8 hours:"
git log origin/Tharun-changes \
  --since='8 hours ago' \
  --pretty=format:'  %h  %ar  <%an>  %s' 2>&1 | tee -a "$LOG"
log ""
log ""

# --- 5. Is integration/full-wiring up to date with origin/main + origin/Tharun-changes? ---
log "[step 5] Does integration/full-wiring contain the tip of the other branches?"
log ""

for BR in origin/main origin/Tharun-changes origin/alex-ui origin/wiring/onchain-ready origin/feat/portfolio-composer; do
  TIP="$(git rev-parse "$BR" 2>/dev/null || echo MISSING)"
  if [ "$TIP" = "MISSING" ]; then
    log "  ? $BR — branch does not exist on origin"
    continue
  fi
  if git merge-base --is-ancestor "$BR" origin/integration/full-wiring 2>/dev/null; then
    log "  ✅ $BR is already merged into integration/full-wiring"
  else
    AHEAD="$(git rev-list --count "origin/integration/full-wiring..$BR" 2>/dev/null)"
    BEHIND="$(git rev-list --count "$BR..origin/integration/full-wiring" 2>/dev/null)"
    log "  ⚠️  $BR is NOT in integration/full-wiring  (integration is ahead $BEHIND, behind $AHEAD)"
  fi
done
log ""

# --- 6. Show diff of origin/Tharun-changes vs origin/integration/full-wiring ---
log "[step 6] Files changed between origin/Tharun-changes and origin/integration/full-wiring"
log "         (what Tharun has that's NOT in integration)"
log ""
MISSING_COUNT="$(git rev-list --count origin/integration/full-wiring..origin/Tharun-changes 2>/dev/null)"
log "  Commits on Tharun-changes that are NOT on integration/full-wiring: $MISSING_COUNT"
if [ "${MISSING_COUNT:-0}" -gt 0 ]; then
  log ""
  log "  Commit list:"
  git log origin/integration/full-wiring..origin/Tharun-changes \
    --pretty=format:'    %h  %ar  <%an>  %s' 2>&1 | tee -a "$LOG"
  log ""
  log ""
  log "  File-level diff stats (top 20):"
  git diff --stat origin/integration/full-wiring..origin/Tharun-changes 2>&1 | tee -a "$LOG" | tail -25
fi
log ""

# --- 7. Final verdict ---
banner "SUMMARY"
log ""
log "Log: $LOG"
read -r -p "Press ENTER to close..."

#!/bin/bash
# 36-check-tharun.command
# Fetch origin, then dump what's on Tharun-changes vs main and what's on main vs wiring/onchain-ready.
set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG="$REPO_ROOT/.logs/36-check-tharun.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "36-check-tharun — what's new on main + Tharun-changes?"

log "Fetching origin (all branches)..."
git fetch origin --prune 2>&1 | tee -a "$LOG" || {
  log "❌ fetch failed"; read -r -p "ENTER to close..."; exit 1;
}

log ""
banner "main — last 10 commits on origin/main"
git log --oneline --decorate -10 origin/main 2>&1 | tee -a "$LOG"

log ""
banner "Tharun-changes — commits ahead of main"
git log --oneline --decorate origin/main..origin/Tharun-changes 2>&1 | tee -a "$LOG"

log ""
banner "Tharun-changes — files changed vs main"
git diff --stat origin/main...origin/Tharun-changes 2>&1 | tee -a "$LOG"

log ""
banner "main — commits ahead of wiring/onchain-ready (what I'm missing)"
git log --oneline --decorate origin/wiring/onchain-ready..origin/main 2>&1 | tee -a "$LOG"

log ""
banner "main — files that changed since my wiring branch diverged"
git diff --stat origin/wiring/onchain-ready...origin/main 2>&1 | tee -a "$LOG"

log ""
banner "DONE"
log "Full log: $LOG"
read -r -p "Press ENTER to close..."

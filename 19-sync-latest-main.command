#!/usr/bin/env bash
# Unlock + fetch + pull latest origin/main, then write diagnostic
# output into ./.logs/19-sync-latest.txt so the sandbox can read it.
set -u
cd "$(dirname "$0")"

mkdir -p .logs
OUT=".logs/19-sync-latest.txt"
: > "$OUT"

log() { echo "$@" | tee -a "$OUT"; }

log "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) 19-sync-latest-main ==="
log ""

log "--- Cleaning stale lock ---"
if [ -f .git/index.lock ]; then
  rm -f .git/index.lock && log "Removed .git/index.lock" || log "Failed to remove .git/index.lock"
else
  log "No .git/index.lock present"
fi
log ""

log "--- git fetch origin ---"
git fetch origin --prune 2>&1 | tee -a "$OUT"
log ""

log "--- Tips ---"
log "local  HEAD     : $(git rev-parse HEAD 2>&1)"
log "local  main     : $(git rev-parse main 2>&1)"
log "remote main     : $(git rev-parse origin/main 2>&1)"
log ""

log "--- git status (short) ---"
git status --short 2>&1 | tee -a "$OUT"
log ""

log "--- New commits on origin/main since local HEAD ---"
git log HEAD..origin/main --oneline 2>&1 | tee -a "$OUT"
log ""

log "--- New commits on origin/main since 4b7cfe6 (phase-15 push) ---"
git log 4b7cfe6..origin/main --oneline 2>&1 | tee -a "$OUT"
log ""

log "--- Last 25 commits on origin/main ---"
git log origin/main --oneline -25 2>&1 | tee -a "$OUT"
log ""

log "--- All remote branches (with recent tip) ---"
git for-each-ref --sort=-committerdate --format='%(committerdate:iso8601)  %(refname:short)  %(objectname:short)  %(subject)' refs/remotes/origin 2>&1 | head -20 | tee -a "$OUT"
log ""

log "--- Files changed on origin/main since 4b7cfe6 ---"
git diff --name-status 4b7cfe6..origin/main 2>&1 | tee -a "$OUT"
log ""

log "Done. Read .logs/19-sync-latest.txt from the sandbox."
log ""
log "NOTE: This script does NOT modify your working tree or reset main."
log "      If you want me (Claude) to reset main to origin/main, tell me"
log "      and I'll generate a second script."

# Keep Terminal window open so you can see the result.
echo ""
echo "Press any key to close..."
read -n 1 -s

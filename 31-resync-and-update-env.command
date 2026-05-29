#!/bin/bash
# 31-resync-and-update-env.command
#
# Brings the local repo up to origin/main (Luka's 3 new commits: 8fbb375,
# 33d2edd, aaafc79) and updates backend/.env with the new program IDs Luka
# deployed from fresh keypairs.
#
# New program IDs (from commit 33d2edd):
#   traxis_vault: E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb
#   traxis_ppn:   4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE
#
# What it does, in order:
#   1. Clears stale .git/index.lock if any
#   2. Stashes any tracked changes in working tree (so rebase can run)
#   3. Deletes known-throwaway untracked .command files (19, 28, 29, 30)
#      so the tree is clean
#   4. git fetch origin; git pull --rebase origin main
#   5. Patches backend/.env to point TRAXIS_VAULT_PROGRAM_ID and
#      TRAXIS_PPN_PROGRAM_ID at the new IDs. Also backs up the old file
#      to backend/.env.bak-<timestamp> so nothing is lost.
#   6. Reinstalls backend dependencies (in case Luka's commits changed any)
#   7. Pops the stash back (if there was one)
#   8. Writes a full status report to .logs/31-resync.txt for the sandbox.
#
# Safe to re-run. Idempotent.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
OUT=".logs/31-resync.txt"
: > "$OUT"

log() { echo "$@" | tee -a "$OUT"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

NEW_VAULT_ID="E77R7yqUEAWz9jUk92kSnrpvUBEwGpPT3iZaThbKQcJb"
NEW_PPN_ID="4NnrpeWgdmVymcdGqbrmQUunHHvyVSevUXCKFGJYwbtE"
OLD_VAULT_ID="DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat"
OLD_PPN_ID="3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp"

banner "31-resync — pulling Luka's latest and refreshing .env"

# Step 1: clear any stale git lock
if [[ -f .git/index.lock ]]; then
  log "Clearing stale .git/index.lock"
  rm -f .git/index.lock
fi

# Step 2: stash any real changes so rebase is unobstructed
log ""
log "=== git status before ==="
git status --short --branch 2>&1 | tee -a "$OUT"

STASH_MSG="31-resync-auto-stash-$(date +%s)"
STASHED=0
if [[ -n "$(git status --porcelain | grep -v '^??' || true)" ]]; then
  log ""
  log "Stashing tracked changes as '$STASH_MSG'"
  git stash push -u -m "$STASH_MSG" 2>&1 | tee -a "$OUT"
  STASHED=1
fi

# Step 3: remove known throwaway .command scripts that aren't tracked
log ""
log "=== removing throwaway untracked .command files ==="
for f in 19-sync-latest-main.command 28-commit-and-push.command 29-sync-and-audit.command 30-show-new-commits.command; do
  if [[ -f "$f" ]] && ! git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
    rm -v "$f" 2>&1 | tee -a "$OUT"
  fi
done

# Step 4: fetch + rebase
log ""
log "=== git fetch origin ==="
git fetch origin 2>&1 | tee -a "$OUT"

log ""
log "=== git pull --rebase origin main ==="
if git pull --rebase origin main 2>&1 | tee -a "$OUT"; then
  log "Rebase OK."
else
  log ""
  log "!! Rebase FAILED. Aborting rebase and leaving tree as-is."
  log "!! You'll need to resolve manually. stash was '$STASH_MSG'."
  git rebase --abort 2>&1 | tee -a "$OUT" || true
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "=== git log -5 after rebase ==="
git log --oneline -5 2>&1 | tee -a "$OUT"

# Step 5: patch backend/.env
log ""
log "=== patching backend/.env ==="
if [[ -f backend/.env ]]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  cp backend/.env "backend/.env.bak-$TS"
  log "Backup: backend/.env.bak-$TS"

  # Use perl for safe in-place edit (doesn't need -i'' gymnastics on mac)
  perl -pi -e "s/\\Q$OLD_VAULT_ID\\E/$NEW_VAULT_ID/g" backend/.env
  perl -pi -e "s/\\Q$OLD_PPN_ID\\E/$NEW_PPN_ID/g"    backend/.env

  log "After-patch values:"
  grep -E '^TRAXIS_VAULT_PROGRAM_ID=|^TRAXIS_PPN_PROGRAM_ID=' backend/.env | tee -a "$OUT"

  # Verify the patch landed
  if grep -q "^TRAXIS_VAULT_PROGRAM_ID=$NEW_VAULT_ID" backend/.env && \
     grep -q "^TRAXIS_PPN_PROGRAM_ID=$NEW_PPN_ID"   backend/.env; then
    log "✅ Program IDs updated."
  else
    log "❌ Program ID patch FAILED. Backend/.env might be non-standard."
    log "   Current values:"
    grep -E '^TRAXIS_VAULT_PROGRAM_ID=|^TRAXIS_PPN_PROGRAM_ID=' backend/.env | tee -a "$OUT"
  fi
else
  log "❌ backend/.env not found. Skipping patch. Rerun Phase-A setup first."
fi

# Optional: confirm root + backend package.json unchanged in structure so
# npm install is a no-op (other than new lockfile entries from rebase)
log ""
log "=== npm install at root ==="
if command -v npm >/dev/null 2>&1; then
  npm install --silent 2>&1 | tail -40 | tee -a "$OUT"
else
  log "npm not found on PATH. Skipping."
fi

log ""
log "=== npm install in backend/ ==="
if [[ -d backend ]] && command -v npm >/dev/null 2>&1; then
  (cd backend && npm install --silent 2>&1 | tail -40) | tee -a "$OUT"
else
  log "backend/ or npm missing. Skipping."
fi

# Step 7: pop stash if we made one
if [[ $STASHED -eq 1 ]]; then
  log ""
  log "=== popping auto-stash '$STASH_MSG' ==="
  if git stash list | grep -q "$STASH_MSG"; then
    git stash pop 2>&1 | tee -a "$OUT" || {
      log "!! stash pop had conflicts. Your changes are still in 'git stash list'."
    }
  else
    log "(stash not found — odd; check 'git stash list')"
  fi
fi

# Final verification block
banner "verification"

log ""
log "=== deployed program re-check ==="
for pid in "$NEW_VAULT_ID" "$NEW_PPN_ID"; do
  log "  $pid:"
  curl -sS --max-time 10 -X POST https://api.devnet.solana.com \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$pid\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":0}}]}" \
    2>&1 | python3 -c "
import sys, json
r = json.load(sys.stdin)
v = r.get('result', {}).get('value')
if v is None:
    print('    NOT FOUND on devnet')
else:
    print(f\"    executable={v.get('executable')}, owner={v.get('owner')}, lamports={v.get('lamports')}\")
" | tee -a "$OUT"
done

log ""
log "=== final git status ==="
git status --short --branch 2>&1 | tee -a "$OUT"

log ""
log "DONE. Report saved to $OUT"
read -r -p "Press ENTER to close..."

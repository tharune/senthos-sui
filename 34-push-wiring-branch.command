#!/bin/bash
# 34-push-wiring-branch.command
#
# Run this on your Mac any time you want to publish the wiring branch
# `wiring/onchain-ready` to GitHub.
#
# The branch contains the full on-chain wiring layer (deposit/redeem/PPN
# clients, admin routes, PPN on-chain endpoints, lending program scaffold,
# WIRING.md). It was committed locally in the sandbox but not pushed — this
# script takes care of that on a machine that actually has your GitHub creds.
#
# What it does:
#   1. Sanity-check: we're inside the repo and the branch exists.
#   2. Fetch origin.
#   3. Rebase wiring/onchain-ready onto origin/main (so it merges cleanly
#      even if Luka pushed to main in the meantime).
#   4. Push with -u so origin tracking is set up.
#   5. Optionally open a PR URL in the browser.
#
# Safe to re-run: if the branch is already up-to-date, it's a no-op.
# If the rebase has conflicts, it aborts with guidance — no force-push.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/34-push-wiring-branch.log"
: > "$LOG"

BR="wiring/onchain-ready"

log() { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "34-push-wiring-branch — push $BR to origin"

# Clear any stale lockfile.
rm -f .git/index.lock 2>/dev/null || true

# Branch must exist locally.
if ! git show-ref --verify --quiet "refs/heads/$BR"; then
  log "❌ Branch $BR does not exist locally."
  log "   The sandbox commit should have created it — did you pull recently?"
  log "   Try: git branch -a | grep wiring"
  read -r -p "Press ENTER to close..."
  exit 1
fi

# Switch to it.
log "Switching to $BR..."
git checkout "$BR" 2>&1 | tee -a "$LOG"
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
  log "❌ Could not checkout $BR (maybe uncommitted changes on current branch)."
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "Fetching origin..."
git fetch origin 2>&1 | tee -a "$LOG"
if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
  log "❌ git fetch failed. Check network / auth."
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "Rebasing $BR onto origin/main..."
if git rebase origin/main 2>&1 | tee -a "$LOG"; then
  log "✅ Rebase clean."
else
  log ""
  log "❌ Rebase hit conflicts. Run:"
  log "     git status            # see which files"
  log "     # fix them, then:"
  log "     git add <files>"
  log "     git rebase --continue"
  log "     ./34-push-wiring-branch.command"
  log ""
  log "   Or abort with: git rebase --abort"
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "Pushing $BR to origin (sets upstream on first run)..."
git push -u origin "$BR" 2>&1 | tee -a "$LOG"
PUSH_RC=${PIPESTATUS[0]}

if [[ $PUSH_RC -ne 0 ]]; then
  log ""
  log "❌ Push failed. See $LOG"
  log ""
  log "If the remote rejects a force-push (shouldn't happen for a new branch"
  log "or a non-divergent rebase), try: git push -u origin $BR --force-with-lease"
  read -r -p "Press ENTER to close..."
  exit 1
fi

banner "DONE"
log ""
log "✅ $BR pushed to origin."
log ""
log "Latest commits on $BR:"
git log --oneline -4 2>&1 | tee -a "$LOG"
log ""

# Suggest a PR URL.
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
if [[ "$REMOTE_URL" == *"github.com"* ]]; then
  # Normalize both SSH and HTTPS remotes to https://github.com/OWNER/REPO
  PR_BASE=$(printf '%s' "$REMOTE_URL" \
    | sed -E 's#^git@github.com:#https://github.com/#' \
    | sed -E 's#\.git$##')
  log "Open a PR:"
  log "  ${PR_BASE}/compare/main...${BR}?expand=1"
  log ""
fi

log "When Luka's UI is ready:"
log "  1. He imports from app/app/_lib/*-client.ts and wires buttons (see WIRING.md)"
log "  2. Either merge $BR into main, or rebase his UI branch on $BR"
log "  3. No backend or program changes required from him"
log ""
read -r -p "Press ENTER to close..."

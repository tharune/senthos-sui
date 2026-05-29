#!/bin/bash
# 40c-commit-testfix.command
#
# After running 38-real-usdc-test.command the first time, we discovered that
# the post-deposit verification step referenced two fields on the PpnNote
# account that don't exist in the on-chain schema (`adapter`, `redeemed`).
# The second run went green after that fix was applied. This script commits
# the fix on top of the integration branch so 41-merge-main.command can run
# against a clean working tree.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/40c-commit-testfix.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }

log "40c-commit-testfix — commit test-real-usdc.cjs fix on integration/full-wiring"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "integration/full-wiring" ]; then
  log "Switching to integration/full-wiring (currently on $CURRENT_BRANCH)"
  if ! git checkout integration/full-wiring 2>&1 | tee -a "$LOG"; then
    log "❌ cannot checkout integration/full-wiring"
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi

if git diff --quiet HEAD && [ -z "$(git status --porcelain)" ]; then
  log "  (nothing to commit — tree is clean)"
  log "  ✅ already committed; safe to run 41-merge-main.command"
  read -r -p "Press ENTER to close..."
  exit 0
fi

log ""
log "Changes to commit:"
git status --short 2>&1 | tee -a "$LOG"

git add -A 2>&1 | tee -a "$LOG"

MSGFILE="$(mktemp -t testfix-msg)"
cat >"$MSGFILE" <<'COMMIT_MSG'
fix(test): correct PpnNote field accesses in real-USDC proof test

The first run of 38-real-usdc-test.command sent and confirmed the deposit
transaction on devnet (Solscan verified 1 USDC moved authority -> adapter
pool), then crashed in the post-deposit verification step because it tried
to read note.adapter.toBase58() and !note.redeemed — neither field exists
on the PpnNote account struct (see programs/traxis_ppn/src/state.rs).

Replaced with traxVault/traxMint prints + a state-discriminator check
against the anchor-serialised PpnState enum ({ active: {} } / { redeemed:
{} }). Second run went fully green; verified in Solscan tx
4zNgScSF6DgN5QGYNGdpShsDq74zErKLn9AmEHnYPD7RVoaRe9zjLyT8cURkR2dnptEesBvgbNrtBjU818FYeBQt
COMMIT_MSG

git commit -F "$MSGFILE" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]}
rm -f "$MSGFILE"
if [ "$RC" != "0" ]; then
  log "❌ commit failed"
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "✅ committed. Last commit:"
git log -1 --oneline 2>&1 | tee -a "$LOG"
log ""
log "Next: ./41-merge-main.command"
read -r -p "Press ENTER to close..."

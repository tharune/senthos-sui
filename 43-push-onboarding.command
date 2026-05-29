#!/bin/bash
# 43-push-onboarding.command
#
# Commit + push the teammate onboarding docs (TEAMMATE-SETUP.md +
# 00-onboard.command) on top of integration/full-wiring, so anyone on the
# team who clones the branch can get running with one script.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "bad cwd"; exit 1; }

mkdir -p "$REPO_ROOT/.logs"
LOG="$REPO_ROOT/.logs/43-push-onboarding.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }

log "43-push-onboarding — commit + push TEAMMATE-SETUP.md + 00-onboard.command"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT_BRANCH" != "integration/full-wiring" ]; then
  log "switching to integration/full-wiring (currently on $CURRENT_BRANCH)"
  if ! git checkout integration/full-wiring 2>&1 | tee -a "$LOG"; then
    log "❌ cannot checkout integration/full-wiring"
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi

git add TEAMMATE-SETUP.md 00-onboard.command 42-push-integration.command 43-push-onboarding.command 2>&1 | tee -a "$LOG"

if git diff --cached --quiet; then
  log "  (nothing to commit — already committed)"
else
  MSGFILE="$(mktemp -t onboardmsg)"
  cat >"$MSGFILE" <<'COMMIT_MSG'
docs(onboarding): add TEAMMATE-SETUP.md + 00-onboard.command

New teammates can now clone the branch and run ./00-onboard.command to:
  - verify prerequisites (node, npm, solana, git)
  - set Solana CLI to devnet
  - generate a local dev-authority keypair at ~/.config/solana/dev-authority.json
  - airdrop 2 SOL
  - copy backend/.env from .env.example with program IDs / mint / RPC pre-filled
  - install backend deps
  - print the exact shortlist of things still needed manually
    (Circle USDC faucet + Supabase secrets from Victor)

TEAMMATE-SETUP.md covers the full walkthrough including troubleshooting,
secret-handling rules, and what-to-do-if tranche endpoints 500.

Also includes 42-push-integration.command and 43-push-onboarding.command
for reproducibility.
COMMIT_MSG
  git commit -F "$MSGFILE" 2>&1 | tee -a "$LOG"
  rm -f "$MSGFILE"
fi

log ""
log "Pushing integration/full-wiring..."
if git push origin integration/full-wiring 2>&1 | tee -a "$LOG"; then
  log "  ✅ pushed"
else
  log ""
  log "⚠️  Plain push failed; trying --force-with-lease"
  git push --force-with-lease origin integration/full-wiring 2>&1 | tee -a "$LOG" || {
    log "❌ push failed — run git pull --rebase origin integration/full-wiring"
    read -r -p "Press ENTER to close..."
    exit 1
  }
fi

log ""
log "✅ DONE — onboarding docs are live on integration/full-wiring."
log ""
log "Send teammates this message:"
log "  1. git clone https://github.com/LuKresXD/SCBC-Hackathon-2026.git"
log "  2. cd SCBC-Hackathon-2026 && git checkout integration/full-wiring"
log "  3. ./00-onboard.command                  # double-click from Finder"
log "  4. Read TEAMMATE-SETUP.md for the rest"
log ""
log "Then send the Supabase secrets (SUPABASE_URL + SUPABASE_ANON_KEY) via"
log "Signal / 1Password / Bitwarden — NOT Slack / Discord / email."
log ""
read -r -p "Press ENTER to close..."

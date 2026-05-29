#!/bin/bash
# 28-commit-and-push.command
# Commits Victor's section work and pushes to origin/main.
#
# Includes:
#   - package.json / package-lock.json  (adds root dotenv dep needed by
#     scripts/init-demo-vaults.ts)
#   - RUN-ALL.command                   (single-double-click MVP bootstrap
#     orchestrator)
#   - 27-continue.command               (Phase-C-onward continuation script;
#     the Railway/Vercel steps at the bottom are documentation-only now that
#     scope is local verification)
#   - STATE.md                          (updated with session findings incl.
#     vault-init DeclaredProgramIdMismatch note for Luka)
#
# Skips (on purpose):
#   - 19-sync-latest-main.command  (one-off debug helper for the sandbox)
#   - backend/.env, .creds/*       (secrets, already gitignored)
#
# Push to: origin/main

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/28-commit-and-push.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }

banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "28-commit-and-push — Victor's section → origin/main"

# Clear any stale sandbox lock
rm -f .git/index.lock 2>/dev/null || true

log ""
log "Current status:"
git status --short 2>&1 | tee -a "$LOG"

log ""
log "Staging files..."
git add \
    package.json \
    package-lock.json \
    RUN-ALL.command \
    27-continue.command \
    STATE.md \
    2>&1 | tee -a "$LOG"

log ""
log "What's staged:"
git diff --cached --stat 2>&1 | tee -a "$LOG"

if [[ -z "$(git diff --cached --stat)" ]]; then
  log ""
  log "⚠️  Nothing staged to commit. Exiting clean."
  read -r -p "Press ENTER to close..."
  exit 0
fi

log ""
log "Committing..."
git commit -m "$(cat <<'EOF'
feat(backend/onchain): Victor's section — credentials, bootstrap, docs

- Adds root `dotenv` dependency (required by scripts/init-demo-vaults.ts,
  which lives at repo root and reads backend/.env via dotenv.config).
- RUN-ALL.command: single double-click orchestrator that runs every Phase
  A/B/C/D script in sequence with idempotent re-runs.
- 27-continue.command: Phase-C-onward continuation (seed → on-chain vault
  init → env block export) for when an earlier phase partially landed.
- STATE.md: updated with the vault-init DeclaredProgramIdMismatch finding.
  Both programs are deployed and byte-identical to local .so, but vault
  init fires Anchor error 4100 at ~3906 compute units. The binary-patch
  from phase 15 should be complete (only 1 occurrence of DY7NA... in
  .rodata, 0 of any historical id), yet the check still fires. Fix is
  deferred to Luka: rebuild both .so files from source via
  13-build-both.command then redeploy.

Victor's backend/.env (real Supabase + program IDs + authority keypair
path) stays gitignored; Supabase schema is already applied.
EOF
)" 2>&1 | tee -a "$LOG"

COMMIT_RC=${PIPESTATUS[0]}
if [[ $COMMIT_RC -ne 0 ]]; then
  log ""
  log "❌ Commit failed. See $LOG"
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "Pushing to origin/main..."
git push origin main 2>&1 | tee -a "$LOG"
PUSH_RC=${PIPESTATUS[0]}

if [[ $PUSH_RC -ne 0 ]]; then
  log ""
  log "❌ Push failed. See $LOG"
  log ""
  log "If this says 'non-fast-forward' it means Luka pushed to main since"
  log "the last sync. Run:   git pull --rebase origin main   then re-run"
  log "this script."
  read -r -p "Press ENTER to close..."
  exit 1
fi

banner "DONE"
log ""
log "✅ Pushed to origin/main."
log ""
git log --oneline -3 2>&1 | tee -a "$LOG"
log ""
log "Luka can now pull main and pick up from STATE.md's 'Outstanding issue'"
log "section (vault init rebuild)."
log ""
read -r -p "Press ENTER to close..."

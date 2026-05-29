#!/bin/bash
# 25-commit-phase-a.command
# Phase A final step — commit + push the new deploy-enabling files.
#
# Current situation this script is designed for:
#   • Local branch "main" points at 4b7cfe6 (one commit AHEAD of where it was
#     when the phase-15 devnet deploy happened, but 11 commits BEHIND the
#     remote origin/main after Tharun's merge).
#   • Working tree already has all of origin/main's files on disk (they show
#     up as "untracked" because the local branch's tree predates them).
#   • Claude has added new files (20-23.command, scripts/supabase-init.sql,
#     railway.json, vercel.json, .env.local.example) and improved two files
#     (.gitignore, backend/Dockerfile) on top of that working tree.
#
# What this script does:
#   1. Removes any stale .git/index.lock (sandbox frequently leaves it).
#   2. Fetches origin.
#   3. Sanity-checks that local HEAD commit is also reachable from origin/main
#      (so no work will be lost when we move the branch pointer).
#   4. Moves local main → origin/main (git reset --mixed, keeps working tree).
#   5. Stages ONLY the files we want to add/modify — explicit list, no `-A`.
#   6. Shows the full `git diff --cached` so you can review before pushing.
#   7. Prompts for confirmation.
#   8. Commits + pushes origin main.
#
# If anything looks wrong, abort at the review step — nothing is pushed
# without your explicit "yes".

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/25-commit-phase-a.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

log "=== 25-commit-phase-a.command ==="
log "Started: $(date)"
log ""

# ---------- 1. Unlock + fetch ----------
echo "================================================================"
echo "  STEP 1 — Unlock + fetch origin"
echo "================================================================"
if [[ -f .git/index.lock ]]; then
  log "Removing stale .git/index.lock"
  rm -f .git/index.lock
fi
logcmd git fetch origin
FETCH_RC=$?
if [[ $FETCH_RC -ne 0 ]]; then
  log "ERROR: git fetch failed."
  echo ""
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ---------- 2. Safety check ----------
echo ""
echo "================================================================"
echo "  STEP 2 — Verify we won't lose any commits"
echo "================================================================"
LOCAL_HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
log "Local HEAD:    $LOCAL_HEAD"
log "Origin/main:   $ORIGIN"

# Is LOCAL_HEAD reachable from ORIGIN?
if git merge-base --is-ancestor "$LOCAL_HEAD" "$ORIGIN"; then
  log "✓ Local HEAD is an ancestor of origin/main — safe to fast-forward."
else
  log "⚠️  Local HEAD ($LOCAL_HEAD) is NOT reachable from origin/main."
  log "    That means local has commits that would be orphaned by reset."
  log ""
  log "Orphan commits:"
  git log --oneline "$ORIGIN..$LOCAL_HEAD" | tee -a "$LOG"
  log ""
  echo ""
  echo "⚠️  It's not safe to auto-reset. Aborting."
  echo "   If those orphan commits are meaningful, cherry-pick them onto"
  echo "   origin/main manually. Otherwise re-run this script after a"
  echo "   plain 'git reset --hard origin/main'."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ---------- 3. Move branch ----------
echo ""
echo "================================================================"
echo "  STEP 3 — Fast-forward local main to origin/main"
echo "================================================================"
# --mixed keeps working tree, resets index+branch to origin/main.
# Anything in the working tree that matches origin/main becomes clean;
# anything that doesn't match shows as modified; anything new shows as untracked.
logcmd git reset --mixed origin/main

echo ""
log "After reset, git status (first 40 lines):"
git status | head -40 | tee -a "$LOG"

# ---------- 4. Stage the explicit file list ----------
echo ""
echo "================================================================"
echo "  STEP 4 — Stage specific files"
echo "================================================================"

FILES=(
  ".gitignore"
  "backend/Dockerfile"
  "railway.json"
  "vercel.json"
  ".env.local.example"
  "scripts/supabase-init.sql"
  "20-supabase-setup.command"
  "21-init-onchain-vaults.command"
  "22-railway-env-export.command"
  "23-smoke-test.command"
  "24-verify-build.command"
  "25-commit-phase-a.command"
)

for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    logcmd git add "$f"
  else
    log "WARN: $f missing — skipping"
  fi
done

# ---------- 5. Review ----------
echo ""
echo "================================================================"
echo "  STEP 5 — Review staged changes"
echo "================================================================"
echo ""
echo "Staged files:"
git diff --cached --stat | tee -a "$LOG"
echo ""
echo "Full diff (scroll up if needed):"
git diff --cached | head -400

echo ""
echo "================================================================"
echo "  READY TO COMMIT"
echo "================================================================"
read -r -p "Does the diff look right? Type 'yes' to commit + push: " ANS
if [[ "$ANS" != "yes" ]]; then
  log "User aborted at review step. Staged changes remain; nothing committed."
  echo ""
  echo "No commit made. Staged files are still staged — reset with:"
  echo "  git reset"
  echo "if you want to start over."
  read -r -p "Press ENTER to close..."
  exit 0
fi

# ---------- 6. Commit + push ----------
COMMIT_MSG=$(cat <<'EOF'
feat: deployment infra + MVP bootstrap scripts

Phase A of the MVP-by-Sunday plan. Adds the pieces needed to bring the
already-merged product online against a managed Supabase + Railway +
Vercel stack.

New:
- railway.json — tells Railway to build backend/Dockerfile with
  buildContext=backend; healthcheck on /api/health.
- vercel.json — Next.js framework preset + ignoreCommand so Vercel
  skips re-deploys when only docs change.
- scripts/supabase-init.sql — concatenated schema (99 core + 25 onchain
  lines) for one-shot paste into the Supabase SQL Editor.
- .env.local.example — frontend env template pointing at the backend.
- 20–25 *.command scripts — Mac-side orchestration for the rest of the
  setup: Supabase creds + seed, on-chain vault bootstrap (incl. the
  FEE_RECIPIENT USDC ATA), Railway env export (converts keypair path
  to inline JSON array), smoke tests, local build verification, and
  this commit script.

Changed:
- backend/Dockerfile — rewrote as proper multi-stage build. Previous
  version ran `npm ci --only=production` before `npx tsc`, which
  stripped tsc out of devDeps and then tried to invoke it; would fail
  on any fresh Railway build. Stage 1 installs full deps + compiles,
  stage 2 ships only production deps + /app/dist.
- .gitignore — additive: .logs/ (may hold secrets from env-export
  scripts), plus a few Rust/Anchor build artifacts and IDE folders.

Nothing in the application code (frontend or backend) is touched by
this commit.
EOF
)

logcmd git commit -m "$COMMIT_MSG" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
COMMIT_RC=$?
if [[ $COMMIT_RC -ne 0 ]]; then
  log "ERROR: commit failed."
  read -r -p "Press ENTER to close..."
  exit 1
fi

log ""
log "Pushing to origin main..."
logcmd git push origin main
PUSH_RC=$?

log ""
log "================================================================"
log "  Done"
log "================================================================"
log "commit rc: $COMMIT_RC"
log "push rc:   $PUSH_RC"
log "Finished: $(date)"

echo ""
if [[ $PUSH_RC -eq 0 ]]; then
  echo "✅ Pushed. Tharun will see the new files on main."
  echo ""
  echo "   Next: ./20-supabase-setup.command"
else
  echo "⚠️  Push failed. Commit is still local. See .logs/25-commit-phase-a.log"
fi
echo ""
read -r -p "Press ENTER to close this window..."

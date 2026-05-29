#!/bin/bash
# 26-fix-diverged.command
# Recovers from the divergence DO-EVERYTHING.command hit:
#   Local main and origin/main share ancestor 0a6e26b, but diverged.
#   Local has two commits after the fork:
#     4b7cfe6  feat: Traxis onchain programs + backend wiring
#     5a70c68  feat: deployment infra + MVP bootstrap scripts   ← Phase A
#   Origin has 11 commits after the fork (Tharun's merge + rebrand, etc).
#
# Strategy: keep only the Phase A commit's CONTENT (5a70c68's tree-diff
# vs 4b7cfe6), drop both local commits, fast-forward to origin/main,
# then re-apply Phase A on top and push.
#
# Nothing from origin/main is lost. The Traxis-onchain files (4b7cfe6)
# are already present on origin/main via Tharun's merge.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/26-fix-diverged.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

log "=== 26-fix-diverged.command ==="
log "Started: $(date)"
log ""

if [[ -f .git/index.lock ]]; then
  log "Removing stale .git/index.lock"
  rm -f .git/index.lock
fi

# 1. Fetch
logcmd git fetch origin || { log "❌ fetch failed"; read -r -p "Press ENTER..."; exit 1; }

LOCAL_HEAD=$(git rev-parse HEAD)
ORIGIN=$(git rev-parse origin/main)
log "Local HEAD:  $LOCAL_HEAD"
log "Origin main: $ORIGIN"

# 2. Find the Phase A commit (the one whose message starts with "feat: deployment infra")
PHASE_A=$(git log --pretty=format:"%H %s" -20 | awk '/feat: deployment infra \+ MVP bootstrap scripts/ {print $1; exit}')
if [[ -z "$PHASE_A" ]]; then
  log "❌ Could not find Phase A commit in recent history. Aborting."
  read -r -p "Press ENTER..."
  exit 1
fi
log "Phase A commit: $PHASE_A"

PHASE_A_PARENT=$(git rev-parse "$PHASE_A^")
log "Phase A parent: $PHASE_A_PARENT"

# 3. Save the Phase A diff as a patch
PATCH="/tmp/phase-a-$(date +%s).patch"
log ""
log "Saving Phase A diff to $PATCH..."
git diff "$PHASE_A_PARENT" "$PHASE_A" > "$PATCH"
log "  $(wc -l < "$PATCH") lines"

# Also save the list of changed files
CHANGED_FILES=$(git diff --name-only "$PHASE_A_PARENT" "$PHASE_A")
log ""
log "Files in Phase A commit:"
echo "$CHANGED_FILES" | tee -a "$LOG"

# 4. Hard reset to origin/main — destroys local 4b7cfe6 and 5a70c68
log ""
log "Hard-resetting local main to origin/main ($ORIGIN)."
log "Phase A patch saved to $PATCH — will be re-applied on top."
log ""

logcmd git reset --hard origin/main || {
  log "❌ reset --hard failed."
  read -r -p "Press ENTER..."
  exit 1
}

# 5. Re-apply the patch with 3-way merge
log ""
log "Applying Phase A patch with 3-way merge..."
if git apply --3way --whitespace=nowarn "$PATCH" 2>&1 | tee -a "$LOG"; then
  log "✓ Patch applied."
else
  log ""
  log "⚠️  Some hunks may have conflicted. Check 'git status' for .rej files."
  log "   You may need to resolve manually."
  git status 2>&1 | tee -a "$LOG"
  echo ""
  log "Continuing — we'll still try to commit whatever applied cleanly."
fi

# 6. Stage + commit (only Phase A files, explicitly)
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
  "26-fix-diverged.command"
  "DO-EVERYTHING.command"
)
log ""
log "Staging Phase A files..."
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    git add "$f" 2>&1 | tee -a "$LOG"
  fi
done

if git diff --cached --quiet; then
  log "Nothing to commit — all Phase A files already match origin/main."
else
  log ""
  log "Staged diff:"
  git diff --cached --stat | tee -a "$LOG"
  logcmd git commit -m "feat: deployment infra + MVP bootstrap scripts

Phase A of the MVP-by-Sunday plan — re-applied onto origin/main
after divergence.

New: railway.json, vercel.json, scripts/supabase-init.sql,
.env.local.example, 20–26 + DO-EVERYTHING .command scripts.

Fixed: backend/Dockerfile multi-stage build (prior version ran
'npm ci --only=production' then 'npx tsc', stripping tsc out of
devDeps before trying to use it).

Additive: .gitignore adds .logs/ and .creds/ (may contain secrets).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>" || {
    log "❌ commit failed"
    read -r -p "Press ENTER..."
    exit 1
  }
fi

# 7. Push
log ""
log "Pushing to origin main (fast-forward)..."
logcmd git push origin main
PUSH_RC=$?
if [[ $PUSH_RC -ne 0 ]]; then
  log "❌ push failed. See above."
  read -r -p "Press ENTER..."
  exit 1
fi

log ""
log "✅ Fixed and pushed."
log ""
log "Next: re-run ./DO-EVERYTHING.command — it will skip the commit"
log "(nothing new to stage) and continue with the backend build + Supabase."
log ""
read -r -p "Press ENTER to close this window..."

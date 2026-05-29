#!/bin/bash
# PUSH-TO-NOTVEIKER.command
#
# One-shot: commit every pending local change and push to the new fork
# at https://github.com/notveiker/SCBC-Hackathon-2026 (branch: main).
#
# Why a script: the Cowork sandbox that Claude runs in can add a remote
# and edit .gitignore, but it can't touch `.git/` (a stale index.lock
# from an earlier interrupted commit sits there, and the sandbox has no
# stored GitHub credentials). This script runs in YOUR Mac shell so it
# clears the lock, uses your keychain credentials, and pushes cleanly.
#
# Safe to re-run: git add/commit are idempotent on a clean tree, and
# the remote setup uses `set-url` so re-adding `notveiker` won't error.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || { echo "cd failed"; exit 1; }

echo "===================================================================="
echo "  Pushing $(basename "$REPO_ROOT") → notveiker/SCBC-Hackathon-2026"
echo "===================================================================="

# 1. Clear every stale *.lock inside .git/ (index.lock, HEAD.lock, refs/*.lock,
#    packed-refs.lock). Earlier interrupted commits left more than just
#    index.lock around — nested ones like .git/refs/heads/main.lock also
#    block commits. Using `find` instead of a bash-4 globstar glob so this
#    works on macOS's default bash 3.2.
LOCK_LIST="$(find .git -type f -name '*.lock' 2>/dev/null)"
if [[ -n "$LOCK_LIST" ]]; then
  LOCK_COUNT=$(printf '%s\n' "$LOCK_LIST" | wc -l | tr -d ' ')
  echo "• Clearing $LOCK_COUNT stale lock file(s) in .git/:"
  printf '    %s\n' $LOCK_LIST
  find .git -type f -name '*.lock' -delete 2>/dev/null
fi

# 2. Ensure the `notveiker` remote points at the fork.
if git remote | grep -qx notveiker; then
  git remote set-url notveiker https://github.com/notveiker/SCBC-Hackathon-2026.git
else
  git remote add     notveiker https://github.com/notveiker/SCBC-Hackathon-2026.git
fi
echo "• Remotes:"
git remote -v | sed 's/^/    /'

# 3. Keep secrets + backup dirs out of history. Claude already added these
#    to .gitignore from the sandbox; this block is a belt-and-braces check
#    in case the file was reverted locally.
IGNORE_LINES=(
  "backend/fake-key.json"
  "_pre-main-sync-backup/"
  ".permtest"
  "init-vaults.log"
)
for line in "${IGNORE_LINES[@]}"; do
  grep -qxF "$line" .gitignore || echo "$line" >> .gitignore
done

# 4. If any of the sensitive files are already staged, unstage them.
for path in "backend/fake-key.json" "_pre-main-sync-backup" ".permtest" "init-vaults.log"; do
  git restore --staged "$path" 2>/dev/null || true
done

# 5. Stage everything else (tracked changes + new files respecting .gitignore).
git add -A

# 6. Double-check nothing sensitive slipped into the staging area.
if git diff --cached --name-only | grep -E '^(backend/fake-key\.json|_pre-main-sync-backup/|\.permtest$|init-vaults\.log$)' ; then
  echo "✗ Refusing to commit — a sensitive path is staged (see above)."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# 7. Commit (only if there is something to commit).
if ! git diff --cached --quiet ; then
  git commit -m "$(cat <<'EOF'
fix(portfolio+backend): filter phantom+withdrawn vaults, reset dev helpers

Portfolio page no longer double-counts STHS holdings against PPN/tranche
rows: on-chain STHS × live NAV drives Constellations, and tranche/PPN
principals trust a backend that now excludes any vault row with a NULL
`onchain_tx_signature` (cancelled-in-wallet deposits) or a status of
`withdrawn` (already-redeemed notes). Also brings back the RUN-BACKEND /
RUN-FRONTEND / RESTART-BACKEND helper scripts and ignores local secrets
(fake-key.json) + pre-merge backup dir.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
else
  echo "• Nothing new to commit — will push existing local commits."
fi

# 8. Push main to the fork. First try fast-forward; fall back to force-with-lease
#    only if the remote has diverged history (common for a fresh fork that
#    GitHub initialized with a README).
echo "• Pushing main → notveiker..."
if git push -u notveiker main ; then
  echo "✓ Push complete."
else
  echo ""
  echo "⚠ Fast-forward push rejected (remote has commits you don't)."
  echo "  The most common reason is that GitHub created an initial README"
  echo "  when you forked/created notveiker/SCBC-Hackathon-2026."
  echo ""
  read -r -p "Force-push with lease (overwrites notveiker/main)? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES)
      git push --force-with-lease -u notveiker main && echo "✓ Force push complete."
      ;;
    *)
      echo "• Aborted. You can inspect + merge manually with:"
      echo "    git fetch notveiker"
      echo "    git merge notveiker/main --allow-unrelated-histories"
      echo "    git push -u notveiker main"
      ;;
  esac
fi

echo ""
echo "Fork: https://github.com/notveiker/SCBC-Hackathon-2026"
read -r -p "Press ENTER to close this window..."

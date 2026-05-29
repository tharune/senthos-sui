#!/bin/bash
# ------------------------------------------------------------------------------
# MERGE-ALEX-UI.command
#
# Merge origin/alex-ui into main. The only conflict is in app/page.tsx (three
# tier-label lines around line 2617); we resolve it by taking Alex's version
# because the 90% / 70% / 50% labels match the backend tier IDs used
# everywhere else in the codebase, and Alex's rework supersedes main's
# narrower band tweak.
#
# Run from Finder by double-clicking, or:
#   bash MERGE-ALEX-UI.command
# ------------------------------------------------------------------------------

set -e
cd "$(dirname "$0")"

echo "==> Cleanup: remove stale .lock.gone* crud from prior sandbox attempts"
# Earlier sandbox sessions couldn't unlink git lockfiles, only rename them.
# The renamed crud sits in .git/ and .git/refs/heads/ — the ones inside
# refs/heads/ get treated as broken refs and blow up `git fetch`.
find .git -name "*.lock.gone*" -type f -print -delete 2>/dev/null || true
find .git -name "*.lock" -size 0 -type f -print -delete 2>/dev/null || true

echo
echo "==> Pre-flight"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "    on branch: $BRANCH"
if [ "$BRANCH" != "main" ]; then
  echo "    switching to main"
  git checkout main
fi

echo
echo "==> Fetch latest from origin"
git fetch origin --prune

echo
echo "==> Fast-forward main (if needed) so we merge on top of latest origin/main"
git pull --ff-only origin main || true

echo
echo "==> Verify alex-ui is 1 commit ahead of merge base and main is ahead too"
git log --oneline main...origin/alex-ui | head -20

echo
echo "==> Merge origin/alex-ui — expect conflict in app/page.tsx"
set +e
git merge --no-ff origin/alex-ui -m "merge: alex-ui — UI polish, nav rename, tier-label cleanup"
MERGE_EXIT=$?
set -e

if [ $MERGE_EXIT -ne 0 ]; then
  echo
  echo "==> Conflict detected (expected). Resolving app/page.tsx by taking Alex's version."
  # Take Alex's version of app/page.tsx in its entirety. The only conflicting
  # hunk is the three tier-label lines; alex-ui's surrounding file is
  # otherwise identical to HEAD's. If any other file conflicts, this will
  # still succeed for app/page.tsx but will leave others for manual review.
  if git status --short | grep -q "^UU app/page.tsx"; then
    git checkout --theirs -- app/page.tsx
    git add app/page.tsx
    echo "    ✓ app/page.tsx resolved (took alex-ui version)"
  fi

  # If anything else is still unmerged, bail out and let the user handle it.
  if git ls-files -u | grep -q .; then
    echo
    echo "!! Other files are still unmerged — resolve these manually:"
    git ls-files -u
    exit 1
  fi

  git commit --no-edit
fi

echo
echo "==> Merge complete. Current log:"
git log --oneline -6

echo
echo "==> Push to origin/main"
echo "(Ctrl+C now if you want to inspect before pushing)"
read -r -t 5 -p "Pushing in 5s… press Enter to push now, or Ctrl+C to abort: " _ || true
echo
git push origin main

echo
echo "==> Done."
echo
echo "Frontend will pick up Alex's UI changes on the next RUN-FRONTEND.command"
echo "reload (cache cleared automatically). No backend restart needed — Alex"
echo "touched zero backend files."

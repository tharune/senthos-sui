#!/bin/bash
# ------------------------------------------------------------------------------
# 50-commit-merge-push.command
#
# One-shot: stage the on-chain wiring work, commit on integration/full-wiring,
# fast-forward main, push everything to origin. Safe to re-run; skips no-op
# sub-steps.
#
# Run from Finder by double-click, or:
#   bash 50-commit-merge-push.command
#
# Requires:
#   - gh/git auth already set (the repo's remote uses HTTPS; make sure your
#     token or keychain credential is warm — `gh auth status` is a quick check).
#   - You're on the machine with the repo at its usual path; the script cds
#     into its own directory so relative paths are fine.
# ------------------------------------------------------------------------------

set -e
cd "$(dirname "$0")"

echo "==> Pre-flight"
git rev-parse --is-inside-work-tree > /dev/null
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "    on branch: $BRANCH"

if [ "$BRANCH" != "integration/full-wiring" ]; then
  echo "    switching to integration/full-wiring"
  git checkout integration/full-wiring
fi

echo
echo "==> Fetch latest from origin"
git fetch origin --prune

echo
echo "==> Stage only the production code (skip .env, backups, logs, debug probes)"
git add \
  app/app/_lib/deposit-client.ts \
  app/app/_lib/ppn-client.ts \
  app/app/_lib/portfolio-client.ts \
  app/app/_lib/lending-client.ts \
  app/app/_lib/wallet-bridge.ts \
  app/app/_lib/wallet.tsx \
  app/app/basket/\[id\]/page.tsx \
  app/app/ppn/page.tsx \
  app/app/tranche/\[id\]/page.tsx \
  app/app/portfolio/page.tsx \
  backend/src/routes/ppn.ts \
  backend/src/types/index.ts \
  backend/package-lock.json

echo
echo "==> Show what we're about to commit"
git status --short

echo
echo "==> Commit"
if git diff --cached --quiet; then
  echo "    (nothing staged — must already be committed; skipping)"
else
  git commit -m "feat(onchain): live wallet balances + real USDC→STHS swap across all 4 products

- Wire basket / PPN / tranche Buy buttons to Phantom via prepare → sign → confirm → persist
  (non-custodial: the backend never touches user funds).
- resolveBundleUuid: tier-matched fallback so the 9 synthetic Constellations
  cards route to an initialized LK-* vault on-chain instead of 404-ing.
- Live wallet USDC display via useUsdcBalance hook (replaces sandbox counter).
- Tranche buys ride the PPN rail, persisting (kind, attach, detach, price_per_token)
  as Supabase metadata — no program changes needed.
- Portfolio page shows the real wallet USDC slice in the donut / row list.
- Per-tx lifecycle UI (preparing → signing → confirming → persisting → done)
  + Explorer links + Phantom-reject short-circuit."
fi

echo
echo "==> Push integration/full-wiring"
git push -u origin integration/full-wiring

echo
echo "==> Switch to main, merge, push"
git checkout main
git pull --ff-only origin main
git merge --no-ff integration/full-wiring -m "merge: integration/full-wiring — on-chain wiring for all 4 products"
git push origin main

echo
echo "==> Done. Current state:"
git log --oneline -6
echo
echo "Open the PR / latest commits:"
echo "  https://github.com/LuKresXD/SCBC-Hackathon-2026/commits/main"

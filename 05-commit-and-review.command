#!/bin/bash
# Phase 5: commit the onchain work locally (no push).
# You review, then push whenever you're ready.
set +e
cd "$(dirname "$0")"
clear
echo "============================================="
echo " Phase 5: commit onchain work locally       "
echo "============================================="
echo

# Clear any stale lock
rm -f .git/index.lock 2>/dev/null

echo "---- git status (short) ----"
git status --short
echo

echo "---- Staging ----"
git add -A
git status --short
echo

echo "---- Committing ----"
git commit -m "$(cat <<'EOF'
feat: Traxis onchain programs + backend wiring

Two Anchor programs (traxis_vault, traxis_ppn) implementing the structured
prediction-market product: non-custodial deposits, admin-triggered leg
resolution, auto-finalization, and pro-rata USDC redemption. PPN program
wraps a Meteora-mock adapter; yield harvests CPI into traxis_vault::deposit
to buy TRAX with accumulated yield.

Backend additions:
- src/solana/{anchor,client}.ts — Anchor program handles, PDA derivations,
  tx builders (VersionedTransaction base64 out for Phantom), authority calls.
- src/services/solana.ts — replaces stub adapter with real implementation.
- src/services/onchain-bridge.ts — DB ↔ chain mirroring for leg resolutions
  and vault finalization.
- routes/deposit.ts — two-step /prepare + /confirm non-custodial flow.
- routes/webhook.ts — real Helius enhanced-transaction handler.
- routes/admin.ts — 5 new onchain ops endpoints.
- db/schema_onchain.sql — additive migration (vault_pda, trax_mint, leg_index).

Tests + scripts:
- tests/traxis_vault.test.ts + traxis_ppn.test.ts — full lifecycle.
- scripts/deploy-devnet.sh, init-demo-vaults.ts, demo-full-lifecycle.ts.

Docs:
- ONCHAIN_DESIGN.md (spec), ONCHAIN.md (ops guide), SECURITY.md (review),
  STATE.md (current build blocker + recovery path).

Build status at commit time: all code complete and backend typechecks
cleanly with real @solana/web3.js, @coral-xyz/anchor, @solana/spl-token.
Anchor build blocked on Rust 1.85+ vs platform-tools 1.79 compatibility;
see STATE.md Options A/B/C for recovery.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"

COMMIT_STATUS=$?
echo
if [ $COMMIT_STATUS -eq 0 ]; then
  echo "✓ Committed locally."
  echo
  echo "---- Latest commit ----"
  git log --oneline -1
  echo
  echo "Next step (YOU run this, not automated):"
  echo "  git push origin <your-branch>"
  echo
  echo "To see what was committed:"
  echo "  git show HEAD --stat"
else
  echo "Commit failed. See above."
fi
echo
read -p "Press Return..."

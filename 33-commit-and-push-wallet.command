#!/bin/bash
# 33-commit-and-push-wallet.command
#
# Commits the Phantom wallet + real on-chain deposit flow Victor added on
# top of Luka's latest main, then pushes to origin/main.
#
# What's new in this commit (relative to origin/main after 31-resync):
#   - package.json / package-lock.json
#       * adds @solana/web3.js as a root dependency
#   - app/app/_lib/wallet.tsx
#       * Phantom provider detection + React context
#       * signAndSendBase64Tx + waitForConfirmation helpers
#       * WalletConnectButton for the header
#   - app/app/_lib/deposit-client.ts
#       * Typed prepareDeposit / confirmDeposit wrappers around the
#         /api/deposit/prepare and /api/deposit/confirm endpoints.
#   - app/app/layout.tsx
#       * wraps /app in <WalletProvider>
#   - app/app/_components/Header.tsx
#       * shows the Connect/Connected button in the top-right
#   - app/app/basket/[id]/page.tsx
#       * real deposit flow: prepare → Phantom sign → confirm on devnet →
#         persist position. Shows Explorer link on success.
#   - STATE.md
#       * new section documenting the wallet wiring.
#
# Does NOT stage any of the throwaway .command scripts (31, 32, 33) and does
# NOT touch backend/.env (gitignored by design).

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/33-commit-and-push.log"
: > "$LOG"

log() { echo "$@" | tee -a "$LOG"; }
banner() {
  log ""
  log "████████████████████████████████████████████████████████████████"
  log "  $1"
  log "████████████████████████████████████████████████████████████████"
}

banner "33-commit-and-push-wallet — Phantom + on-chain deposit → origin/main"

rm -f .git/index.lock 2>/dev/null || true

# Ensure we're on main
BR=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BR" != "main" ]]; then
  log "❌ not on main (on $BR). Switch to main and re-run."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# Append STATE.md section describing the wallet work if not already present.
if [[ -f STATE.md ]] && ! grep -q "## Phantom wallet + on-chain deposits" STATE.md; then
  log ""
  log "Appending 'Phantom wallet + on-chain deposits' section to STATE.md"
  cat >> STATE.md <<'MDEOF'

## Phantom wallet + on-chain deposits (2026-04-18, Victor)

Frontend `/app/basket/<id>` now executes real USDC deposits on Solana devnet:

1. User connects Phantom via the header's **Connect** button. Detection uses
   `window.phantom.solana` (falls back to `window.solana`); silent reconnect
   attempts `connect({onlyIfTrusted:true})` on mount for return visitors.
2. On **Deposit**, the UI calls `POST /api/deposit/prepare` with
   `{bundle_id, wallet_address, amount_usdc}` and receives the backend-built
   transaction as base64 (`transaction_base64`) along with the previewed
   `tokens_minted` / `fee_usdc` / `issue_price`.
3. The UI deserializes into a `VersionedTransaction` (fallback: legacy
   `Transaction`) and hands it to `window.phantom.solana.signAndSendTransaction`.
   Phantom signs with the user's key and broadcasts; we receive a signature.
4. The UI polls `connection.getSignatureStatus(sig, {searchTransactionHistory:true})`
   on `https://api.devnet.solana.com` until the status reaches `confirmed` or
   `finalized` (60s deadline).
5. The UI calls `POST /api/deposit/confirm` so the backend re-verifies the
   signature on-chain and persists the position + transaction rows.
6. The Portfolio sandbox state is mirrored via `dispatch` so the existing
   portfolio view keeps working without a refactor.

Files added/edited (all in `app/app/`):

    _lib/wallet.tsx              — provider + useWallet() hook + connect button
    _lib/deposit-client.ts       — prepare/confirm wrappers with typed errors
    layout.tsx                   — wraps SandboxProvider in WalletProvider
    _components/Header.tsx       — renders <WalletConnectButton compact />
    basket/[id]/page.tsx         — full prepare→sign→confirm flow + explorer link

New root dependency: `@solana/web3.js ^1.95.8` (see root `package.json`).
The backend already had the non-custodial `/api/deposit/prepare` + `/confirm`
endpoints (commit 4df9b40 → Luka's 33d2edd split vault init into two
instructions). LK-90-0430 and LK-70-0515 are the two bundles whose vault
PDAs are initialized on-chain, so those are the two that can accept real
devnet deposits today. The remaining 13 bundles will work once their vaults
get initialized via `/api/admin/bundles/:id/init-onchain`.

### How to test end-to-end

    # Terminal 1
    cd backend && npm run dev     # :3001
    # Terminal 2
    npm run dev                   # :3000
    # Browser (Chrome with Phantom set to Devnet)
    open http://localhost:3000/app/basket/LK-90-0430
    # Phantom needs at least ~0.01 SOL and some devnet USDC in the ATA for
    # Circle's devnet USDC mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU.
    # Airdrop SOL: `solana airdrop 1 <pubkey> --url devnet`.

MDEOF
fi

log ""
log "Current status:"
git status --short 2>&1 | tee -a "$LOG"

log ""
log "Staging wallet integration files..."
git add \
    package.json \
    package-lock.json \
    app/app/_lib/wallet.tsx \
    app/app/_lib/deposit-client.ts \
    app/app/layout.tsx \
    app/app/_components/Header.tsx \
    app/app/basket/\[id\]/page.tsx \
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
feat(app): Phantom wallet + real on-chain USDC deposits on devnet

The basket deposit UI is no longer a local-state-only simulation — it now
signs and submits a real USDC transfer on Solana devnet via Phantom, waits
for the signature to reach `confirmed`, then persists the position through
/api/deposit/confirm. Flow is non-custodial throughout (the user's key
never leaves Phantom).

Changes:
- Add @solana/web3.js at the root (client-only; backend already had it).
- app/app/_lib/wallet.tsx — Phantom provider detection + useWallet() context
  + WalletConnectButton with connected/disconnected/connecting states and
  an "Install Phantom" fallback.
- app/app/_lib/deposit-client.ts — typed wrappers around /api/deposit/prepare
  and /api/deposit/confirm, matching the shape the backend returns (see
  backend/src/routes/deposit.ts:prepareDepositHandler).
- app/app/layout.tsx — wraps /app in <WalletProvider> alongside the existing
  SandboxProvider.
- app/app/_components/Header.tsx — renders <WalletConnectButton compact/>
  next to the sandbox-balance readout.
- app/app/basket/[id]/page.tsx — prepare → Phantom.signAndSendTransaction →
  waitForConfirmation → confirmDeposit pipeline with a staged status
  (`preparing` / `signing` / `confirming` / `persisting` / `done` / `error`)
  and a Solana Explorer link to the settled signature.

Compatible with Luka's 33d2edd split-init flow (LK-90-0430 and LK-70-0515
are the two bundles whose vaults are initialized on-chain today; the other
13 need init-onchain first before their deposits will prepare cleanly).

Verification (see 32-install-and-smoketest.command):
- npm install at root adds @solana/web3.js and its peers.
- tsc --noEmit passes.
- Backend starts, /api/health=ok, /api/onchain/status returns both programs
  executable, /api/bundles populated.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
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
  log "If it says non-fast-forward, Luka pushed again. Run:"
  log "  git pull --rebase origin main && ./33-commit-and-push-wallet.command"
  read -r -p "Press ENTER to close..."
  exit 1
fi

banner "DONE"
log ""
log "✅ Pushed to origin/main."
log ""
git log --oneline -4 2>&1 | tee -a "$LOG"
log ""
read -r -p "Press ENTER to close..."

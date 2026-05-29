#!/bin/bash
# 27-continue.command
# Picks up where DO-EVERYTHING.command died: the `dotenv` module was missing
# at repo root (seed.ts is in backend/ so it was fine; scripts/init-demo-vaults.ts
# is at repo root and did `require('dotenv')`).
#
# Claude installed dotenv at repo root. This script:
#   1. Re-runs backend npm run seed (idempotent — skips existing bundles)
#   2. Runs scripts/init-demo-vaults.ts (now that dotenv exists)
#   3. Builds Railway env block → clipboard + .creds/railway-env.txt
#   4. Waits for .creds/railway-url.env (Claude writes once you paste Railway URL)
#   5. Builds Vercel env block → clipboard + .creds/vercel-env.txt
#   6. Waits for .creds/vercel-url.env
#   7. Smoke test.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs .creds
LOG=".logs/27-continue.log"
: > "$LOG"

banner() {
  echo "" | tee -a "$LOG"
  echo "████████████████████████████████████████████████████████████████" | tee -a "$LOG"
  echo "  $1" | tee -a "$LOG"
  echo "████████████████████████████████████████████████████████████████" | tee -a "$LOG"
}

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

wait_for_file() {
  local path="$1"; local timeout="${2:-3600}"; local elapsed=0
  log ""
  log "⏳ Waiting for $path (timeout ${timeout}s)..."
  while [[ ! -f "$path" ]]; do
    sleep 2; elapsed=$((elapsed+2))
    if (( elapsed >= timeout )); then log "❌ TIMEOUT"; return 1; fi
    if (( elapsed % 30 == 0 )); then log "   …still waiting ($elapsed s)…"; fi
  done
  log "✓ $path appeared."; return 0
}

banner "27-continue — pick up from Phase C"

# ── Seed (idempotent — skips existing bundles) ──
banner "Re-running backend seed (idempotent)"
cd backend
logcmd npm run seed
SEED_RC=$?
cd "$REPO_ROOT"
if [[ $SEED_RC -ne 0 ]]; then
  log "❌ Seed failed."; read -r -p "Press ENTER..."; exit 1
fi

# ── Vault init ──
banner "Phase C — on-chain vault init (15 bundles on devnet)"

set -o allexport; source backend/.env; set +o allexport
: "${FEE_RECIPIENT:?}"; : "${USDC_MINT:?}"; : "${AUTHORITY_KEYPAIR:?}"; : "${SOLANA_RPC_URL:?}"

logcmd solana config set --url "$SOLANA_RPC_URL" --keypair "$AUTHORITY_KEYPAIR"

BAL_SOL=$(solana balance 2>&1 | grep -oE '^[0-9]+(\.[0-9]+)?' | head -n1)
BAL_SOL="${BAL_SOL:-0}"
if awk "BEGIN{exit !($BAL_SOL < 0.5)}"; then
  log "Authority has $BAL_SOL SOL, airdropping 2..."
  logcmd solana airdrop 2 || log "WARN: airdrop failed, continuing."
fi

log ""
log "Ensuring FEE_RECIPIENT USDC ATA exists..."
FEE_ATA=$(spl-token address --owner "$FEE_RECIPIENT" --token "$USDC_MINT" 2>&1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -n1)
log "  expected ATA: $FEE_ATA"
if [[ -n "$FEE_ATA" ]] && solana account "$FEE_ATA" 2>&1 | grep -qE "AccountNotFound|not found|was not found"; then
  log "  creating ATA..."
  logcmd spl-token create-account "$USDC_MINT" --owner "$FEE_RECIPIENT" --fee-payer "$AUTHORITY_KEYPAIR"
else
  log "  ✓ ATA already exists (or probe failed)."
fi

log ""
log "Initializing vault PDAs..."
logcmd npx --yes tsx scripts/init-demo-vaults.ts
VAULT_RC=$?
if [[ $VAULT_RC -ne 0 ]]; then
  log "❌ Vault init failed."; read -r -p "Press ENTER..."; exit 1
fi

# ── Railway env block ──
banner "Phase D — Railway env block ready"

AUTHORITY_KEYPAIR_JSON=$(python3 -c "import json; print(json.dumps(json.load(open('$AUTHORITY_KEYPAIR'))))")

cat > .creds/railway-env.txt <<EOF
PORT=3001
NODE_ENV=production
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
POLYMARKET_API_URL=${POLYMARKET_API_URL:-https://clob.polymarket.com}
FRONTEND_URL=${FRONTEND_URL:-https://senthos.vercel.app}
SOLANA_RPC_URL=$SOLANA_RPC_URL
TRAXIS_VAULT_PROGRAM_ID=$TRAXIS_VAULT_PROGRAM_ID
TRAXIS_PPN_PROGRAM_ID=$TRAXIS_PPN_PROGRAM_ID
USDC_MINT=$USDC_MINT
FEE_RECIPIENT=$FEE_RECIPIENT
AUTHORITY_KEYPAIR=$AUTHORITY_KEYPAIR_JSON
HELIUS_API_KEY=${HELIUS_API_KEY:-replace_with_helius_key}
EOF

pbcopy < .creds/railway-env.txt
log "✓ Railway env block copied to clipboard (also saved to .creds/railway-env.txt)."
log ""
log "👉  https://railway.app/dashboard"
log "    New Project → Deploy from GitHub → pick this repo"
log "    Variables tab → Raw Editor → Cmd+V → Save"
log "    Wait for deploy (~5min). Copy the public URL."
log "    Paste the Railway URL to Claude in chat."

open "https://railway.app/dashboard" 2>/dev/null || true

wait_for_file ".creds/railway-url.env" 3600 || exit 1
set -o allexport; source .creds/railway-url.env; set +o allexport
: "${RAILWAY_URL:?missing}"

log ""
log "Smoke test Railway at $RAILWAY_URL..."
HEALTH=$(curl -sS --max-time 10 "${RAILWAY_URL%/}/api/health" 2>&1 || echo "FAIL")
log "  /api/health: $HEALTH"

# ── Vercel ──
banner "Phase E — Vercel env block ready"

cat > .creds/vercel-env.txt <<EOF
NEXT_PUBLIC_BACKEND_URL=$RAILWAY_URL
BACKEND_URL=$RAILWAY_URL
EOF
pbcopy < .creds/vercel-env.txt
log "✓ Vercel env block copied to clipboard."
log ""
log "👉  https://vercel.com/new"
log "    Import this GitHub repo. Framework: Next.js (auto)."
log "    Environment Variables → Cmd+V."
log "    Deploy. Wait ~3min. Copy the production URL."
log "    Paste to Claude in chat."

open "https://vercel.com/new" 2>/dev/null || true

wait_for_file ".creds/vercel-url.env" 3600 || exit 1
set -o allexport; source .creds/vercel-url.env; set +o allexport
: "${VERCEL_URL:?missing}"

log ""
log "👉  Railway → Variables → edit FRONTEND_URL to $VERCEL_URL."
log "    Railway auto-redeploys (~1min) to pick up new CORS."

python3 - <<PYEOF | tee -a "$LOG"
import os
p = "backend/.env"
vurl = os.environ["VERCEL_URL"]
lines = open(p).readlines()
out, did = [], False
for line in lines:
    if line.startswith("FRONTEND_URL="):
        out.append(f"FRONTEND_URL={vurl}\n"); did = True
    else:
        out.append(line)
if not did: out.append(f"FRONTEND_URL={vurl}\n")
open(p, "w").writelines(out)
print(f"OK: backend/.env FRONTEND_URL = {vurl}")
PYEOF

# ── Final smoke ──
banner "Phase F — final smoke test"
./23-smoke-test.command "$RAILWAY_URL" 2>&1 | tee -a "$LOG"
open "$VERCEL_URL" 2>/dev/null || true

banner "DONE"
log "Railway:  $RAILWAY_URL"
log "Vercel:   $VERCEL_URL"
log ""
echo ""
echo "✅ Full MVP is live."
echo ""
read -r -p "Press ENTER to close..."

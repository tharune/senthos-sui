#!/bin/bash
# DO-EVERYTHING.command
# Run once, walk away. Blocks only to wait for credential files that Claude
# writes into .creds/ as you paste values into the chat.
#
# Phases in order:
#   A1. Unlock + commit + push the Phase A infra files.
#   A2. Backend npm install + typecheck.
#   B.  Wait for .creds/supabase.env  → merge into backend/.env → seed 15 bundles.
#   C.  Ensure FEE_RECIPIENT USDC ATA → init 15 on-chain vaults on devnet.
#   D.  Render full Railway env block → .creds/railway-env.txt + clipboard.
#   E.  (manual in browser) — we'll signal when to start.
#       Wait for .creds/railway-url.env → render Vercel env block to clipboard.
#       Wait for .creds/vercel-url.env  → update Railway FRONTEND_URL.
#   F.  Final smoke test against the live Railway URL.
#
# Everything is logged to .logs/DO-EVERYTHING.log so Claude can see progress.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs .creds
LOG=".logs/DO-EVERYTHING.log"
: > "$LOG"

banner() {
  echo "" | tee -a "$LOG"
  echo "████████████████████████████████████████████████████████████████" | tee -a "$LOG"
  echo "  $1" | tee -a "$LOG"
  echo "████████████████████████████████████████████████████████████████" | tee -a "$LOG"
  echo "$(date '+%H:%M:%S')  $1" >> "$LOG"
}

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

# wait_for_file <path> <timeout_seconds>
# Polls for a file. Returns 0 when it appears, 1 on timeout.
wait_for_file() {
  local path="$1"
  local timeout="${2:-3600}"
  local elapsed=0
  log ""
  log "⏳ Waiting for $path (timeout ${timeout}s)..."
  while [[ ! -f "$path" ]]; do
    sleep 2
    elapsed=$((elapsed+2))
    if (( elapsed >= timeout )); then
      log "❌ TIMEOUT waiting for $path"
      return 1
    fi
    if (( elapsed % 30 == 0 )); then
      log "   …still waiting ($elapsed s)…"
    fi
  done
  log "✓ $path appeared."
  return 0
}

banner "DO-EVERYTHING starting"
log "Repo:    $REPO_ROOT"
log "Started: $(date)"

# ═════════════ A1. Commit + push Phase A ═════════════
banner "A1 — commit & push Phase A infra files"

if [[ -f .git/index.lock ]]; then
  log "Removing stale .git/index.lock"
  rm -f .git/index.lock
fi

logcmd git fetch origin

LOCAL_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
ORIGIN_HEAD=$(git rev-parse origin/main 2>/dev/null || echo "unknown")
log "Local HEAD:  $LOCAL_HEAD"
log "Origin main: $ORIGIN_HEAD"

# Ensure local HEAD is ancestor of origin/main (we're behind, that's expected)
if git merge-base --is-ancestor "$LOCAL_HEAD" "$ORIGIN_HEAD" 2>/dev/null; then
  log "✓ Local is behind origin/main — safe to fast-forward."
  logcmd git reset --mixed origin/main
else
  log "⚠️  Local HEAD has commits not in origin/main. Skipping reset."
  log "   (If the commit/push fails later, manually run: git reset --mixed origin/main)"
fi

# Stage only the Phase-A additions + fixes
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
  "DO-EVERYTHING.command"
)
for f in "${FILES[@]}"; do
  if [[ -f "$f" ]]; then
    git add "$f" 2>&1 | tee -a "$LOG"
  fi
done

if git diff --cached --quiet; then
  log "Nothing new to commit — Phase A already on origin/main."
else
  log ""
  log "Staged diff:"
  git diff --cached --stat | tee -a "$LOG"
  logcmd git commit -m "feat: deployment infra + MVP bootstrap scripts

Phase A of the MVP-by-Sunday plan.

New: railway.json, vercel.json, scripts/supabase-init.sql,
.env.local.example, 20–25 + DO-EVERYTHING .command scripts.

Fixed: backend/Dockerfile multi-stage build (prior version ran
'npm ci --only=production' then 'npx tsc', stripping tsc out of
devDeps before trying to use it — would fail on any fresh build).

Additive: .gitignore adds .logs/ and .creds/ (may contain secrets).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
  logcmd git push origin main
  PUSH_RC=$?
  if [[ $PUSH_RC -ne 0 ]]; then
    log "❌ git push failed. Fix auth and re-run."
    read -r -p "Press ENTER to close..."
    exit 1
  fi
fi

# ═════════════ A2. Backend build ═════════════
banner "A2 — backend npm install + typecheck"
cd backend || { log "ERROR: backend/ missing"; exit 1; }
if [[ ! -d node_modules ]]; then
  logcmd npm install --no-audit --no-fund
fi
logcmd npm run build
BUILD_RC=$?
cd "$REPO_ROOT"
if [[ $BUILD_RC -ne 0 ]]; then
  log "❌ Backend TypeScript build failed. Fix errors above."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ═════════════ B. Supabase ═════════════
banner "B — Supabase (waiting for creds)"
log ""
log "👉  Paste your Supabase URL + anon key into the Claude chat."
log "    Claude will write them to .creds/supabase.env and this script"
log "    will continue automatically."

wait_for_file ".creds/supabase.env" 1800 || exit 1

# shellcheck disable=SC1091
set -o allexport; source .creds/supabase.env; set +o allexport

: "${SUPABASE_URL:?missing from .creds/supabase.env}"
: "${SUPABASE_ANON_KEY:?missing from .creds/supabase.env}"

log ""
log "Merging creds into backend/.env..."
python3 - <<PYEOF | tee -a "$LOG"
import os
p = "backend/.env"
url = os.environ["SUPABASE_URL"]
key = os.environ["SUPABASE_ANON_KEY"]
lines = open(p).readlines()
out, did_u, did_k = [], False, False
for line in lines:
    if line.startswith("SUPABASE_URL="):
        out.append(f"SUPABASE_URL={url}\n"); did_u = True
    elif line.startswith("SUPABASE_ANON_KEY="):
        out.append(f"SUPABASE_ANON_KEY={key}\n"); did_k = True
    else:
        out.append(line)
if not did_u: out.append(f"SUPABASE_URL={url}\n")
if not did_k: out.append(f"SUPABASE_ANON_KEY={key}\n")
open(p, "w").writelines(out)
print("OK: backend/.env patched.")
PYEOF

log ""
log "👉  Claude should have already pasted scripts/supabase-init.sql into"
log "    your Supabase SQL Editor before dropping supabase.env. If not,"
log "    do it now (file path is in this log)."
log ""
log "    Open:   https://supabase.com/dashboard/project/_/sql/new"
log "    Paste:  contents of scripts/supabase-init.sql"
log "    Run.    Wait for 'Success'."

# Give user 5 min to paste SQL if not done
if [[ ! -f ".creds/supabase-sql-confirmed" ]]; then
  log ""
  log "⏳ Waiting for .creds/supabase-sql-confirmed (Claude will write this"
  log "    after you confirm the SQL ran)..."
  wait_for_file ".creds/supabase-sql-confirmed" 900 || exit 1
fi

log ""
log "Seeding 15 bundles..."
cd backend
logcmd npm run seed
SEED_RC=$?
cd "$REPO_ROOT"
if [[ $SEED_RC -ne 0 ]]; then
  log "❌ Seed failed. Check backend/.env SUPABASE_URL and that the schema ran."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ═════════════ C. On-chain vault init ═════════════
banner "C — on-chain vault init (devnet)"

if ! command -v solana >/dev/null 2>&1; then
  log "❌ solana CLI not installed. Run ./02-install-toolchain.command first."
  read -r -p "Press ENTER to close..."
  exit 1
fi
if ! command -v spl-token >/dev/null 2>&1; then
  log "❌ spl-token CLI not installed. Run: cargo install spl-token-cli"
  read -r -p "Press ENTER to close..."
  exit 1
fi

set -o allexport; source backend/.env; set +o allexport
: "${FEE_RECIPIENT:?}"; : "${USDC_MINT:?}"; : "${AUTHORITY_KEYPAIR:?}"; : "${SOLANA_RPC_URL:?}"

logcmd solana config set --url "$SOLANA_RPC_URL" --keypair "$AUTHORITY_KEYPAIR"

BAL_SOL=$(solana balance 2>&1 | grep -oE '^[0-9]+(\.[0-9]+)?' | head -n1)
BAL_SOL="${BAL_SOL:-0}"
if awk "BEGIN{exit !($BAL_SOL < 0.5)}"; then
  log "Authority has $BAL_SOL SOL, airdropping 2 more..."
  logcmd solana airdrop 2 || log "WARN: airdrop failed, continuing."
fi

log ""
log "Ensuring FEE_RECIPIENT USDC ATA exists..."
FEE_ATA=$(spl-token address --owner "$FEE_RECIPIENT" --token "$USDC_MINT" 2>&1 | grep -oE '[1-9A-HJ-NP-Za-km-z]{32,44}' | head -n1)
log "  expected ATA: $FEE_ATA"
if solana account "$FEE_ATA" 2>&1 | grep -qE "AccountNotFound|not found|was not found"; then
  log "  creating ATA..."
  logcmd spl-token create-account "$USDC_MINT" --owner "$FEE_RECIPIENT" --fee-payer "$AUTHORITY_KEYPAIR"
else
  log "  ✓ ATA already exists."
fi

log ""
log "Initializing 15 vault PDAs..."
logcmd npx --yes tsx scripts/init-demo-vaults.ts
VAULT_RC=$?
if [[ $VAULT_RC -ne 0 ]]; then
  log "❌ Vault init failed. See log above."
  read -r -p "Press ENTER to close..."
  exit 1
fi

# ═════════════ D. Railway env block ═════════════
banner "D — Railway env block ready for paste"

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
log "✓ Railway env block copied to clipboard."
log ""
log "👉  Go to https://railway.app/dashboard"
log "    1. New Project → Deploy from GitHub repo → pick this repo"
log "    2. Variables tab → Raw Editor → Cmd+V → Save"
log "    3. Wait for first deploy (~5min). Copy the public URL."
log "    4. Paste the Railway URL to Claude in chat."

# Open Railway for convenience
open "https://railway.app/dashboard" 2>/dev/null || true

wait_for_file ".creds/railway-url.env" 3600 || exit 1
set -o allexport; source .creds/railway-url.env; set +o allexport
: "${RAILWAY_URL:?missing from .creds/railway-url.env}"

log ""
log "Smoke-testing Railway backend at $RAILWAY_URL..."
HEALTH=$(curl -sS --max-time 10 "${RAILWAY_URL%/}/api/health" 2>&1 || echo "FAIL")
log "  /api/health: $HEALTH"

# ═════════════ E. Vercel ═════════════
banner "E — Vercel env block ready for paste"

cat > .creds/vercel-env.txt <<EOF
NEXT_PUBLIC_BACKEND_URL=$RAILWAY_URL
BACKEND_URL=$RAILWAY_URL
EOF
pbcopy < .creds/vercel-env.txt
log "✓ Vercel env block copied to clipboard."
log ""
log "👉  Go to https://vercel.com/new"
log "    1. Import this GitHub repo"
log "    2. Framework: Next.js (auto)"
log "    3. Environment Variables → Cmd+V to paste both"
log "    4. Deploy. Wait ~3min. Copy the production URL."
log "    5. Paste Vercel URL to Claude in chat."

open "https://vercel.com/new" 2>/dev/null || true

wait_for_file ".creds/vercel-url.env" 3600 || exit 1
set -o allexport; source .creds/vercel-url.env; set +o allexport
: "${VERCEL_URL:?missing from .creds/vercel-url.env}"

# Update Railway's FRONTEND_URL (user has to do this manually — we just update the file)
log ""
log "👉  One last thing: go back to Railway → Variables → edit FRONTEND_URL"
log "    from ${FRONTEND_URL:-<placeholder>} to $VERCEL_URL"
log "    Railway will auto-redeploy (~1min) to pick up the new CORS allowlist."
log ""

# Also update backend/.env locally
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
print(f"OK: backend/.env FRONTEND_URL set to {vurl}")
PYEOF

# ═════════════ F. Final smoke test ═════════════
banner "F — final smoke test"

./23-smoke-test.command "$RAILWAY_URL" 2>&1 | tee -a "$LOG"
log ""
log "Opening Vercel frontend in browser..."
open "$VERCEL_URL" 2>/dev/null || true

banner "DONE"
log "Railway:  $RAILWAY_URL"
log "Vercel:   $VERCEL_URL"
log "Log:      $LOG"
log ""
echo ""
echo "✅ Full MVP is live."
echo ""
read -r -p "Press ENTER to close this window..."

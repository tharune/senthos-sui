#!/bin/bash
# 20-supabase-setup.command
# Phase B of the MVP setup flow.
#
# What this does (all local to this Mac):
#   1. Prompts for SUPABASE_URL and SUPABASE_ANON_KEY (from the project you
#      just created at https://supabase.com/dashboard).
#   2. Writes them into backend/.env (replacing the placeholders).
#   3. Opens scripts/supabase-init.sql so you can paste it into the Supabase
#      SQL Editor. Pauses until you confirm the SQL ran successfully.
#   4. Runs `npm run setup` inside backend/ to verify the tables exist.
#   5. Runs `npm run seed` to populate 15 demo bundles + 150 legs.
#   6. Dumps a detailed diagnostic to .logs/20-supabase-setup.log so the
#      next Claude turn can read what happened.
#
# Re-runs are safe. If the env already has real values, the script still
# re-verifies and re-seeds (seed is idempotent — bundles are UPSERT'd).

set -u  # don't use -e; we want to capture failures and still write the log

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/20-supabase-setup.log"
: > "$LOG"

log()   { echo "$@" | tee -a "$LOG"; }
logcmd(){ echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

log "=== 20-supabase-setup.command ==="
log "Started: $(date)"
log "Repo:    $REPO_ROOT"
log ""

# ---------- 1. Prompt for creds ----------
echo ""
echo "================================================================"
echo "  STEP 1 — Supabase credentials"
echo "================================================================"
echo ""
echo "Open your Supabase project in a browser:"
echo "  https://supabase.com/dashboard/project/_/settings/api"
echo ""
echo "Copy:"
echo "  • Project URL            → https://xxxxx.supabase.co"
echo "  • Project anon/public key → starts with 'eyJhbGciOi...' (long JWT)"
echo ""
read -r -p "SUPABASE_URL: " SUPABASE_URL_INPUT
read -r -p "SUPABASE_ANON_KEY: " SUPABASE_ANON_KEY_INPUT

if [[ -z "$SUPABASE_URL_INPUT" || -z "$SUPABASE_ANON_KEY_INPUT" ]]; then
  log "ERROR: Empty URL or key. Aborting."
  echo ""
  echo "Re-run this script and paste both values when prompted."
  exit 1
fi

# Sanity check format (don't be strict — Supabase URLs vary)
if [[ "$SUPABASE_URL_INPUT" != http* ]]; then
  log "WARN: SUPABASE_URL doesn't start with http — continuing anyway."
fi
if [[ ${#SUPABASE_ANON_KEY_INPUT} -lt 40 ]]; then
  log "WARN: SUPABASE_ANON_KEY is suspiciously short (${#SUPABASE_ANON_KEY_INPUT} chars)."
fi

# ---------- 2. Patch backend/.env ----------
echo ""
echo "================================================================"
echo "  STEP 2 — Updating backend/.env"
echo "================================================================"

ENVFILE="backend/.env"
if [[ ! -f "$ENVFILE" ]]; then
  log "ERROR: $ENVFILE not found. Make sure you're running from repo root."
  exit 1
fi

# Back up original
cp "$ENVFILE" "$ENVFILE.bak.$(date +%s)"

# Use a python one-liner to avoid sed escaping headaches with JWT characters
python3 - <<PYEOF
import os
p = "backend/.env"
url = os.environ["SUP_URL"]
key = os.environ["SUP_KEY"]
with open(p) as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("SUPABASE_URL="):
        out.append(f"SUPABASE_URL={url}\n")
    elif line.startswith("SUPABASE_ANON_KEY="):
        out.append(f"SUPABASE_ANON_KEY={key}\n")
    else:
        out.append(line)
with open(p, "w") as f:
    f.writelines(out)
print("OK: backend/.env patched.")
PYEOF
RC=$?
export SUP_URL="$SUPABASE_URL_INPUT"
export SUP_KEY="$SUPABASE_ANON_KEY_INPUT"

# Retry with envs actually exported (the heredoc ran before `export` above on some shells)
python3 - <<'PYEOF' | tee -a "$LOG"
import os
p = "backend/.env"
url = os.environ["SUP_URL"]
key = os.environ["SUP_KEY"]
with open(p) as f:
    lines = f.readlines()
out = []
did_url = did_key = False
for line in lines:
    if line.startswith("SUPABASE_URL="):
        out.append(f"SUPABASE_URL={url}\n"); did_url = True
    elif line.startswith("SUPABASE_ANON_KEY="):
        out.append(f"SUPABASE_ANON_KEY={key}\n"); did_key = True
    else:
        out.append(line)
if not did_url:
    out.append(f"SUPABASE_URL={url}\n")
if not did_key:
    out.append(f"SUPABASE_ANON_KEY={key}\n")
with open(p, "w") as f:
    f.writelines(out)
print("OK: SUPABASE_URL + SUPABASE_ANON_KEY written to backend/.env")
PYEOF

log ""
log "backend/.env (SUPABASE lines):"
grep -n "^SUPABASE_" backend/.env | sed 's/=.*/=<set>/' | tee -a "$LOG"

# ---------- 3. Paste schema ----------
echo ""
echo "================================================================"
echo "  STEP 3 — Create tables in Supabase"
echo "================================================================"
echo ""
echo "1. Open your Supabase project's SQL Editor:"
echo "     https://supabase.com/dashboard/project/_/sql/new"
echo ""
echo "2. Copy the SQL file that was just opened (or paste from clipboard)."
echo "3. Paste it into the editor and click 'Run'."
echo "4. You should see: 'Success. No rows returned' (or a few NOTICE lines)."
echo ""
echo "Opening scripts/supabase-init.sql in your default editor..."
echo "(And copying it to your clipboard for pasting.)"

if command -v pbcopy >/dev/null 2>&1; then
  pbcopy < scripts/supabase-init.sql
  echo "  ✓ Copied to clipboard"
else
  echo "  ! pbcopy not available — open the file manually"
fi

open scripts/supabase-init.sql 2>/dev/null || true

echo ""
read -r -p "Press ENTER once the SQL has run successfully in Supabase... "

# ---------- 4. Verify + seed ----------
echo ""
echo "================================================================"
echo "  STEP 4 — Verifying schema + seeding bundles"
echo "================================================================"

cd backend || { log "ERROR: cannot cd into backend"; exit 1; }

# Make sure deps are present
if [[ ! -d node_modules ]]; then
  log "node_modules missing — running npm install"
  logcmd npm install
fi

log ""
log "--- Running: npm run setup (checks Supabase connectivity) ---"
logcmd npm run setup
SETUP_RC=$?
log "setup exit: $SETUP_RC"

log ""
log "--- Running: npm run seed (15 bundles + 150 legs) ---"
logcmd npm run seed
SEED_RC=$?
log "seed exit: $SEED_RC"

cd "$REPO_ROOT" || true

# ---------- 5. Final summary ----------
log ""
log "================================================================"
log "  Phase B complete"
log "================================================================"
log "setup exit code: $SETUP_RC"
log "seed  exit code: $SEED_RC"
log ""
log "Next step: run ./21-init-onchain-vaults.command"
log "Finished: $(date)"

echo ""
if [[ $SETUP_RC -eq 0 && $SEED_RC -eq 0 ]]; then
  echo "✅ Supabase configured, schema verified, 15 bundles seeded."
  echo "   → Next: ./21-init-onchain-vaults.command"
else
  echo "⚠️  Something failed. Open .logs/20-supabase-setup.log and share it."
fi
echo ""
read -r -p "Press ENTER to close this window..."

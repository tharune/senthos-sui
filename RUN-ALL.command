#!/bin/bash
# RUN-ALL.command
# Single double-click orchestrator. Runs every Phase A/B/C/D script in
# sequence. Pauses only where the step genuinely requires human action
# (creating a Supabase project, clicking Deploy on Railway, etc.).
#
# If any step fails, this script stops and tells you which .logs/ file
# to look at. Re-running is safe — every sub-script is idempotent.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
MAIN_LOG=".logs/RUN-ALL.log"
: > "$MAIN_LOG"

banner() {
  echo ""
  echo "████████████████████████████████████████████████████████████████"
  echo "  $1"
  echo "████████████████████████████████████████████████████████████████"
  echo ""
  echo "$(date)  $1" >> "$MAIN_LOG"
}

run_step() {
  local script="$1"
  local label="$2"
  banner "$label"
  if [[ ! -x "$script" ]]; then
    echo "ERROR: $script not executable. chmod +x first." | tee -a "$MAIN_LOG"
    exit 1
  fi
  # Run the child script inheriting stdin/stdout. It handles its own logging.
  "./$script"
  local rc=$?
  echo "[$script exited $rc]" | tee -a "$MAIN_LOG"
  if [[ $rc -ne 0 ]]; then
    echo ""
    echo "❌ $script failed with exit code $rc."
    echo "   Check the corresponding log in .logs/ and fix before re-running."
    echo ""
    read -r -p "Press ENTER to close this window..."
    exit $rc
  fi
}

pause_for_human() {
  local msg="$1"
  banner "HUMAN ACTION REQUIRED"
  echo "$msg"
  echo ""
  read -r -p "Press ENTER once you've done the above..."
}

banner "RUN-ALL — Phase A through F"
echo "This will run 7 sub-scripts, pausing only where your input is"
echo "genuinely required (Supabase project, Railway deploy, Vercel deploy)."
echo ""
read -r -p "Ready? Press ENTER to start..."

# ───────── Phase A: commit + build ─────────
run_step "25-commit-phase-a.command"  "STEP 1/7 — commit Phase A files to main"
run_step "24-verify-build.command"    "STEP 2/7 — verify backend build (catches errors before Railway does)"

# ───────── Phase B: Supabase ─────────
pause_for_human "Open https://supabase.com/dashboard and create a NEW project.

  • Project name: senthos (or whatever)
  • Region:       closest to you (e.g., us-east-1)
  • Database password: generate and save it somewhere (not needed today)
  • Plan:         Free

Wait ~60 seconds for the project to finish provisioning.

When it's ready, the next step will ask for the project URL and anon key.
You'll find them at: Project Settings → API."

run_step "20-supabase-setup.command"  "STEP 3/7 — Supabase schema + seed 15 bundles"

# ───────── Phase C: on-chain ─────────
run_step "21-init-onchain-vaults.command"  "STEP 4/7 — Solana devnet vault PDAs + USDC ATA"

# ───────── Phase D: Railway deploy ─────────
run_step "22-railway-env-export.command"   "STEP 5/7 — build Railway env block (copied to clipboard)"

pause_for_human "Open https://railway.app/dashboard and deploy:

  1. New Project → Deploy from GitHub repo
  2. Pick your senthos repo, branch: main
  3. Leave Root Directory blank (railway.json handles the build context)
  4. Variables tab → Raw Editor → paste from clipboard (already copied)
  5. Click Deploy. First build takes ~5 minutes.
  6. Once the deploy is green, copy the public URL
     (https://senthos-backend-production.up.railway.app or similar)

When ready, the next step will ask you to paste the Railway URL."

echo ""
read -r -p "Paste your Railway backend URL (or press ENTER to skip smoke test): " RAILWAY_URL
if [[ -n "$RAILWAY_URL" ]]; then
  # Record it so the rest of the script can use it
  echo "$RAILWAY_URL" > .logs/railway-url.txt
  banner "STEP 6/7 — smoke test Railway backend"
  ./23-smoke-test.command "$RAILWAY_URL"
  echo "[23-smoke-test.command (railway) exited $?]" | tee -a "$MAIN_LOG"
fi

# ───────── Phase E: Vercel deploy ─────────
pause_for_human "Open https://vercel.com/new and deploy the frontend:

  1. Import the senthos GitHub repo
  2. Framework: Next.js (auto-detected)
  3. Environment Variables:
       NEXT_PUBLIC_BACKEND_URL = ${RAILWAY_URL:-<your Railway URL>}
       BACKEND_URL             = ${RAILWAY_URL:-<your Railway URL>}
  4. Click Deploy. Takes ~3 minutes.
  5. Copy the production URL (https://senthos.vercel.app or similar)

Then go back to Railway:
  • Project → Variables → edit FRONTEND_URL to the Vercel URL you just got
  • Railway will auto-redeploy (~1 min) to pick up the new CORS allowlist

When ready, the next step will verify everything end-to-end."

echo ""
read -r -p "Paste your Vercel frontend URL (or press ENTER to skip final smoke): " VERCEL_URL
if [[ -n "$VERCEL_URL" ]]; then
  echo "$VERCEL_URL" > .logs/vercel-url.txt
  banner "STEP 7/7 — final smoke test"
  echo "Hitting Railway backend one more time to confirm CORS allows Vercel..."
  if [[ -n "${RAILWAY_URL:-}" ]]; then
    ./23-smoke-test.command "$RAILWAY_URL"
  fi
  echo ""
  echo "Opening Vercel frontend in your browser to eyeball it..."
  open "$VERCEL_URL" 2>/dev/null || true
fi

banner "RUN-ALL complete"
echo ""
echo "Summary saved to .logs/RUN-ALL.log"
echo ""
echo "Individual script logs in .logs/:"
ls -la .logs/*.log 2>/dev/null | awk '{print "  " $NF}'
echo ""
[[ -n "${RAILWAY_URL:-}" ]] && echo "Backend:  $RAILWAY_URL"
[[ -n "${VERCEL_URL:-}" ]]  && echo "Frontend: $VERCEL_URL"
echo ""
read -r -p "Press ENTER to close this window..."

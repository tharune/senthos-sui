#!/bin/bash
# 22-railway-env-export.command
# Phase D prep — produce a clean list of env vars to paste into Railway.
#
# The tricky bit: AUTHORITY_KEYPAIR in backend/.env is a FILE PATH
# (/Users/victor/.config/solana/id.json), which won't work on Railway's
# container. Railway needs the keypair as the raw JSON-array literal.
# This script reads the file and prints the array, so you can paste it.
#
# It also:
#   • Redacts nothing — this output is secret. Don't commit it.
#   • Flags any placeholder values that are still unset.
#   • Writes the full export to .logs/22-railway-env.txt (gitignored).
#   • Copies the key=value block to your clipboard (Railway's "Raw Editor"
#     accepts this format for bulk paste).

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
OUT=".logs/22-railway-env.txt"
: > "$OUT"

# Don't log this to a shared file — it contains secrets. OUT is gitignored.

if [[ ! -f backend/.env ]]; then
  echo "ERROR: backend/.env missing."
  exit 1
fi

# shellcheck disable=SC1091
set -o allexport; source backend/.env; set +o allexport

# Convert AUTHORITY_KEYPAIR from file path → inline JSON array (one line, no whitespace)
if [[ -f "$AUTHORITY_KEYPAIR" ]]; then
  AUTHORITY_KEYPAIR_JSON="$(python3 -c "import json,sys; print(json.dumps(json.load(open('$AUTHORITY_KEYPAIR'))))")"
else
  echo "ERROR: AUTHORITY_KEYPAIR path '$AUTHORITY_KEYPAIR' is not a file."
  echo "       Railway can only receive the inline JSON array literal."
  exit 1
fi

# Collect Railway env. FRONTEND_URL will be filled in after Vercel deploy —
# we default to '*' placeholder which the backend treats as permissive CORS.
FRONTEND_URL_VALUE="${FRONTEND_URL:-https://senthos.vercel.app}"

cat >> "$OUT" <<EOF
# ============================================================
# Railway → senthos-backend → Variables → Raw Editor
# Paste everything below. Replace FRONTEND_URL once Vercel is live.
# ============================================================

PORT=3001
NODE_ENV=production

# ---------- Supabase ----------
SUPABASE_URL=$SUPABASE_URL
SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY

# ---------- External APIs ----------
POLYMARKET_API_URL=${POLYMARKET_API_URL:-https://clob.polymarket.com}
FRONTEND_URL=$FRONTEND_URL_VALUE

# ---------- Solana ----------
SOLANA_RPC_URL=${SOLANA_RPC_URL:-https://api.devnet.solana.com}
TRAXIS_VAULT_PROGRAM_ID=$TRAXIS_VAULT_PROGRAM_ID
TRAXIS_PPN_PROGRAM_ID=$TRAXIS_PPN_PROGRAM_ID
USDC_MINT=$USDC_MINT
FEE_RECIPIENT=$FEE_RECIPIENT

# ---------- Authority keypair (INLINE, not a path) ----------
AUTHORITY_KEYPAIR=$AUTHORITY_KEYPAIR_JSON

# ---------- Helius ----------
HELIUS_API_KEY=${HELIUS_API_KEY:-replace_with_helius_key}
EOF

# ---------- Flag placeholders ----------
WARNINGS=()
grep -q "your_supabase_url"      "$OUT" && WARNINGS+=("SUPABASE_URL is still a placeholder — run 20-supabase-setup.command first.")
grep -q "your_supabase_anon_key" "$OUT" && WARNINGS+=("SUPABASE_ANON_KEY is still a placeholder — run 20-supabase-setup.command first.")
grep -q "replace_with_helius_key" "$OUT" && WARNINGS+=("HELIUS_API_KEY is still a placeholder — add one at https://dashboard.helius.dev (free tier is fine).")

# ---------- Output ----------
echo ""
echo "================================================================"
echo "  Railway env block written to: $OUT"
echo "================================================================"
echo ""
cat "$OUT" | sed 's/^\(SUPABASE_ANON_KEY=\).*/\1<redacted>/' \
           | sed 's/^\(AUTHORITY_KEYPAIR=\).*/\1<redacted JSON array>/'
echo ""
echo "================================================================"

if (( ${#WARNINGS[@]} > 0 )); then
  echo ""
  echo "⚠️  Warnings:"
  for w in "${WARNINGS[@]}"; do echo "    • $w"; done
fi

# Copy to clipboard (full version, including secrets)
if command -v pbcopy >/dev/null 2>&1; then
  pbcopy < "$OUT"
  echo ""
  echo "✓ The full env block (with secrets) has been copied to your clipboard."
  echo "  Paste it into Railway's Variables → 'Raw Editor' for senthos-backend."
fi

echo ""
echo "Next steps in Railway:"
echo "  1. Create new service → 'Deploy from GitHub repo' → pick this repo"
echo "  2. Settings → Root Directory: (leave blank — railway.json handles build ctx)"
echo "  3. Variables → Raw Editor → paste clipboard contents"
echo "  4. Deploy. Healthcheck hits /api/health and should go green in ~2min."
echo "  5. Copy the public URL (https://xxx.up.railway.app)."
echo ""
echo "After Vercel deploy:"
echo "  • Update FRONTEND_URL in Railway to your Vercel URL."
echo "  • Update NEXT_PUBLIC_BACKEND_URL in Vercel to your Railway URL."
echo ""
read -r -p "Press ENTER to close this window..."

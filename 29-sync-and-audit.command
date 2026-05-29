#!/bin/bash
# 29-sync-and-audit.command
# Fetches latest origin/main, rebases if clean, then writes a detailed
# audit to .logs/29-audit.txt so the sandbox can read the result.
set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
OUT=".logs/29-audit.txt"
: > "$OUT"

echo "=== git fetch origin ===" | tee -a "$OUT"
git fetch origin 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== git status BEFORE pull ===" | tee -a "$OUT"
git status --short --branch 2>&1 | tee -a "$OUT"

# Attempt pull --rebase only if working tree is clean
DIRTY=$(git status --porcelain | head -1)
if [[ -z "$DIRTY" ]]; then
  echo "" | tee -a "$OUT"
  echo "=== git pull --rebase origin main ===" | tee -a "$OUT"
  git pull --rebase origin main 2>&1 | tee -a "$OUT"
else
  echo "" | tee -a "$OUT"
  echo "!! Working tree has uncommitted changes; skipping rebase to be safe" | tee -a "$OUT"
fi

echo "" | tee -a "$OUT"
echo "=== last 15 commits on main ===" | tee -a "$OUT"
git log --oneline -15 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== files changed in last commit ===" | tee -a "$OUT"
git log --name-status -1 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== .so declare_id bytes on disk (hexdump of offset ranges) ===" | tee -a "$OUT"
python3 <<'PYEOF' | tee -a "$OUT"
import base58, os, hashlib
for path, expected in [
    ("target/deploy/traxis_vault.so", "DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat"),
    ("target/deploy/traxis_ppn.so",   "3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp"),
]:
    if not os.path.exists(path):
        print(f"  {path}: MISSING")
        continue
    data = open(path, "rb").read()
    exp = base58.b58decode(expected)
    count = data.count(exp)
    print(f"  {path}: {len(data)} bytes, sha256={hashlib.sha256(data).hexdigest()[:16]}, {count}× {expected[:8]}...")
PYEOF

echo "" | tee -a "$OUT"
echo "=== deployed program state (devnet RPC) ===" | tee -a "$OUT"
python3 <<'PYEOF' | tee -a "$OUT"
import urllib.request, json, base64, hashlib
RPC = "https://api.devnet.solana.com"
def rpc(m, p):
    r = urllib.request.Request(RPC, data=json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),
                               headers={"content-type":"application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=30).read())

for name, pid in [("vault","DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat"),
                  ("ppn",  "3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp")]:
    try:
        r = rpc("getAccountInfo", [pid, {"encoding":"base64"}])
        info = r.get("result",{}).get("value")
        if not info:
            print(f"  {name} {pid}: NOT DEPLOYED"); continue
        import base58
        raw = base64.b64decode(info["data"][0])
        pda = base58.b58encode(raw[4:36]).decode()
        pd = rpc("getAccountInfo", [pda, {"encoding":"base64"}])
        pd_raw = base64.b64decode(pd["result"]["value"]["data"][0])
        code = pd_raw[45:]
        print(f"  {name} {pid}: executable={info.get('executable')}, code={len(code)}B, sha256={hashlib.sha256(code).hexdigest()[:16]}")
    except Exception as e:
        print(f"  {name}: ERROR {e}")
PYEOF

echo "" | tee -a "$OUT"
echo "=== Supabase bundle count (via REST) ===" | tee -a "$OUT"
if [[ -f backend/.env ]]; then
  SUPABASE_URL=$(grep '^SUPABASE_URL=' backend/.env | cut -d= -f2)
  SUPABASE_KEY=$(grep '^SUPABASE_ANON_KEY=' backend/.env | cut -d= -f2)
  if [[ -n "$SUPABASE_URL" && -n "$SUPABASE_KEY" ]]; then
    COUNT=$(curl -sS --max-time 10 \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      -H "Prefer: count=exact" \
      -H "Range: 0-0" \
      "$SUPABASE_URL/rest/v1/bundles?select=id" -i 2>&1 | grep -i "content-range" | head -1)
    echo "  bundles: $COUNT" | tee -a "$OUT"
    BUNDLES=$(curl -sS --max-time 10 \
      -H "apikey: $SUPABASE_KEY" \
      -H "Authorization: Bearer $SUPABASE_KEY" \
      "$SUPABASE_URL/rest/v1/bundles?select=name,vault_pda,onchain_tx_signature" 2>&1)
    echo "  names: $BUNDLES" | tee -a "$OUT"
  else
    echo "  (backend/.env missing SUPABASE_URL or SUPABASE_ANON_KEY)" | tee -a "$OUT"
  fi
else
  echo "  (backend/.env does not exist)" | tee -a "$OUT"
fi

echo "" | tee -a "$OUT"
echo "=== backend/.env keys (redacted) ===" | tee -a "$OUT"
if [[ -f backend/.env ]]; then
  awk -F= '/^[A-Z]/ {
    key=$1;
    val=$2;
    if (length(val) > 16) val=substr(val,1,8) "...(" length(val) " chars)";
    print "  " key "=" val
  }' backend/.env | tee -a "$OUT"
else
  echo "  (missing)" | tee -a "$OUT"
fi

echo "" | tee -a "$OUT"
echo "DONE. Full audit saved to $OUT"
read -r -p "Press ENTER to close..."

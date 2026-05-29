#!/bin/bash
# 30-show-new-commits.command
# Shows what's in the 3 new commits Luka pushed to origin/main.
# Writes to .logs/30-new-commits.txt for sandbox to read.
set -u
cd "$(dirname "$0")" || exit 1

mkdir -p .logs
OUT=".logs/30-new-commits.txt"
: > "$OUT"

echo "=== git fetch origin (force refresh) ===" | tee -a "$OUT"
git fetch origin 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== commits ahead of local main (origin/main..HEAD reverse: new commits) ===" | tee -a "$OUT"
git log --oneline main..origin/main 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== diff summary main..origin/main (what Luka changed) ===" | tee -a "$OUT"
git diff --stat main..origin/main 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== full commit messages ===" | tee -a "$OUT"
git log main..origin/main 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== STATE.md on origin/main (latest) ===" | tee -a "$OUT"
git show origin/main:STATE.md 2>&1 | head -100 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== alex-ui branch recent commits (3beb866) ===" | tee -a "$OUT"
git log --oneline origin/alex-ui -5 2>&1 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "=== deployed program re-check (bash curl) ===" | tee -a "$OUT"
for pid in DY7NAimrQZY7SxveXTb38XN7H69wAXjZZj8DRHto4Aat 3wDHsr9EnWkF968zYmSsj4hShNkAyFV6r7zxPrjqWNsp; do
  echo "  $pid:" | tee -a "$OUT"
  curl -sS --max-time 10 -X POST https://api.devnet.solana.com \
    -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getAccountInfo\",\"params\":[\"$pid\",{\"encoding\":\"base64\",\"dataSlice\":{\"offset\":0,\"length\":0}}]}" \
    2>&1 | python3 -c "import sys,json; r=json.load(sys.stdin); v=r.get('result',{}).get('value'); print(f'    executable={v.get(\"executable\") if v else None}, owner={v.get(\"owner\") if v else None}, lamports={v.get(\"lamports\") if v else None}') if v is not None else print('    NOT FOUND')" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
echo "DONE. Saved to $OUT"
read -r -p "Press ENTER to close..."

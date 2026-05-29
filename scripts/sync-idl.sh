#!/usr/bin/env bash
# Copy Anchor-generated IDLs from target/idl/ → backend/src/idl/ so the
# backend can load them at runtime. Runs after `anchor build`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/target/idl"
DEST="$ROOT/backend/src/idl"

if [ ! -d "$SRC" ]; then
  echo "No IDL directory found at $SRC — run 'anchor build' first"
  exit 1
fi

mkdir -p "$DEST"
for NAME in traxis_vault traxis_ppn; do
  if [ -f "$SRC/${NAME}.json" ]; then
    cp "$SRC/${NAME}.json" "$DEST/${NAME}.json"
    echo "  synced ${NAME}.json"
  else
    echo "  warning: $SRC/${NAME}.json not found"
  fi
done

echo "IDLs synced to $DEST"

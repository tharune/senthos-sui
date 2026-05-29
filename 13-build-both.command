#!/bin/bash
# Phase 13: Build both programs correctly.
#
# Root cause of the 5.6 KB traxis_vault.so stub from phase 11:
#   programs/traxis_ppn/Cargo.toml depends on traxis_vault with features=["cpi"]
#   programs/traxis_vault/Cargo.toml has cpi = ["no-entrypoint"]
# When `anchor build` compiles the whole workspace, Cargo's resolver unifies
# features across the graph, so vault's cdylib is built with no-entrypoint
# and the Solana entrypoint is stripped — hence a 5.6 KB stub.
#
# Fix: build each program separately. When vault is built alone, PPN isn't
# in the graph so `cpi` isn't activated and vault.so gets a real entrypoint.
# When PPN is built alone afterwards, `cpi` is correctly on for vault-as-dep
# but `target/deploy/traxis_vault.so` from step 1 is preserved.

set +e
cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

clear
echo "=================================================="
echo " Phase 13: Per-program build (vault, then PPN)"
echo "=================================================="

# --- 1. Docker checks ---
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI not found. Install Docker Desktop and retry."
  read -p "Press Return..."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker 2>/dev/null
  for i in {1..60}; do sleep 1; docker info >/dev/null 2>&1 && break; done
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running."
  read -p "Press Return..."
  exit 1
fi

# Validate that the existing image actually has solana — earlier builds
# silently ended up without it because the v1.18.26 installer 404'd on
# aarch64. Dockerfile now forces linux/amd64 and verifies the install,
# so a rebuild is mandatory if the current image predates that.
if docker image inspect traxis-build >/dev/null 2>&1; then
  if ! docker run --rm --platform=linux/amd64 --entrypoint bash traxis-build \
        -c 'command -v solana >/dev/null 2>&1' 2>/dev/null; then
    echo "Existing 'traxis-build' image is missing solana — removing and rebuilding."
    docker rmi -f traxis-build >/dev/null 2>&1
  fi
fi

if ! docker image inspect traxis-build >/dev/null 2>&1; then
  echo "Docker image 'traxis-build' not found — building it now."
  echo "(First run only. Expect 10-20 minutes; subsequent runs reuse the image.)"
  # Sync Cargo.toml to anchor 0.30.1 to match the image's frozen Cargo.lock.
  python3 <<'PYEOF' 2>/dev/null
import re
for p in ["programs/traxis_vault/Cargo.toml", "programs/traxis_ppn/Cargo.toml"]:
    try:
        with open(p) as f: s = f.read()
        s = re.sub(r'anchor-lang\s*=\s*\{\s*version\s*=\s*"[^"]+"', 'anchor-lang = { version = "=0.30.1"', s)
        s = re.sub(r'anchor-spl\s*=\s*\{\s*version\s*=\s*"[^"]+"',  'anchor-spl  = { version = "=0.30.1"', s)
        i = s.find("[patch.crates-io]")
        if i > 0:
            s = s[:i].rstrip() + "\n"
        with open(p,'w') as f: f.write(s)
    except FileNotFoundError:
        pass
PYEOF
  rm -f Cargo.lock
  echo
  echo "---- docker build --platform=linux/amd64 -f Dockerfile.build -t traxis-build . ----"
  docker build --platform=linux/amd64 -f Dockerfile.build -t traxis-build . 2>&1 | tee docker-image-build.log | tail -40
  if ! docker image inspect traxis-build >/dev/null 2>&1; then
    echo
    echo "Docker image build failed. See docker-image-build.log."
    read -p "Press Return..."
    exit 1
  fi
  echo "Image built successfully."
fi

# --- 2. Clean only the cdylib outputs so fingerprints re-evaluate. ---
# Keep the rlibs and deps cache around — no reason to rebuild 1.9 MB of
# library code that compiled fine.
rm -f target/deploy/traxis_vault.so
rm -f target/deploy/traxis_ppn.so
rm -f target/sbf-solana-solana/release/deps/traxis_vault.so
rm -f target/sbf-solana-solana/release/deps/traxis_ppn.so
rm -rf target/sbf-solana-solana/release/.fingerprint/traxis_vault-* 2>/dev/null
rm -rf target/sbf-solana-solana/release/.fingerprint/traxis_ppn-*   2>/dev/null

# --- 3. Build vault alone, then PPN alone, inside the existing image. ---
# Full verbose output → docker-build-both.log in the repo.
echo
echo "---- Building both programs inside traxis-build container ----"
docker run --rm \
  --platform=linux/amd64 \
  -v "$PWD:/workdir" \
  -w /workdir \
  --entrypoint bash \
  traxis-build -c '
    set +e
    # Re-establish the expected PATH; ENV may not always propagate through
    # --entrypoint overrides on every Docker backend.
    export PATH="/root/.cargo/bin:/root/.local/share/solana/install/active_release/bin:/root/.avm/bin:$PATH"

    # If solana installer did not populate active_release, try to install it now.
    if ! command -v solana >/dev/null 2>&1; then
      echo "==== solana not found — running Anza installer inside container ===="
      (sh -c "$(curl -sSfL https://release.anza.xyz/v1.18.26/install)" \
        || sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)") 2>&1 | tail -10
      export PATH="/root/.local/share/solana/install/active_release/bin:$PATH"
    fi

    rustup default 1.75.0 >/dev/null 2>&1 || true
    if [ -f /opt/anchor-src/Cargo.lock ] && [ ! -f Cargo.lock ]; then
      cp /opt/anchor-src/Cargo.lock Cargo.lock
    fi
    echo "==== versions ===="
    rustc --version
    cargo --version
    anchor --version 2>&1 || true
    solana --version 2>&1 || true
    which cargo-build-sbf 2>&1 || true

    # Pre-warm platform-tools (cargo-build-sbf downloads Rust BPF toolchain
    # on first run). Point install dir to mounted target/ so downloads persist.
    if ! command -v cargo-build-sbf >/dev/null 2>&1; then
      echo "cargo-build-sbf missing — solana install incomplete."
      exit 1
    fi

    # Bump proc-macro2 past 1.0.92, whose nightly wrapper still references
    # proc_macro::Span::source_file() — removed from proc_macro upstream.
    # 1.0.95 deleted that call path; the build.rs probe falls back to
    # non-nightly code on stable Rust 1.75 inside this container.
    echo "==== bumping proc-macro2 to 1.0.95 for IDL build ===="
    cargo update -p proc-macro2 --precise 1.0.95 2>&1 | tail -5 || true

    # Bump ahash past 0.7.6, which enables feature(stdsimd) — a nightly-only
    # feature gate rejected on stable Rust 1.75. ahash 0.8+ dropped that path.
    echo "==== bumping ahash to 0.8.11 for IDL build ===="
    cargo update -p ahash --precise 0.8.11 2>&1 | tail -5 || true

    # Nightly-features escape hatch: some transitive deps still gate code
    # behind feature(...) attrs. RUSTC_BOOTSTRAP=1 makes stable Rust accept
    # unstable feature gates, so the IDL compile will not wedge on them.
    export RUSTC_BOOTSTRAP=1

    echo
    echo "==== STEP 1: anchor build -p traxis_vault ===="
    # No set -e — the IDL build may fail with a proc-macro2 error after the
    # .so is already in target/deploy. Press on and check the artifact at end.
    anchor build -p traxis_vault 2>&1

    echo
    echo "==== after vault build, target/deploy ===="
    ls -la target/deploy/ || true
    if [ -f target/deploy/traxis_vault.so ]; then
      VSIZE=$(stat -c%s target/deploy/traxis_vault.so)
      echo "vault.so size: ${VSIZE} bytes"
      if [ "$VSIZE" -lt 100000 ]; then
        echo "WARNING: vault.so looks like a stub (<100 KB)."
      fi
    fi

    echo
    echo "==== STEP 2: anchor build -p traxis_ppn ===="
    anchor build -p traxis_ppn 2>&1

    echo
    echo "==== final target/deploy ===="
    ls -la target/deploy/ || true
  ' 2>&1 | tee docker-build-both.log

echo
echo "---- TAIL of docker-build-both.log (last 80 lines) ----"
tail -80 docker-build-both.log

echo
echo "---- Artifact status ----"
for f in traxis_vault.so traxis_ppn.so; do
  if [ -f "target/deploy/$f" ]; then
    SZ=$(stat -f%z "target/deploy/$f" 2>/dev/null || stat -c%s "target/deploy/$f")
    echo "  target/deploy/$f — ${SZ} bytes"
    if [ "$SZ" -lt 100000 ]; then
      echo "    ^^^ STILL A STUB — build still wrong for this program."
    fi
  else
    echo "  target/deploy/$f — MISSING"
  fi
done

echo
echo "---- IDL status ----"
for n in traxis_vault traxis_ppn; do
  if [ -f "target/idl/${n}.json" ]; then
    echo "  target/idl/${n}.json — $(wc -c <target/idl/${n}.json) bytes"
  else
    echo "  target/idl/${n}.json — MISSING (IDL build likely failed; see docker-build-both.log)"
  fi
done

echo
echo "Full log at: ./docker-build-both.log"
echo
read -p "Press Return..."

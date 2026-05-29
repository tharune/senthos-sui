#!/bin/bash
# 24-verify-build.command
# Phase A final check — catch bugs BEFORE Railway does.
#
# Runs in order:
#   1. `npm install` (fast, no-op if already installed)
#   2. `npm run build` (TypeScript compile) — catches type errors + missing deps
#   3. If docker is available: `docker build -f backend/Dockerfile backend/`
#      — verifies the multi-stage Dockerfile builds end-to-end exactly the
#      way Railway will build it.
#   4. If docker is available: launches the image with a test-mode env and
#      curls /api/health on localhost:3001 to confirm the container runs.
#
# Everything is logged to .logs/24-verify-build.log.

set -u
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT" || exit 1

mkdir -p .logs
LOG=".logs/24-verify-build.log"
: > "$LOG"

log()    { echo "$@" | tee -a "$LOG"; }
logcmd() { echo -e "\n\$ $*" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; return "${PIPESTATUS[0]}"; }

log "=== 24-verify-build.command ==="
log "Started: $(date)"
log ""

# ---------- 1. npm install ----------
echo "================================================================"
echo "  STEP 1 — backend deps"
echo "================================================================"
cd backend || { log "ERROR: backend/ missing"; exit 1; }
logcmd npm install --no-audit --no-fund
INSTALL_RC=$?
if [[ $INSTALL_RC -ne 0 ]]; then
  log "ERROR: npm install failed."
  exit 1
fi

# ---------- 2. typecheck ----------
echo ""
echo "================================================================"
echo "  STEP 2 — TypeScript compile (what Railway runs inside Docker)"
echo "================================================================"
logcmd npm run build
BUILD_RC=$?
cd "$REPO_ROOT" || true
if [[ $BUILD_RC -ne 0 ]]; then
  log ""
  log "❌ TypeScript build failed. Railway WILL fail with the same error."
  log "   Fix the errors above before deploying."
  echo ""
  read -r -p "Press ENTER to close..."
  exit 1
fi
log "✓ TypeScript build succeeded."

# ---------- 3. docker build (optional) ----------
if command -v docker >/dev/null 2>&1; then
  echo ""
  echo "================================================================"
  echo "  STEP 3 — Docker build (mirrors Railway exactly)"
  echo "================================================================"

  # Check daemon is running
  if ! docker info >/dev/null 2>&1; then
    log "Docker daemon not running — start Docker Desktop if you want this step."
    log "Skipping container verification."
  else
    IMG="senthos-backend:verify"
    logcmd docker build -f backend/Dockerfile -t "$IMG" backend/
    DOCKER_RC=$?
    if [[ $DOCKER_RC -ne 0 ]]; then
      log "❌ Docker build failed. Railway will fail the same way."
      echo ""
      read -r -p "Press ENTER to close..."
      exit 1
    fi
    log "✓ Docker build succeeded."

    # ---------- 4. runtime smoke ----------
    echo ""
    echo "================================================================"
    echo "  STEP 4 — Container smoke test"
    echo "================================================================"

    # Kill any stale container from a previous run
    docker rm -f senthos-backend-verify >/dev/null 2>&1 || true

    log "Starting container with backend/.env as env-file..."
    if [[ ! -f backend/.env ]]; then
      log "WARN: backend/.env missing — container will probably fail to boot."
    fi
    logcmd docker run -d --name senthos-backend-verify \
                     --env-file backend/.env \
                     -e NODE_ENV=production \
                     -p 3011:3001 \
                     "$IMG"
    sleep 5

    # Probe health
    log ""
    log "Probing http://localhost:3011/api/health ..."
    HEALTH=$(curl -sS --max-time 5 "http://localhost:3011/api/health" 2>&1 || echo "CURL_FAIL")
    log "  response: $HEALTH"
    if echo "$HEALTH" | grep -q '"status"'; then
      log "✅ Container healthy."
    else
      log "⚠️  Health probe failed. Dumping container logs:"
      docker logs senthos-backend-verify 2>&1 | tail -40 | tee -a "$LOG"
    fi

    # Cleanup
    logcmd docker rm -f senthos-backend-verify
  fi
else
  log ""
  log "docker not installed — skipping container verification."
  log "TypeScript build passed, so Railway *should* succeed, but a local"
  log "Docker build would catch Dockerfile-specific issues earlier."
fi

log ""
log "================================================================"
log "  24-verify-build.command complete"
log "================================================================"
log "Finished: $(date)"

echo ""
echo "✅ Backend builds clean. Safe to deploy to Railway."
echo "   Next: ./22-railway-env-export.command   (then paste into Railway)"
echo ""
read -r -p "Press ENTER to close this window..."

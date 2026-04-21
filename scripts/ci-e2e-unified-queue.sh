#!/bin/bash
# Task #45 — CI wrapper for scripts/e2e-unified-queue.ts.
#
# Boots the dev server on port 5000, waits until it is responding, runs
# the unified-queue end-to-end check against it, then tears the server
# down regardless of pass/fail. Exits non-zero (blocking the merge) if
# the e2e check fails.
#
# Usage:
#   bash scripts/ci-e2e-unified-queue.sh
#
# Honors:
#   E2E_BASE_URL  override the URL the script hits (default http://localhost:5000)
#   E2E_PORT      port the dev server listens on (default 5000)
#   E2E_BOOT_TIMEOUT_S  seconds to wait for the server to become ready (default 60)

set -u
set -o pipefail

PORT="${E2E_PORT:-5000}"
BASE_URL="${E2E_BASE_URL:-http://localhost:${PORT}}"
BOOT_TIMEOUT="${E2E_BOOT_TIMEOUT_S:-60}"
LOG_DIR="${TMPDIR:-/tmp}/e2e-unified-queue"
mkdir -p "${LOG_DIR}"
SERVER_LOG="${LOG_DIR}/server.log"

log() { echo "[ci-e2e-unified-queue] $*"; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    log "stopping dev server pid=${SERVER_PID}"
    kill "${SERVER_PID}" 2>/dev/null || true
    # Give it a chance to exit, then force.
    for _ in $(seq 1 10); do
      if ! kill -0 "${SERVER_PID}" 2>/dev/null; then break; fi
      sleep 0.5
    done
    if kill -0 "${SERVER_PID}" 2>/dev/null; then
      log "force-killing pid=${SERVER_PID}"
      kill -9 "${SERVER_PID}" 2>/dev/null || true
    fi
  fi
}
trap cleanup EXIT INT TERM

# Reuse a server already listening on the port. This wrapper is also
# wired into the Replit "Project" parallel run alongside "Start
# application", so when both kick off together we must give the
# co-tenant a chance to bind port 5000 before we decide it's our job
# to boot one — otherwise we race and one side hits EADDRINUSE.
E2E_REUSE_WAIT_S="${E2E_REUSE_WAIT_S:-15}"
log "checking for an existing server at ${BASE_URL} (up to ${E2E_REUSE_WAIT_S}s)"
reuse=0
for _ in $(seq 1 "${E2E_REUSE_WAIT_S}"); do
  if curl -fsS -o /dev/null "${BASE_URL}/api/health" 2>/dev/null \
     || curl -fsS -o /dev/null "${BASE_URL}/" 2>/dev/null; then
    reuse=1
    break
  fi
  # Also bail out of the wait if something is bound to the port but
  # not yet HTTP-ready — keep waiting in that case (it's coming up).
  sleep 1
done

if [[ "${reuse}" -eq 1 ]]; then
  log "dev server already responding at ${BASE_URL}, reusing"
else
  log "booting dev server (logs: ${SERVER_LOG})"
  NODE_ENV=development npx tsx server/index.ts >"${SERVER_LOG}" 2>&1 &
  SERVER_PID=$!
  log "server pid=${SERVER_PID}, waiting up to ${BOOT_TIMEOUT}s for ${BASE_URL}"
  ready=0
  for _ in $(seq 1 "${BOOT_TIMEOUT}"); do
    if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
      log "server process exited before becoming ready; tail of log:"
      tail -n 80 "${SERVER_LOG}" || true
      exit 1
    fi
    if curl -fsS -o /dev/null "${BASE_URL}/" 2>/dev/null \
       || curl -fsS -o /dev/null "${BASE_URL}/api/health" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "${ready}" -ne 1 ]]; then
    log "server failed to become ready within ${BOOT_TIMEOUT}s; tail of log:"
    tail -n 80 "${SERVER_LOG}" || true
    exit 1
  fi
  log "server ready"
fi

log "running scripts/e2e-unified-queue.ts against ${BASE_URL}"
E2E_BASE_URL="${BASE_URL}" NODE_ENV=development npx tsx scripts/e2e-unified-queue.ts
status=$?
log "e2e exit=${status}"
exit "${status}"

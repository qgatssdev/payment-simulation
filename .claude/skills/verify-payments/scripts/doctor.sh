#!/usr/bin/env bash
# Read-only health check of a launched instance: is it worth driving?
#
#   .claude/skills/verify-payments/scripts/doctor.sh      (uses RUN_DIR from launch.sh)
#
# Prints PASS/FAIL per check; exits non-zero if anything fails. Sends only GET requests.
set -uo pipefail
: "${RUN_DIR:?run launch.sh first (eval its output) or export RUN_DIR}"
# shellcheck source=/dev/null
source "$RUN_DIR/state.env"

failures=0
check() {
  local name=$1
  shift
  if "$@" >/dev/null 2>&1; then echo "PASS  $name"; else echo "FAIL  $name"; failures=$((failures + 1)); fi
}
owns_port() { lsof -a -p "$1" -iTCP:"$2" -sTCP:LISTEN >/dev/null 2>&1; }

check "API process $API_PID alive" kill -0 "$API_PID"
check "web process $WEB_PID alive" kill -0 "$WEB_PID"
check "port $API_PORT owned by this run's API" owns_port "$API_PID" "$API_PORT"
check "port $WEB_PORT owned by this run's web" owns_port "$WEB_PID" "$WEB_PORT"
check "API /health answers ok" sh -c "curl -sf '$API_URL/health' | grep -q '\"status\":\"ok\"'"
check "API /ready reports ready (storage writable)" sh -c "curl -sf '$API_URL/ready' | grep -q '\"ready\":true'"
# The store writes its file on the first commit, but locks it at startup with the owner's PID.
check "data file locked by this run's API ($DATA_FILE)" sh -c "[ \"\$(cat '$DATA_FILE.lock')\" = '$API_PID' ]"
check "data file absent or in the expected format" sh -c "[ ! -f '$DATA_FILE' ] || head -c 200 '$DATA_FILE' | grep -q 'payment-simulation/v1'"
check "dashboard renders" sh -c "curl -sf '$WEB_URL/' | grep -q 'Payment Simulation'"
check "dashboard points at this run's API" sh -c "curl -sf '$WEB_URL/' >/dev/null && grep -rqs '$API_URL' '$(git -C "$(dirname "$0")" rev-parse --show-toplevel)/apps/web/.next/static'"
check "live stream handshake" sh -c "curl -sN --max-time 2 '$API_URL/api/v1/stream' 2>/dev/null | grep -q '^retry:'"

if ((failures > 0)); then
  echo "doctor: $failures check(s) failed; see $RUN_DIR/api.log and $RUN_DIR/web.log"
  exit 1
fi
echo "doctor: instance $RUN_ID is healthy"

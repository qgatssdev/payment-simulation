#!/usr/bin/env bash
# Build and start an isolated API + web instance for verification.
#
#   eval "$(.claude/skills/verify-payments/scripts/launch.sh [run-id])"
#
# Prints `export ...` lines (RUN_ID, RUN_DIR, EVIDENCE_DIR, API_URL, WEB_URL, ...) on stdout;
# progress goes to stderr. Exits non-zero, with log tails, if the instance never becomes ready.
#
# Extra API settings (space-separated NAME=value, applied last) go in API_ENV, e.g.
#   API_ENV="WORKER_ENABLED=false" launch.sh cancel   # payments stay PENDING (to drive cancel)
set -euo pipefail

ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
RUN_ID=${1:-$(date +%Y%m%d-%H%M%S)}
RUN_DIR="${TMPDIR:-/tmp}"; RUN_DIR="${RUN_DIR%/}/verify-payments-$RUN_ID"
EVIDENCE_DIR="$ROOT/artifacts/verify/$RUN_ID"

if [[ -e "$RUN_DIR" ]]; then
  echo "launch: $RUN_DIR already exists; pick another run id or run cleanup.sh" >&2
  exit 1
fi
mkdir -p "$RUN_DIR" "$EVIDENCE_DIR"

free_port() {
  node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}
API_PORT=$(free_port)
WEB_PORT=$(free_port)
while [[ "$WEB_PORT" == "$API_PORT" ]]; do WEB_PORT=$(free_port); done
API_URL="http://localhost:$API_PORT"
WEB_URL="http://localhost:$WEB_PORT"
DATA_FILE="$RUN_DIR/payments.json"

echo "launch: building (web gets API_URL=$API_URL baked in) -> $RUN_DIR/build.log" >&2
(
  cd "$ROOT"
  pnpm -s --filter @payment-sim/shared build
  pnpm -s --filter @payment-sim/api build
  NEXT_PUBLIC_API_URL="$API_URL" pnpm -s --filter @payment-sim/web build
) >"$RUN_DIR/build.log" 2>&1 || {
  echo "launch: build failed" >&2
  tail -30 "$RUN_DIR/build.log" >&2
  exit 1
}

echo "launch: starting API on $API_PORT, web on $WEB_PORT" >&2
# Fast but realistic gateway: the flaky card settles in ~3 s, the timeout card in ~8 s.
(
  cd "$ROOT/apps/api"
  # shellcheck disable=SC2086 # API_ENV is deliberately word-split into NAME=value pairs.
  nohup env NODE_ENV=production PORT="$API_PORT" LOG_LEVEL=info \
    CORS_ORIGINS="$WEB_URL" DATA_FILE="$DATA_FILE" \
    GATEWAY_MIN_LATENCY_MS=300 GATEWAY_MAX_LATENCY_MS=900 GATEWAY_TIMEOUT_MS=1500 \
    RETRY_BASE_DELAY_MS=500 RETRY_MAX_DELAY_MS=2000 \
    ${API_ENV:-} \
    node dist/server.js >"$RUN_DIR/api.log" 2>&1 &
  echo $! >"$RUN_DIR/api.pid"
)
(
  cd "$ROOT/apps/web"
  nohup node node_modules/next/dist/bin/next start --port "$WEB_PORT" >"$RUN_DIR/web.log" 2>&1 &
  echo $! >"$RUN_DIR/web.pid"
)
API_PID=$(cat "$RUN_DIR/api.pid")
WEB_PID=$(cat "$RUN_DIR/web.pid")

cat >"$RUN_DIR/state.env" <<STATE
export RUN_ID="$RUN_ID"
export RUN_DIR="$RUN_DIR"
export EVIDENCE_DIR="$EVIDENCE_DIR"
export API_URL="$API_URL"
export WEB_URL="$WEB_URL"
export API_PORT="$API_PORT"
export WEB_PORT="$WEB_PORT"
export API_PID="$API_PID"
export WEB_PID="$WEB_PID"
export DATA_FILE="$DATA_FILE"
STATE

# Ready means usable: the API reports ready (storage writable), the dashboard renders, and
# the live stream answers, not merely that a process accepts connections.
stream_answers() {
  # The stream never ends, so curl always times out; judge by what it received, not its exit code.
  local received
  received=$(curl -sN --max-time 2 "$API_URL/api/v1/stream" 2>/dev/null || true)
  [[ "$received" == *"retry:"* ]]
}
ready=""
for _ in $(seq 1 120); do
  if curl -sf "$API_URL/ready" >/dev/null &&
    curl -sf "$WEB_URL/" | grep -q 'Payment Simulation' &&
    stream_answers; then
    ready=yes
    break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null || ! kill -0 "$WEB_PID" 2>/dev/null; then break; fi
  sleep 0.5
done

if [[ -z "$ready" ]]; then
  echo "launch: instance did not become ready" >&2
  echo "--- api.log" >&2; tail -20 "$RUN_DIR/api.log" >&2
  echo "--- web.log" >&2; tail -20 "$RUN_DIR/web.log" >&2
  echo "launch: run cleanup.sh with RUN_DIR=$RUN_DIR to stop what started" >&2
  cat "$RUN_DIR/state.env"
  exit 1
fi

cp "$RUN_DIR/state.env" "$EVIDENCE_DIR/run.env"
echo "launch: ready. API $API_URL  web $WEB_URL  evidence $EVIDENCE_DIR" >&2
cat "$RUN_DIR/state.env"

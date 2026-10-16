#!/usr/bin/env bash
# Stop what launch.sh started and remove its scratch directory. Evidence is never touched.
#
#   .claude/skills/verify-payments/scripts/cleanup.sh    (uses RUN_DIR from launch.sh)
#
# Kills only the recorded PIDs, and only while each still owns this run's port (Next.js renames
# its process to "next-server", so the command line is not a reliable signature; a recycled PID
# that belongs to something else does not own the port). Server logs and the final data file
# are copied into the evidence directory first. If anything could not be stopped, the run
# directory is kept so cleanup can be re-run.
set -uo pipefail
: "${RUN_DIR:?export RUN_DIR (printed by launch.sh)}"
if [[ ! -f "$RUN_DIR/state.env" ]]; then
  echo "cleanup: no state in $RUN_DIR; nothing to stop"
  exit 0
fi
# shellcheck source=/dev/null
source "$RUN_DIR/state.env"

leftover=0
stop() {
  local pid=$1 port=$2 label=$3
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "cleanup: $label ($pid) already stopped"
    return
  fi
  if ! lsof -a -p "$pid" -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "cleanup: pid $pid does not own port $port; not ours, not killing"
    return
  fi
  kill -TERM "$pid"
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid"
    sleep 0.5
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "cleanup: could not stop $label ($pid)"
    leftover=1
  else
    echo "cleanup: stopped $label ($pid)"
  fi
}

stop "$WEB_PID" "$WEB_PORT" "web"
stop "$API_PID" "$API_PORT" "API"

mkdir -p "$EVIDENCE_DIR/server"
cp "$RUN_DIR"/api.log "$RUN_DIR"/web.log "$RUN_DIR"/build.log "$EVIDENCE_DIR/server/" 2>/dev/null
cp "$DATA_FILE" "$EVIDENCE_DIR/server/payments.final.json" 2>/dev/null

for port in "$API_PORT" "$WEB_PORT"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "cleanup: port $port is still in use"
    leftover=1
  fi
done
if ((leftover)); then
  echo "cleanup: incomplete; keeping $RUN_DIR so cleanup can be re-run"
  exit 1
fi
rm -rf "$RUN_DIR"
echo "cleanup: done; evidence kept in $EVIDENCE_DIR"

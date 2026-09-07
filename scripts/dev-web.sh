#!/usr/bin/env bash
# Run the Concors daemon and the desktop UI as a plain web app (no Tauri), for development on a
# headless machine. Both bind to loopback only; reach them from your laptop with an SSH tunnel:
#
#   ssh -N -L 1420:127.0.0.1:1420 -L 7420:127.0.0.1:7420 <user>@<host>
#
# then open http://localhost:1420. The UI connects to ws://127.0.0.1:7420/ws, which the second
# tunnel forwards to the daemon. Vite HMR works through the same tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

cleanup() {
  echo "stopping…"
  trap - TERM INT EXIT
  kill 0 2>/dev/null || true
}
trap cleanup TERM INT EXIT

pnpm daemon:dev &
pnpm desktop:web:dev &

# Exit the whole stack if any child dies, so a crash is visible instead of silently half-running.
wait -n

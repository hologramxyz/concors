#!/usr/bin/env bash
# Run the native Tauri desktop app on a headless Linux dev box and view it from your own
# machine through a browser tab.
#
#   VM:      ./scripts/dev-vm-display.sh
#   laptop:  ssh -L 6080:127.0.0.1:6080 <user>@<vm>
#            open http://localhost:6080/vnc.html  →  Connect
#
# What it starts (all bound to loopback, all stopped with Ctrl-C):
#   Xvfb :99          virtual X display
#   x11vnc            VNC server attached to :99 (no password; only reachable via the SSH tunnel)
#   websockify/noVNC  serves the VNC session as a web page on :6080
#   concors-daemon    pnpm daemon:dev
#   Tauri app         pnpm desktop:dev (Vite HMR still works inside the webview)
#
# Requires: Xvfb, x11vnc, novnc  (apt install xvfb x11vnc novnc)
# Dev-only convenience; nothing here is part of the product.

set -euo pipefail

DISPLAY_NUM="${DISPLAY_NUM:-99}"
SCREEN="${SCREEN:-1440x900x24}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_PORT="${NOVNC_PORT:-6080}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for bin in Xvfb x11vnc websockify pnpm; do
  command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }
done

pids=()
cleanup() {
  echo; echo "stopping…"
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ Xvfb :$DISPLAY_NUM ($SCREEN)"
Xvfb ":$DISPLAY_NUM" -screen 0 "$SCREEN" -nolisten tcp >/dev/null 2>&1 &
pids+=($!)
export DISPLAY=":$DISPLAY_NUM"
for _ in $(seq 1 50); do [ -e "/tmp/.X11-unix/X$DISPLAY_NUM" ] && break; sleep 0.1; done

echo "▶ x11vnc on 127.0.0.1:$VNC_PORT"
x11vnc -display "$DISPLAY" -localhost -rfbport "$VNC_PORT" -nopw -forever -shared -quiet -noxdamage -bg
# -bg forks; find the daemonised pid so cleanup can kill it.
pids+=("$(pgrep -n -f "x11vnc -display $DISPLAY")")

echo "▶ noVNC on http://127.0.0.1:$NOVNC_PORT/vnc.html"
websockify --web /usr/share/novnc "127.0.0.1:$NOVNC_PORT" "127.0.0.1:$VNC_PORT" >/dev/null 2>&1 &
pids+=($!)

echo "▶ concors-daemon (pnpm daemon:dev)"
(cd "$ROOT" && pnpm daemon:dev) &
pids+=($!)

echo "▶ Tauri app (pnpm desktop:dev) — first Rust build can take a few minutes"
echo
echo "   On your machine:  ssh -L $NOVNC_PORT:127.0.0.1:$NOVNC_PORT <user>@<this-vm>"
echo "   then open         http://localhost:$NOVNC_PORT/vnc.html"
echo
(cd "$ROOT" && pnpm desktop:dev) &
pids+=($!)

wait -n "${pids[@]}" 2>/dev/null || true

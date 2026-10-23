#!/bin/bash
# Installs the Ubuntu packages Tauri builds against, for CI and release jobs.
#
# Ubuntu's package mirror sometimes stalls for many minutes. Without a deadline of its own, one
# stalled `apt-get update` used up a whole job's time limit and cancelled it before anything was
# built. Each attempt now has a deadline and apt retries its own downloads; a stalled attempt is
# cut short and tried again, and only three failures in a row fail the job.
set -euo pipefail

packages=(
  libwebkit2gtk-4.1-dev build-essential curl wget file
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
)
apt=(sudo apt-get -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)

for attempt in 1 2 3; do
  if timeout 240 "${apt[@]}" update && timeout 600 "${apt[@]}" install -y "${packages[@]}"; then
    exit 0
  fi
  echo "::warning::Installing Tauri's system packages failed or stalled (attempt $attempt of 3)."
  [ "$attempt" = 3 ] || sleep 15
done
exit 1

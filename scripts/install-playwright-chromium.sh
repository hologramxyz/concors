#!/bin/bash
# Installs Playwright's Chromium and the Ubuntu packages it needs, for the browser suites.
#
# `--with-deps` installs those packages with apt, from Ubuntu's mirror, which sometimes stalls for
# many minutes: one stalled attempt used up a whole job's time limit, and the job was cancelled
# with its tests half run or not run at all. apt now retries its own downloads with short timeouts
# (for every apt call, Playwright's included), and each attempt has a deadline and is tried again.
set -euo pipefail

printf '%s\n' 'Acquire::Retries "3";' 'Acquire::http::Timeout "30";' 'Acquire::https::Timeout "30";' |
  sudo tee /etc/apt/apt.conf.d/80-concors-retries >/dev/null

for attempt in 1 2 3; do
  if timeout 360 pnpm exec playwright install --with-deps chromium; then
    exit 0
  fi
  echo "::warning::Installing Playwright's Chromium failed or stalled (attempt $attempt of 3)."
  [ "$attempt" = 3 ] || sleep 15
done
exit 1

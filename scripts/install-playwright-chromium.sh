#!/bin/bash
# Installs Playwright's Chromium for the browser suites.
#
# The browser comes from Playwright's own servers. Its Ubuntu packages come through apt from the
# runner's Ubuntu mirror, which sometimes stalls for many minutes; those packages are mostly fonts,
# and the runner image already has the libraries Chromium runs on. So the download is retried, the
# packages get one bounded attempt, and a stalled mirror only fails the job if Chromium is actually
# missing a library. (Retrying `playwright install --with-deps` did not work: stopping it leaves its
# root apt-get running, holding the package lock, so every retry failed at once.)
set -euo pipefail

for attempt in 1 2 3; do
  if timeout 300 pnpm exec playwright install chromium; then
    break
  fi
  [ "$attempt" != 3 ] || exit 1
  echo "::warning::Downloading Chromium failed or stalled (attempt $attempt of 3)."
  sleep 15
done

if ! timeout 240 pnpm exec playwright install-deps chromium; then
  echo "::warning::Chromium's Ubuntu packages did not install in time; checking it has the libraries it needs."
fi

missing=""
while IFS= read -r binary; do
  missing+="$(ldd "$binary" 2>/dev/null | grep 'not found' || true)"
done < <(find "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}" -type f \
  \( -name chrome -o -name chrome-headless-shell \) 2>/dev/null)
if [ -n "$missing" ]; then
  echo "Chromium is missing libraries the runner does not have:"
  echo "$missing"
  exit 1
fi

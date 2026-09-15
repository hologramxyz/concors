#!/bin/sh
# Concors bundles its own daemon runtime under /opt/Concors. Tauri resolves that runtime
# relative to the real executable (`<exe dir>/../lib/Concors`), so exec the binary directly;
# a symlink into /usr/bin would still work, but this keeps a single place to set launch env.
#
# If the window comes up blank on an unusual GPU/driver combination, export
# WEBKIT_DISABLE_DMABUF_RENDERER=1 before launching. It is left unset by default because it
# disables hardware-accelerated compositing.
exec /opt/Concors/bin/concors-desktop "$@"

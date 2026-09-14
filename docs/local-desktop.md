# Local desktop runtime (Linux first)

The native Linux desktop package includes the daemon, Node, and the native terminal module.
Opening the application starts a loopback gateway on an available port and waits for its
persistent session host to be ready before connecting. No separate Node installation or
manual daemon command is needed on the target computer.

“This computer” means the machine running the native app. In a browser it means the machine
running that browser; a remotely hosted web preview cannot install or start a local process.
The browser fallback remains `ws://127.0.0.1:7420/ws` for manually configured runtimes.

## Build on Linux x86_64

Install the repository's Node 24/pnpm dependencies and Tauri's Linux build prerequisites
(Rust, a C/C++ toolchain, GTK 3, WebKitGTK 4.1 and the packaging utilities), then run:

```sh
pnpm install --frozen-lockfile
VITE_CONCORS_API_URL=https://concors-server-dev.up.railway.app pnpm desktop:package:linux
```

The command builds the daemon archive, checks its relocated runtime with a real PTY,
embeds the full directory as an application resource, and builds a `.deb` under
`apps/desktop/src-tauri/target/release/bundle/deb/`. Install the package and launch Concors.
A normal Concors account login is still required for the client. The control plane must
include `tauri://localhost` in its CORS/auth trusted origins for the Linux native app.

For a faster local test, append `--debug --no-bundle`; run
`apps/desktop/src-tauri/target/debug/concors-desktop` with its adjacent `daemon/` directory.
This uses the built frontend and does not start a Vite development server. Keep the runtime
resource directory intact when moving the application.

This first packaging command supports Linux x86_64. macOS/Windows installers, signing,
and automatic desktop/runtime updates need their own packaging and validation.

## Lifecycle and troubleshooting

The native app owns its gateway and checks it every five seconds. If it exits, the app starts
another gateway and reconnects to the new port. Closing the app stops its gateway but leaves
the persistent host running so existing terminals can be resumed on the next launch.

Runtime data defaults to `~/.concors`; set `CONCORS_DATA_DIR` before launching the app to
isolate a test installation. Native startup logs are written to Tauri's application log
directory as `local-daemon.log` (normally
`~/.local/share/dev.concors.desktop/logs/local-daemon.log` on Linux).

A startup timeout is reported with the log path. An incomplete production package reports
that the runtime is missing instead of silently trying a different service on port 7420.
Native development builds without bundled resources can still use a manually started daemon.

## Verification

Run the repository checks plus the native lifecycle tests:

```sh
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
pnpm daemon:build && pnpm desktop:web:build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings
```

For acceptance, launch the built app on a Linux display (Xvfb works on a headless VPS),
select This computer, open a folder, and run `hostname`, `pwd`, and a command that writes a
file in its terminal. Check that the host and folder are local. Export a shell variable,
stop only the gateway, and verify that the client reconnects and the variable survives.
Do not stop the persistent host during this reconnect check.

WebKitWebDriver can automate this built application with `TAURI_WEBVIEW_AUTOMATION=true`
and `webkitgtk:browserOptions.binary` pointing at the native executable. Account API fixtures
must remain isolated test services; the daemon, filesystem and PTYs should be real.

## Linux window controls

Linux builds use the existing tab/header row for minimize, maximize/restore and close.
When the Files panel is open, the controls move to its header. Sign-in and settings also
retain window controls. The browser and other native platforms keep their existing window chrome.

Drag empty space in the top row to move the window, or double-click it to maximize/restore.
Tabs, menus and file controls remain clickable. Thin edge/corner handles invoke native resizing;
they are hidden while maximized or fullscreen. Linux-only Tauri capabilities grant the necessary
window actions without enabling them for remote web content.

Run the focused UI acceptance suite against built assets (no Vite server):

```sh
pnpm desktop:web:build
pnpm exec playwright test --config playwright.window.config.ts
```

These tests mock native window actions and use a real isolated daemon for the workspace.
Actual movement, resizing and window-manager behavior also need native Linux checks.

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

## Distributable tarball and Arch package

The `.deb` above installs on Debian-family systems. For a relocatable tree — and for the
Arch/Omarchy package built from it — build without the bundler and assemble the release
directory instead:

```sh
VITE_CONCORS_API_URL=https://api.concors.dev pnpm desktop:package:linux --no-bundle
pnpm desktop:release:linux
```

That writes `apps/desktop/dist/release/Concors-<version>-x64.tar.gz` and its `.sha256`.
The layout is deliberate: Tauri resolves resources as `<exe dir>/../lib/<productName>` before
falling back to `/usr/lib/<productName>`, so `bin/concors-desktop` alongside
`lib/Concors/daemon/` works unpacked in a home directory, installed under `/opt`, or restaged
by a distribution package. Keep `bin/` and `lib/` siblings when moving the tree.

`packaging/linux/` holds the Arch packaging that consumes that tarball. Copy the tarball next
to the `PKGBUILD` and build:

```sh
cp apps/desktop/dist/release/Concors-0.1.0-x64.tar.gz packaging/linux/
cd packaging/linux && makepkg -si
```

The package installs the runtime under `/opt/Concors`, a `/usr/bin/concors` wrapper, a desktop
entry and hicolor icons; `pacman -R concors-bin` removes it. It sets `!strip` because the
bundled Node binary and the daemon's native terminal module must not be stripped. The
`sha256sums` are `SKIP` while the tarball is built locally — pin them with `updpkgsums` when
the source moves to a published release URL.

A package built on Arch links against the build host's glibc and WebKitGTK, so it runs only on
comparably recent systems. Artifacts intended for other distributions must be built on the
oldest supported base (a Linux x86_64 container) rather than on a rolling-release host.

## Repeatable local preview

After the initial Linux setup, update and relaunch the native app with one command from
the checkout in an external terminal (such as your normal Omarchy terminal):

```sh
pnpm desktop:reload
```

The first time you acquire this command, run `git pull --ff-only` on main first.
Subsequent reloads fetch and fast-forward `origin/main`, install the locked dependencies,
build the desktop and bundled daemon in debug mode, and launch that exact executable.
Nothing is pushed. Existing Cargo output is reused; no Vite server or system package installation
is started.

**Reload stops local terminal and agent processes to load the updated daemon.** Finish active
work first. Running reload inside a Concors terminal is refused because restarting that
terminal's host would interrupt the reload itself. Files, workspace records, account login and settings are preserved. Remote VPSs
are not updated or restarted.

The command requires a clean main checkout and a graphical Linux x86_64 session with Node 24+,
pnpm, Rust, the Linux build prerequisites, and `flock` (from util-linux on Arch). It refuses to
discard edits, overwrite unpublished commits, or interrupt another Concors installation.
If you previously installed a different binary, close that app before the first reload.
Keep any desktop launcher pointed at the executable printed by the command.

By default the build uses the development API. An existing desktop production-mode `.env`
configuration is respected. To select an API or an existing custom runtime directory explicitly:

```sh
VITE_CONCORS_API_URL=https://concors-server-dev.up.railway.app \
CONCORS_DATA_DIR="$HOME/.concors" pnpm desktop:reload
```

The API, data directory and Cargo target directory are remembered in the checkout's private
Git directory as `desktop-preview.json`. Shell overrides take precedence; Vite's existing API
configuration takes precedence over the remembered API. On the first run, a running app's
custom `CONCORS_DATA_DIR` is reused when no explicit or saved value exists. Reload refuses to
switch data directories while a different one is open.

The command prints the running commit, executable, and log path. Build errors stop the
workflow; if the app has already closed, fix the reported build error and run the command again.
A second concurrent reload is refused. Use `pnpm desktop:reload --help` for a short reference.

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

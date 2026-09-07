# @concors/desktop

The Concors desktop client: Tauri 2 + React + TypeScript + Vite.

It is a pure UI. All agent orchestration lives in the daemon, and the only way this app talks to a
daemon is through [`@concors/daemon-client`](../../packages/daemon-client) speaking
[`@concors/protocol`](../../packages/protocol).

## Run

```bash
pnpm desktop:dev        # native window (needs the Tauri prerequisites)
pnpm desktop:web:dev    # browser only, http://localhost:1420
pnpm desktop:build      # Tauri production build
```

Start a daemon alongside with `pnpm daemon:dev`, or point the app elsewhere with
`VITE_CONCORS_DAEMON_URL` (see `.env.example`).

## Source layout

```text
src/
├── App.tsx                     shell: sidebar + top bar + content
├── components/                 Sidebar, StatusIndicator, MainContent, SettingsPanel (placeholders)
├── config/env.ts               validated VITE_* configuration
├── daemon/
│   ├── resolve-endpoint.ts     which daemon to connect to at startup (env override → bundled → default)
│   └── use-daemon-connection.ts React hook around DaemonConnection with reconnect/backoff
├── tauri/                      the ONLY place that imports @tauri-apps/* (enforced by ESLint)
│   ├── index.ts                isTauri()
│   └── local-daemon.ts         start/stop/status of the bundled daemon via Rust commands
└── version.ts                  client version reported in the handshake

src-tauri/
├── src/lib.rs                  Tauri builder; registers commands; stops the daemon on exit
├── src/daemon.rs               spawn/kill the bundled `concors-daemon` executable
├── tauri.conf.json
└── capabilities/default.json   core:default only
```

## Startup flow

```text
open app
  └─ resolveStartupEndpoint()
       ├─ VITE_CONCORS_DAEMON_URL set?        → use it (local or remote)
       ├─ inside Tauri & daemon bundled?     → invoke start_local_daemon → ws://127.0.0.1:<port>/ws
       └─ otherwise (dev)                    → ws://127.0.0.1:7420/ws (expects `pnpm daemon:dev`)
  └─ useDaemonConnection(endpoint)
       └─ DaemonConnection.connect() → client.hello → daemon.ready → status indicator turns green
```

## Bundling the daemon (not done yet)

Production builds are meant to ship the daemon as a standalone executable so users never install
Node. The Rust side already looks for `concors-daemon[.exe]` next to the app executable, which is
where Tauri's `bundle.externalBin` places sidecars. The remaining work is producing that executable
per platform (see `packages/daemon/README.md`) and adding it to `bundle.externalBin` in
`tauri.conf.json`. Until then, dev builds report the daemon as `notBundled` and fall back to the
default local port.

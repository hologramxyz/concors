# @concors/daemon

The Concors machine runtime hosts coding-agent sessions (Claude Code, Codex,
OpenCode, …). It is an independent Node.js process that speaks [`@concors/protocol`](../protocol) and
knows nothing about Tauri, React, or any particular client.

The **same binary** runs in two places:

```text
laptop:  Concors desktop ──▶ concors-daemon (bundled, 127.0.0.1)
VPS:     Concors desktop ──▶ concors-daemon (systemd service, wss://)
```

## Runtime and restart behavior

`concors-daemon serve` is a reconnectable gateway. A detached session host owns PTYs, agent providers,
workspace state, and pending work. Restarting the gateway preserves live sessions and clients reattach
automatically. See [session continuity](../../docs/session-recovery.md) for host-loss recovery,
one-time migration, private local transport, runtime upgrades, and service-manager configuration.

- `serve [--host] [--port] [--log-level]`: start/reconnect the gateway.
- `stop-host`: deliberately stop the runtime and all sessions; stop the gateway first.
- `serve --ephemeral`: own sessions in this process, intended for isolated tests/temporary machines.
- `GET /health`: gateway and session-host readiness.
- `/ws`: the existing Concors protocol, forwarded without replaying user input.

## Development

```bash
pnpm daemon:dev     # node --watch src/cli.ts serve  (Node 24 runs TypeScript natively)
pnpm daemon:test
pnpm daemon:build   # tsup → dist/cli.js
pnpm daemon:start   # node dist/cli.js serve
```

Configuration (flags win over environment variables):

| Flag          | Env var                    | Default     |
| ------------- | -------------------------- | ----------- |
| `--host`      | `CONCORS_DAEMON_HOST`      | `127.0.0.1` |
| `--port`      | `CONCORS_DAEMON_PORT`      | `7420`      |
| `--log-level` | `CONCORS_DAEMON_LOG_LEVEL` | `info`      |

## Source layout

```text
src/
├── cli.ts                   argument parsing, `serve`, signal handling
├── config.ts                DaemonConfig (Zod-validated: flags > env > defaults)
├── hosting/                 persistent host discovery, lifecycle, and restartable gateway
├── server.ts                session-host Fastify app and protocol lifecycle
├── state.ts                 DaemonState — single source of truth for daemon.ready
├── version.ts               DAEMON_VERSION (inlined from package.json at build time)
└── ws/protocol-endpoint.ts  per-connection handshake handling
```

Design constraints to keep in mind as the daemon grows (see the root README for the full list):

- Everything that crosses the wire is defined in `@concors/protocol` first.
- No Node-specific detail (process handles, fds, paths as `Buffer`, …) may leak into the protocol,
  because the daemon is meant to be replaceable by an implementation in another language.
- Prefer streaming and back-pressure-aware designs; the process must stay cheap when idle and stable
  for days.

## Packaging as a standalone executable (intended approach)

End users must not need Node installed. The plan is:

1. `tsup` with `noExternal: [/.*/]` bundles the daemon and **all** dependencies into one file.
2. Node's [single executable application](https://nodejs.org/api/single-executable-applications.html)
   tooling (`node --experimental-sea-config`, `postject`) embeds that file into a copy of the Node
   binary, producing `concors-daemon-<target-triple>` for each platform.
3. The Tauri app declares it under `bundle.externalBin` in `tauri.conf.json`, which places it next
   to the app executable, and starts/stops it from the Rust side (`apps/desktop/src-tauri/src/daemon.rs`).

This is why `DAEMON_VERSION` is inlined at build time, why relative imports use explicit `.ts`
extensions, and why nothing in the daemon reads its own `package.json` at runtime.

## Workspace persistence

The CLI stores workspace metadata in `~/.concors/workspace.sqlite`; set `CONCORS_DATA_DIR`
to use another directory. Embedded/test servers remain in-memory unless given `workspacePath`.
See [workspace synchronization](../../docs/workspace-sync.md) for supported operations and limits.

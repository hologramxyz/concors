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

## Managed machines

Start the same gateway with the control plane's installer config:

```sh
concors-daemon serve --managed-config /etc/concors/daemon.json
```

`CONCORS_DAEMON_MANAGED_CONFIG` also selects the config file; the flag takes precedence. Managed
mode binds `0.0.0.0` on the config's `port` (443 by default), using `fullchain.pem` and `privkey.pem`
in `tlsDir` (`/etc/concors/tls` by default). The config requires `machineId`, `hostname`,
`controlPlaneUrl`, and `agentToken`. Unreadable config or TLS files prevent startup. The config's
port overrides local `--port` / `CONCORS_DAEMON_PORT`; `--ephemeral` cannot be combined with managed
mode. Without the flag or environment variable, local operation is unchanged.

Only the configured hostname is accepted in `Host`. `GET /health` is open and includes the daemon
version. Other HTTP requests and WebSocket upgrades require an EdDSA machine token with the
configured issuer and machine audience. Present it as `Sec-WebSocket-Protocol: concors.bearer.<token>`
(the gateway echoes that protocol), `Authorization: Bearer <token>`, or `?token=` as a last resort.
The gateway caches the control plane's JWKS for one hour, refreshing unknown key IDs subject to a
30-second cooldown. Machine tokens and browser origins terminate at the gateway; the loopback
session host still uses its private credential, and its maintenance routes remain private.

After listening, the gateway posts version, process uptime, and live terminal count to the
control plane every 30 seconds, using `Bearer <machineId>.<agentToken>` and a 10-second HTTP timeout.
Counting uses the existing private session protocol. Gateway shutdown stops heartbeats and detaches
clients without stopping the session host. Connection logs include `sub` and `sid`, never tokens.
Use separate gateway and session-host service units as described in the session continuity guide.

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

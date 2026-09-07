# Concors

> A cross-platform client and runtime for orchestrating coding agents locally and in the cloud.

Concors lets you run coding agents such as **Claude Code**, **Codex** and **OpenCode** either on your
own machine or on a persistent VPS, and drive them from one desktop client (with a mobile client to
follow).

> **Status: early-stage.** This repository currently contains the project foundation — the
> synchronized workspace UI, project opening/creation/cloning, and real terminal sessions with shell/Codex/Claude Code/OpenCode
> profiles. Unified chat, structured agent tracking, mobile and cloud integration remain planned.
> Expect breaking changes.

## Architecture

```text
                     ┌── Local daemon ── local agents
Desktop client ──────┤
                     └── Remote daemon ─ VPS agents


Future mobile client ─── Remote daemon ─ VPS agents
```

Concors is split into two independent processes that only ever talk through a versioned protocol:

```text
React/Tauri client
       │
       │ Concors protocol  (@concors/protocol — WebSocket + JSON, versioned)
       ▼
Node/TypeScript daemon  (concors-daemon)
       │
       ├── Claude Code
       ├── Codex
       └── OpenCode
```

- **Desktop client** (`apps/desktop`) — Tauri 2 + React. Pure UI. It contains no agent
  orchestration logic and never imports daemon internals. Tauri is used only for the native
  shell: windows, lifecycle, and starting/stopping the bundled daemon.
- **Daemon** (`packages/daemon`) — a standalone Node.js process (eventually shipped as a
  self-contained executable, so users never need Node installed). It will own agent processes,
  sessions, PTYs, filesystem and Git access. The same codebase runs on macOS/Windows/Linux
  laptops and on Linux VPS instances.
- **Protocol** (`packages/protocol`) — the contract between them: Zod schemas and TypeScript
  types shared by every client and mirrored by the daemon. Because the daemon is only reachable
  through this protocol, it could be rewritten in another language (e.g. Rust) without touching
  the clients.
- **Daemon client** (`packages/daemon-client`) — `DaemonConnection`, a tiny host-agnostic
  WebSocket client that connects to `ws://127.0.0.1:<port>` and `wss://remote-daemon.example`
  alike.

## Repository layout

```text
concors/
├── apps/
│   ├── desktop/            Tauri 2 + React + Vite desktop client
│   │   ├── src/              React UI (src/tauri/ is the only place Tauri APIs are imported)
│   │   └── src-tauri/        Thin Rust shell: window, lifecycle, bundled-daemon process control
│   └── mobile/             Reserved for the future React Native / Expo client (README only)
├── packages/
│   ├── protocol/           @concors/protocol — versioned schemas/types shared by clients & daemon
│   ├── daemon-client/      @concors/daemon-client — DaemonConnection (local or remote daemons)
│   ├── daemon/             @concors/daemon — the concors-daemon Node process (Fastify + WebSocket)
│   └── config/             @concors/config — shared ESLint / Prettier configuration
├── .github/workflows/      CI
├── pnpm-workspace.yaml
├── tsconfig.base.json      Strict TypeScript settings every package extends
└── eslint.config.js        Lint rules, including the architectural boundary rules
```

## Getting started

Prerequisites: **Node.js 24**, **pnpm 10+**, and for the native desktop app the
[Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) (Rust toolchain + platform libraries).

```bash
pnpm install
```

### Run the daemon

```bash
pnpm daemon:dev          # watch mode, listens on ws://127.0.0.1:7420
```

```bash
curl http://127.0.0.1:7420/health   # → {"status":"ok"}
```

### Run the desktop app

In a second terminal:

```bash
pnpm desktop:dev         # tauri dev: native window + Vite HMR
# or, without Tauri/Rust:
pnpm desktop:web:dev     # plain browser at http://localhost:1420
```

The status indicator in the top bar turns green once the handshake with the daemon completes.

### All scripts

| Script                   | What it does                                                     |
| ------------------------ | ---------------------------------------------------------------- |
| `pnpm lint`              | ESLint across the monorepo                                       |
| `pnpm format` / `:check` | Prettier                                                         |
| `pnpm typecheck`         | `tsc --noEmit` in every package                                  |
| `pnpm test`              | Vitest in every package                                          |
| `pnpm desktop:dev`       | Tauri dev (native window)                                        |
| `pnpm desktop:build`     | Tauri production build                                           |
| `pnpm desktop:web:dev`   | Frontend only, in the browser                                    |
| `pnpm desktop:web:build` | Frontend production bundle (what CI builds)                      |
| `pnpm daemon:dev`        | Daemon in watch mode (Node runs the TypeScript sources natively) |
| `pnpm daemon:build`      | Bundle the daemon to `packages/daemon/dist/cli.js`               |
| `pnpm daemon:start`      | Run the bundled daemon                                           |
| `pnpm daemon:test`       | Daemon tests only                                                |

Daemon CLI:

```bash
concors-daemon --version
concors-daemon serve [--host 127.0.0.1] [--port 7420] [--log-level info]
```

### Configuration

Copy `apps/desktop/.env.example` to `apps/desktop/.env.local`:

```env
VITE_CONCORS_API_URL=http://localhost:3000        # Concors control-plane API (https://api.concors.dev)
# VITE_CONCORS_DAEMON_URL=ws://127.0.0.1:7420/ws  # optional: override which daemon to connect to
```

Only `VITE_*` variables reach the frontend and they are public. Secrets never go there.

## How the client talks to the daemon

1. The client opens a WebSocket to the daemon's `/ws` endpoint.
2. It sends `client.hello` with the protocol version it speaks and its own identity.
3. The daemon validates the message and answers with `daemon.ready` — or a structured `error`
   followed by a close.

```json
{ "type": "daemon.ready", "protocolVersion": "v1", "daemonVersion": "0.1.0", "status": "ready" }
```

After the handshake, clients can subscribe to durable workspace metadata and submit versioned
project/tab/pane commands. See [Workspace synchronization](docs/workspace-sync.md) for the
command contract, persistence, reconnect behavior, and current limits. Agent execution, terminals,
and file access will be added through the same protocol boundary.

## Local vs. remote daemons

The client never assumes `localhost`. A `DaemonEndpoint` is a URL plus a `kind`:

```ts
localDaemonEndpoint(); // ws://127.0.0.1:7420/ws   kind: "local"
describeDaemonEndpoint("wss://remote-daemon.example"); // wss://…/ws              kind: "remote"
```

Both are handed to the same `DaemonConnection`. `kind` only informs UX and (later) authentication —
it never changes the wire protocol. In the packaged desktop app the native shell starts the bundled
daemon on loopback; a remote daemon is the identical binary running as a service on your VPS.

## Architecture principles

1. Desktop UI and daemon are separate processes.
2. The daemon runs on its own, without Tauri.
3. One daemon codebase for laptops and VPS machines.
4. Clients talk to daemons only through `@concors/protocol`.
5. Tauri-specific code stays inside `apps/desktop` (and inside `src/tauri/` on the web side).
6. The daemon's implementation language is replaceable.
7. No premature optimisation; straightforward TypeScript and small modules.
8. The daemon is designed for low idle CPU, modest memory, long uptimes, many concurrent
   sessions, streaming output and clean termination.
9. Nothing Node-specific leaks into the protocol.

Two of these are enforced by ESLint: apps cannot import `@concors/daemon`, and `@tauri-apps/*` may
only be imported from `apps/desktop/src/tauri/`.

## Contributing & security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

# Concors

> A cross-platform client and runtime for orchestrating coding agents locally and in the cloud.

Concors lets you run coding agents such as **Claude Code**, **Codex** and **OpenCode** either on your
own machine or on a persistent VPS, and drive them from desktop or the new iOS/Android client.

> **Status: early-stage.** This repository currently contains the project foundation — the
> synchronized workspace UI, project opening/creation/cloning, and real terminal sessions with shell/Codex/Claude Code/OpenCode
> profiles, Codex chat and agent tracking. The Expo mobile client is implemented with a testable
> preview; authenticated cloud connectivity, push delivery and store release still need integration.
> Expect breaking changes.

## Architecture

```text
                     ┌── Local daemon ── local agents
Desktop client ──────┤
                     └── Remote daemon ─ VPS agents


Expo mobile client ───── Remote gateway ─ daemon ─ VPS agents
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
- **API client** (`packages/api-client`) — `ApiClient`, a fetch-based client for the Concors
  control plane (`concors-server`): accounts, organizations, cloud machines. Also host-agnostic, so
  the mobile app shares it.
- **Mobile client** (`apps/mobile`) — Expo SDK 57 / React Native hosts the shared desktop
  chat/workspace UI with a swipe sidebar, bottom composer and top tab/pane picker.
  [Try the no-account demo](apps/mobile/README.md) and see the [release gates](docs/mobile-release.md).
- **Client core** (`packages/client-core`) — host-independent lifecycle, secure token-store
  adapter, transcript merging and notification routing helpers.

## Repository layout

```text
concors/
├── apps/
│   ├── desktop/            Tauri 2 + React + Vite desktop client
│   │   ├── src/              React UI (src/tauri/ is the only place Tauri APIs are imported)
│   │   └── src-tauri/        Thin Rust shell: window, lifecycle, bundled-daemon process control
│   └── mobile/             React Native / Expo iOS and Android client + browser preview
├── packages/
│   ├── protocol/           @concors/protocol — versioned schemas/types shared by clients & daemon
│   ├── daemon-client/      @concors/daemon-client — DaemonConnection (local or remote daemons)
│   ├── api-client/         @concors/api-client — control-plane API client (accounts, organizations)
│   ├── client-core/        @concors/client-core — shared client lifecycle and presentation helpers
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
# CONCORS_API_PROXY_TARGET=https://…              # dev only: proxy /api from the Vite server to a real API
# VITE_CONCORS_DAEMON_URL=ws://127.0.0.1:7420/ws  # optional: override which daemon to connect to
```

Only `VITE_*` variables reach the frontend and they are public. Secrets never go there.

### Color themes

Settings → Appearance includes seven palettes, each with light and dark modes. You can also
ask an agent to create a custom theme by saving a JSON file in the machine's theme directory.
See [Color themes](docs/themes.md) for the format, examples, and live reload behavior.

### Accounts

The app requires a Concors account: signed out, you only see the sign-in screen; the workspace
appears once the control plane confirms the session (email + password today). The flow, token
handling and what the server provides are described in [docs/auth.md](docs/auth.md).

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

### Cloud VPS and test billing

From the workspace’s machine menu, choose **Add a machine**, then **New machine**. Select the
region and size, add an SSH public key if the workspace has none, and save a
card on Stripe’s hosted page. Return to Concors and choose **Pay … and create
VPS** to charge the first month and provision the server. The Machines page
shows provisioning progress and SSH access. **Connect a machine** is disabled
and marked **Coming soon**. Subscriptions appear under
**Settings → Account → VPS subscriptions**, including their price, status,
and renewal date.

The control-plane API must have OVH provisioning and Stripe test billing
configured. Prices come from that API’s Stripe account. Set the server’s
`WEB_APP_URL` to the hosted client URL (`http://localhost:1420` in development)
so Stripe can return to the confirmation page. VPS provisioning still uses real
OVH resources when Stripe uses test payments.

`pnpm exec playwright test e2e/vps-billing.spec.ts` covers creation, card setup,
payment failure, subscription display, and the Stripe return pages with mocked
control-plane/Stripe responses. It does not order a real VPS.

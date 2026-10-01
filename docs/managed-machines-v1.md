# Managed machines v1 — daemon, control plane and clients

Plan for review, 2026-09-09. Scope: **Concors-managed VPS** (provisioned by `concors-server`)
and **local machines**. Bring-your-own VPS, the relay and end-to-end encryption are design
constraints only; nothing in v1 implements them, but nothing may make them impossible.

This plan complements [mvp-plan.md](mvp-plan.md) phase 5 ("Cloud and servers"). Ownership
follows that document: the control plane (`concors-server`) is Pierre's; the daemon, shared
packages and clients are this repository's. Contracts between the two are spelled out below so
each side can be built and tested independently.

## 1. Where we are

Two implementations of "the process devices talk to on a machine" exist today:

|               | `@concors/daemon` (this repo)                                                                                     | `packages/agent` in `concors-server`                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | The real daemon: workspace, projects, tabs, terminals, agents, files, session host that survives gateway restarts | Reference implementation of remote access, built 2026-09-09 and running on test-vps-3                                                                         |
| Remote access | None. Gateway and server refuse non-loopback binds "until authenticated remote access is configured"              | TLS on 443 with the machine's Let's Encrypt certificate, machine-token auth via the control plane's JWKS, 30 s heartbeat, config in `/etc/concors/agent.json` |
| Sessions      | Owned by a detached session host; gateway is a restartable HTTP proxy in front of it                              | tmux                                                                                                                                                          |

The control plane already provides, deployed on Railway `dev`:

- machine hostnames (`m-<10 chars>.dev.concors.app`, `.concors.app` in production), kept as A
  records in Cloudflare;
- a Let's Encrypt certificate per machine for `hostname` and `*.hostname`, issued through dns-01
  before the VPS is even delivered, renewed 30 days before expiry, key sealed at rest;
- `POST /api/v1/machines/:id/token` → 15-minute Ed25519 JWT scoped to user, login session
  (= device), organization and machine; `GET /.well-known/jwks.json`;
- `POST /api/v1/agent/heartbeat` authenticated with `Bearer <machineId>.<agentToken>`;
- an installer that pushes one tarball over the management SSH key and verifies the result with a
  real HTTPS request; re-runs on version or certificate change;
- machine fields `hostname`, `certificateExpiresAt`, `agentInstalledAt`, `agentVersion`,
  `agentSeenAt`, `agentError` on every machine response.

## 2. Decisions

1. **One daemon.** `@concors/daemon` gains a _managed mode_; `packages/agent` is deleted from
   `concors-server` once the daemon replaces it on test-vps-3.
2. **Remote access lives in the gateway.** The gateway (`hosting/gateway.ts`) is the only
   process that faces the network. In managed mode it terminates TLS and authenticates every
   connection before proxying to the session host. The session host does not change.
3. **Persistence stays as designed** in [session-recovery.md](session-recovery.md): gateway
   restarts (including daemon updates) keep sessions; host loss recovers through provider resume.
   No tmux.
4. **Direct TLS is the only remote transport in v1.** Managed machines have a public hostname
   and certificate. Local machines keep loopback and no auth. (A relay is what local-from-phone
   and firewalled machines need later; it will be a new _connection kind_, not a redesign.)
5. **Auth is the machine token everywhere remote.** No daemon-side passwords or pairing. The
   token carries the device identity (`sid`), so revoking a login session cuts the device off
   within 15 minutes without touching the machine.
6. **The managed config file is the future enrollment output.** `/etc/concors/daemon.json`
   holds exactly what a later `concors connect` (bring-your-own) would obtain over HTTPS. v1 has
   no enrollment endpoint; the control plane writes the file over SSH.
7. **The daemon ships as a versioned release artifact of this repo.** The control plane pins a
   version and installs from the artifact. It never contains daemon code.
8. **One host, multiple connection kinds.** A host has connections; v1 has two kinds: `local`
   (bundled daemon) and `direct` (`wss://<hostname>/ws` with a machine token). The list for cloud
   machines comes from the control plane, not from a typed URL.

## 3. Architecture (v1)

```text
 phone / desktop                     concors-server (private)                 managed VPS
 ┌──────────────┐  sign in, list     ┌──────────────────────┐   SSH (mgmt key)  ┌────────────────────────┐
 │ client       │ ─────────────────▶ │ accounts, orgs       │ ────────────────▶ │ install / update       │
 │              │  POST /machines/   │ machines (OVH)       │   tarball on stdin │  /etc/concors/daemon.json
 │ host =       │  :id/token         │ DNS + certificates   │                    │  /etc/concors/tls/*.pem │
 │  connections │ ◀───────────────── │ machine tokens, JWKS │ ◀──────────────── │  concors-daemon serve   │
 │  [local,     │  { token }         │ heartbeat            │   heartbeat 30 s   │   gateway: TLS 443,     │
 │   direct]    │                    └──────────────────────┘                    │   token check, proxy    │
 │              │  wss://m-xxx.concors.app/ws  (Sec-WebSocket-Protocol bearer)   │   ──▶ session host      │
 │              │ ───────────────────────────────────────────────────────────────▶│       (loopback, own    │
 └──────────────┘                                                                │        credential)      │
                                                                                 └────────────────────────┘
```

Local machine: the desktop starts the bundled daemon on loopback as today; no config file, no
TLS, no token. The same binary decides its mode from the presence of the config file (or an
explicit `--managed-config` flag).

## 4. Contracts

These are the interfaces between the two repositories. Changing one requires updating this
section and both sides.

### 4.1 `/etc/concors/daemon.json` (written by the control plane, read by the daemon)

```json
{
  "machineId": "7cdcdabc-8a3e-4d29-ae2e-18f097d404e5",
  "hostname": "m-cjs3xaa6hk.dev.concors.app",
  "controlPlaneUrl": "https://concors-server-dev.up.railway.app",
  "agentToken": "<random, base64url, 32 bytes>",
  "port": 443,
  "tlsDir": "/etc/concors/tls"
}
```

- `controlPlaneUrl` is the token issuer (`iss`), the JWKS base
  (`<controlPlaneUrl>/.well-known/jwks.json`) and the heartbeat base. No trailing slash.
- `agentToken` is the machine's own credential; its SHA-256 is stored on the machine row.
- `tlsDir` holds `fullchain.pem` (leaf + chain) and `privkey.pem` (PKCS#8, mode 0640).
- File mode 0640, owner the service user. The daemon must refuse to start in managed mode if
  the file is unreadable or the TLS files are missing.

### 4.2 Machine tokens (issued by the control plane, verified by the gateway)

JWT, `alg: EdDSA`, header `kid`. Claims: `iss` = `controlPlaneUrl`, `sub` = user id,
`aud` = `machineId`, `sid` = login session id, `org` = organization id, `iat`, `exp` (15 min),
`jti`. Verify offline against the JWKS (cache; refetch on unknown `kid`; 30 s cooldown).

The gateway must bound authenticated HTTP and WebSocket lifetimes by `exp`, not just
validate expiry at upgrade. The mobile PR adds this enforcement; it is not in the
original `daemon-v0.2.0` artifact. Expiry closes the client socket with 4401 and detaches
it without stopping the session host. Reconnects request a fresh token; revocation is
bounded by the last issued token's expiry, not immediate.

Managed `/ws` sockets are relayed message by message, and the gateway adds `auth-refresh`
to `daemon.ready`. A client may then send `{ "type": "auth.refresh", "token" }` on the live
socket, and the gateway answers `auth.refreshed`. The gateway verifies the token exactly
like an upgrade token, and it must name the same user, login session and organization as
the socket. On success the deadline moves to the new `exp`. The desktop client does this
two minutes before expiry, so routine rotation never drops the connection. The message
is never forwarded to the session host. A refused or missing renewal still expires the
socket, so revocation keeps the same bound.

The token audience is the **control-plane machine ID**. `workspace.machineId` is an
independently generated persistent daemon namespace and is not expected to equal that
cloud ID. Remote identity comes from the managed TLS hostname and scoped token.

How a client presents it to the gateway, in order of preference:

1. `Sec-WebSocket-Protocol: concors.bearer.<token>` — works from browser and native WebSocket
   APIs, is not logged in URLs. The gateway answers with the same subprotocol.
2. `Authorization: Bearer <token>` — for non-browser clients and plain HTTP calls.
3. `?token=<token>` — last resort; accepted but discouraged.

`GET /health` is the only unauthenticated route: `{ "status": "ok", "version": "<daemon version>" }`.
Everything else, including the WebSocket upgrade, is rejected with 401 before any other
processing. Reference implementation to port: `concors-server/packages/agent/src/auth.ts`
and `tests/auth.test.ts` (jose `createRemoteJWKSet`, audience = machineId).

`GET /activity` takes the same machine token and is served by the session host, which owns the
agents: `{ "busy": boolean, "agents": { "working": number, "waiting": number } }`. `working`
counts agent chats that are starting or working and terminal CLI agents whose activity is
`working`; `waiting` counts chats that need input or have a question or approval pending, and
terminal agents whose activity is `needs_input`. An agent that is open but idle is not busy: its
conversation resumes after a restart. Nor is a question asked without stopping the agent (Codex's
asynchronous questions), which a restart keeps. The control plane asks before installing a new daemon (4.4)
and treats any other answer, such as an older daemon's 401 or 404, as busy.

### 4.3 Heartbeat (daemon → control plane)

`POST <controlPlaneUrl>/api/v1/agent/heartbeat`, `Authorization: Bearer <machineId>.<agentToken>`,
body `{ "version": "0.2.0", "uptimeSeconds": 123, "sessions": 2 }`, every 30 s, 10 s timeout.
Response `{ "ok": true, "version": "<version the control plane ships>" }`. Failures are logged
once and then every tenth time. Reference: `packages/agent/src/heartbeat.ts`. `sessions` may be
the number of live terminal sessions; the control plane only displays it.

### 4.4 Release artifact (this repo → control plane installer)

- Git tag `daemon-v<semver>` on `main` triggers a workflow that builds the daemon and attaches
  **`concors-daemon-linux-x64.tar.gz`** to a GitHub release of the same name.
- The tarball extracts into one directory containing a runnable `bin/concors-daemon` (either a
  single-executable build or `node` + bundled JS; the installer does not care) plus whatever
  native files it needs. It must run on Ubuntu 24.04 x86_64 with no build tools.
- The control plane pins `DAEMON_VERSION`, downloads the asset once, caches it, and streams it
  over SSH. Rolling out a version (setting `DAEMON_VERSION`) makes it available; it does not
  install it everywhere at once. Each machine updates when no agent on it is working or waiting
  (`GET /activity`, 4.2), or when its owner presses **Update now** in the app. Until then the
  machine record carries the pending version (4.6).
- `concors-daemon --version` prints the semver; `/health` reports the same string; the installer
  compares it with the pinned version.

### 4.5 Service layout on a managed machine (installer → daemon)

Per [session-recovery.md](session-recovery.md), two units. The installer creates the `concors`
data directory and both units; the daemon must work when started this way:

```ini
# concors-session-host.service   User=ubuntu, CONCORS_DATA_DIR=/var/lib/concors
ExecStart=/opt/concors-daemon/bin/concors-daemon session-host
ExecStartPost=/opt/concors-daemon/bin/concors-daemon wait-host

# concors-gateway.service        Wants/After=concors-session-host.service
ExecStart=/opt/concors-daemon/bin/concors-daemon serve --managed-config /etc/concors/daemon.json
AmbientCapabilities=CAP_NET_BIND_SERVICE   # bind 443 without root
```

A gateway restart must not end sessions. Installing a new daemon does: the gateway replaces a
session host started by a different build ([session-recovery.md](session-recovery.md)), which
ends its terminals and agents (documented host-loss semantics apply; conversations are kept).
That is why a rolled-out version waits for the machine to be idle or for its owner (4.4). Node is not required on the machine for the daemon; Claude Code,
Codex and OpenCode bring their own requirements and are installed separately (out of scope here).

### 4.6 Machine record (control plane → clients)

Already served by `GET /api/v1/machines` and `/machines/:id`: `hostname` (null until assigned),
`certificateExpiresAt`, `agentInstalledAt`, `agentVersion`, `agentSeenAt`, `agentError`, plus
the existing status fields. A cloud machine is _connectable_ when `status === "running"`,
`hostname` is set and `agentSeenAt` is within the last 90 s. `POST /machines/:id/token` mints
the token; clients should mint right before connecting and again on a 401/4401 close.

`daemonUpdate` is `{ version, installing }` while a rolled-out daemon is not yet on the machine,
otherwise null (absent from older control planes). The app's machine card shows it with an
**Update now** button, which confirms that updating restarts the machine's agents and then calls
`POST /machines/:id/daemon/update` (202; 409 with a message when the daemon is already current or
the machine is not running). `installing` stays true until the new version reports in.

## 5. Work items

Owner **D** = daemon/shared packages (this repo), **C** = clients (this repo), **S** = control
plane (`concors-server`, Pierre). Items with no unmet dependency can start in parallel.

### D1 — Managed mode in the gateway

- Add `--managed-config <path>` (env `CONCORS_DAEMON_MANAGED_CONFIG`) to `serve`. Parse and
  validate the file per 4.1 (`packages/agent/src/config.ts` is a validated reference).
- In managed mode the gateway listens with `https.createServer` using the TLS files, on
  `0.0.0.0:<port>`; the loopback guard is lifted only in this mode. `/health` stays open and
  reports the version. Every other request and every upgrade is authenticated per 4.2 before
  being proxied to the session host. The subprotocol handshake must be echoed back or browsers
  drop the socket.
- Heartbeat per 4.3, started after listen, stopped on shutdown.
- Log the authenticated principal (`sub`, `sid`) on connect/disconnect; never log tokens.
- Tests: config parsing; token accept/reject (other machine, other issuer, expired, wrong key,
  missing claims — port `tests/auth.test.ts`); managed gateway over plain HTTP in tests (TLS
  optional in the constructor) rejecting unauthenticated upgrades with 401 and proxying
  authenticated ones; heartbeat request shape.
- Acceptance: on test-vps-3, with the config the current installer already writes (rename
  `agent.json` → `daemon.json` in S1), `curl https://m-cjs3xaa6hk.dev.concors.app/health`
  validates and answers; the desktop web runner connects with a token from the dev API and gets
  the workspace; a bad token is refused.

### D2 — Linux-installable daemon (no build tools)

- `node-pty@1.1.0` ships no Linux prebuilds; the repo's patch only fixes a macOS chmod. Either
  switch to a prebuilt distribution (`@lydell/node-pty` 1.2.0-beta.15 follows upstream and ships
  per-platform packages; the agent uses it successfully on test-vps-3) or produce prebuilds in
  CI. Decide, keeping the desktop bundle working on all three OSes.
- Make the build self-contained: bundle workspace dependencies (`@concors/protocol`) so the
  artifact has no `workspace:*` references.
- Acceptance: the tarball from D3 runs `concors-daemon --version` on a clean Ubuntu 24.04 box.

### D3 — Release pipeline

- Workflow on tag `daemon-v*`: build, package per 4.4, create the GitHub release, attach the
  asset. Version comes from `packages/daemon/package.json`; the tag must match it.
- Document the release steps in `packages/daemon/README.md`.
- Acceptance: `daemon-v0.2.0` exists with `concors-daemon-linux-x64.tar.gz`; the control plane
  can download it.

### S1 — Installer targets the daemon release (depends on D3)

- Replace `dist/agent` packing with a download of the pinned `DAEMON_VERSION` asset (cached in
  memory/disk).
- Ship `daemon.json` (4.1), the TLS pair, both units (4.5), and an install script that unpacks
  to `/opt/concors-daemon.new`, swaps, restarts the gateway, restarts the host only on a version
  change that requires it, then checks `https://<hostname>/health` reports the pinned version.
- Remove `packages/agent`, `scripts/pack-agent.ts`, the `agent-package` plugin and their tests;
  keep the heartbeat route, machine fields and `MachineAgent` orchestration (rename to
  `MachineDaemon`).
- Acceptance: `pnpm tsx scripts/vps-e2e.ts install <test-vps-3>` puts the real daemon on the
  machine; heartbeats resume; a gateway-only update keeps a running terminal.

### C1 — Host model and machine connect (desktop; depends on D1 for end-to-end)

- Replace `MachineConnection { url }` with a host profile: `{ machineId | "local", label,
connections: Connection[], preferredConnectionId }`, `Connection = { kind: "local" } |
{ kind: "direct", url: "wss://<hostname>/ws" }`. Persisted per device.
- Cloud machines come from `GET /api/v1/machines` (api-client already validates them); build
  their `direct` connection from `hostname`; show connectable / provisioning / offline from the
  fields in 4.6. The "Daemon URL" form in `machine-switcher.tsx` becomes a developer-only
  fallback or goes away.
- Connecting: mint a token (`POST /machines/:id/token`), open the WebSocket with
  `Sec-WebSocket-Protocol: concors.bearer.<token>`; on 401/4401 mint once more, then surface
  "access revoked". `@concors/daemon-client` needs a `protocols` option on its transport.
- Acceptance: pick test-vps-3 in the switcher, see its projects, open a terminal, run a command;
  sign out on another device → that device is refused within 15 minutes.

### C2 — Mobile connect (depends on C1)

Same host model and connect flow in `apps/mobile`; tokens stored in the platform secure store.
Acceptance: phone and desktop attached to the same terminal on test-vps-3.

### S2 — Control-plane follow-ups (independent)

- Background refresh so machines progress without a client polling (certificates, installs and
  DNS all hang off `refreshMachine` today).
- `agentSeenAt`-based `reachable` boolean on the machine response, so clients do not compute the
  90 s rule themselves.
- Production Railway environment: it has no core variables at all today and crashes on every
  deploy; migrations 0012–0014 must run there when it is set up.

## 6. Sequence

1. D1 and D2 in parallel (D1 can be verified against test-vps-3 using the current installer:
   copy `/etc/concors/agent.json` to `daemon.json` by hand for the test).
2. D3, then S1. test-vps-3 switches from `packages/agent` to the daemon; `packages/agent` is
   deleted in the same server PR.
3. C1, demonstrated on the desktop web runner first, then packaged desktop.
4. C2.
5. S2 items whenever convenient; none blocks the above.

## 7. Open questions

- **Token presentation for browsers.** Subprotocol is proposed (4.2). If the daemon-client
  transport cannot set protocols on some platform, `?token=` is the fallback; decide during C1.
- **Host restarts on update.** The installer needs a rule for when a new daemon version requires
  restarting the session host (runtime code changes). Proposal: a `hostRuntimeVersion` field in
  the release metadata; the installer restarts the host only when it changes.
- **Host allowlist / DNS rebinding.** The managed gateway should accept only its own hostname in
  the `Host` header. Cheap; include in D1 if time allows.
- **Where dev-server previews go.** `*.<hostname>` is already in the certificate. Preview
  routing (mvp-plan §6) can be a second listener or a path on the gateway; not v1.

## 8. References

- Reference remote-access implementation: `concors-server/packages/agent/src/*` and its tests;
  installer: `concors-server/src/modules/machines/machine-agent.ts`; control plane docs:
  `concors-server/README.md` sections "Hostnames", "Certificates", "The agent", "Machine tokens".
- Live machine for verification: test-vps-3, `m-cjs3xaa6hk.dev.concors.app`, control plane
  `https://concors-server-dev.up.railway.app`.

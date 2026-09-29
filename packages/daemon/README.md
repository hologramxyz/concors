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

## Native PTY distribution

The daemon pins [`@lydell/node-pty` 1.2.0-beta.15](https://www.npmjs.com/package/@lydell/node-pty?activeTab=readme),
a platform-split distribution of upstream `node-pty` at the same version. It selects a prebuilt
package through optional dependencies and never runs `node-gyp`. Do not install with
`--no-optional` or copy an installed dependency tree between platforms.

| Option                        | Benefit                                                                                       | Cost                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pinned `@lydell/node-pty`     | Published prebuilds for macOS, Linux, and Windows on x64/ARM64; no compiler or install script | Trust the distributor as well as upstream; follows an upstream prerelease; unsupported platforms cannot fall back to compiling |
| Build our own prebuilds in CI | Control toolchains and retain upstream 1.1.0 if needed                                        | Maintain six native targets, Linux libc compatibility, macOS helpers, Windows ConPTY files, and native artifact distribution   |

We use the pinned distribution. It covers our platforms without introducing a native release
pipeline. The old `node-pty@1.1.0` dependency, build-script allowance, and macOS patch are removed.
`pnpm daemon:build` explicitly preserves executable permissions on macOS's `spawn-helper` when
copying the native package; Windows's loader, worker scripts and ConPTY DLLs are copied together.
The existing terminal/session tests continue to run on Linux, macOS, and Windows. CI also builds,
relocates, and exercises each platform's bundle through a real PTY.

## Self-contained daemon build

`pnpm daemon:build` produces a directory that runs with Node 24 on the **build platform**:

```text
dist/
├── cli.js                     daemon and JavaScript dependencies, including @concors/protocol
├── cli.js.map
├── package.json               name/version/type only; no workspace dependencies
├── THIRD_PARTY_NOTICES.txt
├── LICENSE
└── node_modules/@lydell/node-pty-<platform>-<arch>/
    ├── lib/                   native loader and platform support JavaScript
    ├── prebuilds/             PTY addon, macOS helper, or Windows addons/DLLs
    ├── package.json
    └── LICENSE
```

All JavaScript dependencies (including the `@lydell/node-pty` selector) are inlined; only the
selected platform's native package remains on disk. The version is taken from
`packages/daemon/package.json` without embedding its `workspace:*` declarations. No dependency
installation is needed after copying `dist/`. The build includes redistribution notices.

Run `pnpm --filter @concors/daemon exec node scripts/smoke-bundle.ts` after building to test a
copy outside the repository, including version, health, workspace subscription and real terminal
input/output, resize and stop. This catches accidental dependencies on the repository's
`node_modules` and missing native helper files. Native platform CI runs the same check.

The native Linux desktop package embeds this complete runtime directory, including Node and
terminal helpers. See [local desktop packaging](../../docs/local-desktop.md) for the build command
and automatic gateway lifecycle. The directory must remain intact; the daemon is not a single
standalone JavaScript executable.

## Linux release tarball (contract 4.4)

On Linux x86_64 with Node 24, pnpm, and `tar`/xz available, run:

```sh
pnpm install --frozen-lockfile
pnpm daemon:package
```

This builds `packages/daemon/dist/release/concors-daemon-linux-x64.tar.gz`. Packaging downloads the
official Node **24.20.0** Linux x64 runtime and verifies its pinned SHA-256 before including it.
The download requires network access only on the build machine. Update the runtime version and
checksum together in `scripts/package-release.ts` when adopting a Node security update, then rerun
the Ubuntu acceptance check. The tarball uses the official runtime rather than copying a build
host's potentially incompatible Node executable.

The same script packages the macOS runtime as `concors-daemon-darwin-<arch>.tar.gz`:

```sh
pnpm daemon:package:macos
```

`scripts/package-release.ts` holds one entry per supported runtime, each with its own archive name,
pinned SHA-256 and `tar` flag — nodejs.org publishes Linux as `.tar.xz` and macOS as `.tar.gz`.
It never cross-compiles: the bundled native terminal module is the build host's prebuild, so the
target must match the host.

It extracts into exactly one relocatable directory:

```text
concors-daemon/
├── bin/
│   ├── concors-daemon          executable POSIX launcher; execs the bundled Node
│   ├── node                   official Node runtime
│   └── npm                    POSIX launcher for the bundled npm
├── lib/
│   ├── cli.js
│   ├── package.json
│   ├── THIRD_PARTY_NOTICES.txt
│   └── node_modules/@lydell/node-pty-linux-x64/
│       ├── lib/
│       ├── prebuilds/linux-x64/pty.node
│       ├── package.json
│       └── LICENSE
├── npm/                       npm from the same Node release
├── release.json               daemon version, Node version, platform and architecture
├── LICENSE
└── NODE_LICENSE
```

The installer may move this directory to `/opt/concors-daemon` and execute
`/opt/concors-daemon/bin/concors-daemon`. Invoke the launcher at its installed path rather than
symlinking it away from its sibling files. Paths containing spaces are supported. Arguments,
signals and exit status pass through to Node; the existing session-host launch uses the same
bundled Node and `lib/cli.js`. Source maps and build tooling are excluded from the tarball.

The target needs only the normal Ubuntu 24.04 x86_64 runtime libraries and shell: no installed
Node, npm, pnpm, Python, compiler, or network access is needed to start the daemon. Local mode
still binds loopback. Providers such as Codex/Claude and project tools are installed separately.
The bundled `npm` exists for them: provider processes, provider installs and terminals get
`bin/` appended to `PATH`, so npm-published CLIs install, run and update on machines without
Node, while a machine's own Node and npm still take precedence.
CI unpacks the tarball in a fresh `ubuntu:24.04` container with networking disabled and verifies
`--version`, `serve --ephemeral`, HTTP health, and actual terminal operations.

Building locally does not publish a release.

## Publishing a daemon release

The [Daemon release workflow](../../.github/workflows/daemon-release.yml) runs on pushes of
`daemon-v*` tags. `packages/daemon/package.json` is the version source; the workflow fails if
the tag is not exactly `daemon-v` followed by that version, or its commit is not on `main`.
It builds with the frozen lockfile, packages the tarball above, and tests it in clean Ubuntu
24.04 with no network, Node, or compilers, including a real PTY through `serve --ephemeral`.
Only that tested archive is passed to the publishing job.

1. Bump only the daemon's version in `packages/daemon/package.json` in a PR. Include any
   required runtime changes, run CI, review, and merge. For the first release this is `0.2.0`.
   All changes intended for the release must be merged before tagging.
2. Fetch `main` and tag the merged commit after its CI passes. From a clean checkout:

   ```sh
   git switch main
   git pull --ff-only origin main
   test "$(node -p "require('./packages/daemon/package.json').version")" = 0.2.0
   git tag -a daemon-v0.2.0 -m 'Concors daemon 0.2.0'
   git push origin refs/tags/daemon-v0.2.0
   ```

   Use your normal GitHub credentials to push the tag; tags pushed with a workflow's
   `GITHUB_TOKEN` do not trigger another workflow. Do not tag the unmerged PR branch.

3. Watch **Daemon release** in GitHub Actions. It creates a published release named
   `daemon-v0.2.0`, with asset `concors-daemon-linux-x64.tar.gz`. Daemon releases do not
   replace the repository's global **Latest** release; installers address the exact tag.
   Only the publishing job has `contents: write`; the final job downloads the published
   asset anonymously, as the control plane does, and verifies `--version`.
4. Optionally check the download yourself from an empty directory; the repository is public, so
   no token is involved:

   ```sh
   curl -fsSLO https://github.com/hologramxyz/concors/releases/download/daemon-v0.2.0/concors-daemon-linux-x64.tar.gz
   tar -xzf concors-daemon-linux-x64.tar.gz
   ./concors-daemon/bin/concors-daemon --version  # 0.2.0
   ```

   The control-plane installer pins `DAEMON_VERSION=0.2.0` and caches this asset. Never move
   a published tag or overwrite its asset: ship a new version for changed contents.

No additional publishing secret is needed: GitHub supplies the workflow tokens. If a build
or download fails transiently, rerun the failed jobs. If publication partially succeeds,
inspect the release and asset before retrying; publishing deliberately fails for an existing
release rather than replacing it.

## Workspace persistence

The CLI stores workspace metadata in `~/.concors/workspace.sqlite`; set `CONCORS_DATA_DIR`
to use another directory. Embedded/test servers remain in-memory unless given `workspacePath`.
See [workspace synchronization](../../docs/workspace-sync.md) for supported operations and limits.

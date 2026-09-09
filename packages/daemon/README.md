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

The desktop's local daemon API and lifecycle are unchanged. The built directory must stay
alongside its native files. Tauri's future standalone sidecar packaging still needs to arrange
that directory and its launcher; this change does not enable `bundle.externalBin` or introduce
an incomplete single-executable build.

## Linux release tarball (contract 4.4)

On Linux x86_64 with Node 24, pnpm, and `tar`/xz available, run:

```sh
pnpm install --frozen-lockfile
pnpm daemon:package
```

This builds `packages/daemon/dist/release/concors-daemon-linux-x64.tar.gz`. Packaging downloads the
official Node **24.20.0** Linux x64 runtime and verifies its pinned SHA-256 before including it.
The download requires network access only on the build machine. Update the runtime version and
checksum together in `scripts/package-linux.ts` when adopting a Node security update, then rerun
the Ubuntu acceptance check. The tarball uses the official runtime rather than copying a build
host's potentially incompatible Node executable.

It extracts into exactly one relocatable directory:

```text
concors-daemon/
├── bin/
│   ├── concors-daemon          executable POSIX launcher; execs the bundled Node
│   └── node                   official Node runtime
├── lib/
│   ├── cli.js
│   ├── package.json
│   ├── THIRD_PARTY_NOTICES.txt
│   └── node_modules/@lydell/node-pty-linux-x64/
│       ├── lib/
│       ├── prebuilds/linux-x64/pty.node
│       ├── package.json
│       └── LICENSE
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
CI unpacks the tarball in a fresh `ubuntu:24.04` container with networking disabled and verifies
`--version`, `serve --ephemeral`, HTTP health, and actual terminal operations.

Tag-triggered publishing of this tarball as `daemon-v<semver>` is D3. This package command and
layout provide its input; no release is published by building locally.

## Workspace persistence

The CLI stores workspace metadata in `~/.concors/workspace.sqlite`; set `CONCORS_DATA_DIR`
to use another directory. Embedded/test servers remain in-memory unless given `workspacePath`.
See [workspace synchronization](../../docs/workspace-sync.md) for supported operations and limits.

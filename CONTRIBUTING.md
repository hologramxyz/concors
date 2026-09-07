# Contributing to Concors

Thanks for your interest! Concors is early-stage, so the most valuable contributions right now are
design discussions, bug reports against the foundation, and small focused pull requests.

## Development setup

1. Install **Node.js 24** (`.nvmrc` is provided) and **pnpm 10+** (`corepack enable` works).
2. For the native desktop app, install the
   [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/) for your OS.
3. `pnpm install`

Useful loops:

```bash
pnpm daemon:dev          # terminal 1
pnpm desktop:dev         # terminal 2 (or pnpm desktop:web:dev without Rust)
```

Developing on a headless Linux box (VM/VPS)? `scripts/dev-vm-display.sh` starts everything under a
virtual display and serves the native window through noVNC, so you can watch it from a browser tab
on your own machine via one SSH port-forward. Instructions are at the top of the script.

Before opening a PR, run what CI runs:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm daemon:build && pnpm desktop:web:build
```

## Architecture rules

Please read the [architecture section of the README](README.md#architecture) first. In short:

- **The protocol is the boundary.** Anything that crosses client ↔ daemon is defined in
  `packages/protocol` first, as a Zod schema. No Node-specific types may appear there.
- **Clients never import the daemon.** `apps/*` may depend on `@concors/protocol` and
  `@concors/daemon-client` only. ESLint enforces this.
- **Tauri stays in its corner.** In the desktop frontend, `@tauri-apps/*` is imported only from
  `apps/desktop/src/tauri/`. The Rust side (`src-tauri`) contains no product logic.
- **Share only what is genuinely shared.** Protocol types, API clients, domain types and utilities
  go in `packages/*`. Desktop UI components do not.
- **Breaking protocol changes need a new `ProtocolVersion`.** Additive changes (new message types,
  optional fields) are fine within a version.

## Code style

- Strict TypeScript, modern ESM, no `any` unless there is truly no alternative.
- Only erasable TypeScript syntax (no `enum`, `namespace`, parameter properties) — the daemon
  sources run directly under Node's type stripping.
- Formatting is Prettier's job; linting is ESLint's. Run `pnpm format` and `pnpm lint:fix`.
- Prefer small modules and plain functions over frameworks and abstractions.
- Tests live next to the code as `*.test.ts` and run with Vitest.

## Pull requests

- Keep PRs focused; one logical change per PR.
- Explain _why_ in the description, not just _what_.
- Add or update tests for behaviour changes.
- Update documentation (`README.md`, package READMEs) when behaviour or structure changes.

## Reporting issues

Use GitHub Issues. For security vulnerabilities, please follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

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
pnpm mobile:demo         # independent mobile preview; no daemon/account required
```

Developing on a headless Linux box (VM/VPS)? Skip Tauri and run the UI as a web app:
`scripts/dev-web.sh` starts the daemon and the Vite dev server on loopback. From your laptop, open an
SSH tunnel with `ssh -N -L 1420:127.0.0.1:1420 -L 7420:127.0.0.1:7420 user@host` and visit
http://localhost:1420. Hot reload works through the tunnel; anything Tauri-specific (bundled daemon
startup, native menus) is simply skipped in the browser.

Before opening a PR, run what CI runs:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm daemon:build && pnpm desktop:web:build && pnpm mobile:build
```

## Architecture rules

Please read the [architecture section of the README](README.md#architecture) first. In short:

- **The protocol is the boundary.** Anything that crosses client ↔ daemon is defined in
  `packages/protocol` first, as a Zod schema. No Node-specific types may appear there.
- **Clients never import the daemon.** Shared client dependencies include `@concors/protocol`,
  `@concors/daemon-client`, `@concors/api-client` and `@concors/client-core`.
  ESLint enforces the daemon boundary.
- **The control plane is Pierre's.** `concors-server` is integrated, not modified, from this repo.
  Missing server contracts are documented (see `docs/auth.md`) rather than worked around.
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

## Desktop UI

The desktop client uses Tailwind CSS v4 with [shadcn/ui](https://ui.shadcn.com) primitives
(Radix-based). Design tokens live in `apps/desktop/src/styles.css`; light and dark themes are
driven by the `.dark` class on `<html>`.

- Add a primitive with `cd apps/desktop && pnpm shadcn add <component>`. Generated files land in
  `src/components/ui/` and are ours to edit, but keep them close to upstream so they stay
  re-generatable.
- App-level components go in `src/components/`, screens in `src/views/`. Import via the `@/` alias.
- Prefer semantic tokens (`bg-background`, `text-muted-foreground`, `border-border`, …) over raw
  colours so dark mode keeps working.
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

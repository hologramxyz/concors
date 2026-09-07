# Concors mobile (reserved)

This directory is reserved for the future Concors mobile client. No mobile framework is initialised
yet, on purpose.

```text
Future mobile client ─── Remote daemon ─ VPS agents
```

## Plan

- React Native / Expo, TypeScript, sharing the same tooling conventions as `apps/desktop`.
- It will talk **only** to remote daemons (the user's VPS) — a phone never runs agents itself.
- It will reuse the shared packages as-is:
  - [`@concors/protocol`](../../packages/protocol) — message schemas and types
  - [`@concors/daemon-client`](../../packages/daemon-client) — `DaemonConnection`, which already
    relies solely on the standard `WebSocket` API available in React Native

## Ground rules for when this gets built

- Nothing desktop-specific (Tauri, DOM-bound components, desktop CSS) moves into shared packages.
  Only protocol types, API clients, domain types and utilities are shared.
- Anything needed by both clients goes into a new `packages/*` package first, then gets consumed
  here and in `apps/desktop`.

Adding the app should require nothing more than `pnpm create expo-app` in this directory plus
extending `@concors/config/tsconfig/react.json`; the workspace (`pnpm-workspace.yaml`) already
includes `apps/*`.

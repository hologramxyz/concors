# @concors/protocol

The contract between Concors clients and Concors daemons.

```text
Desktop ─┐
Mobile ──┼── @concors/protocol ── daemon (local or remote)
Web ─────┘
```

This package contains **only** Zod schemas, inferred TypeScript types, and pure helpers. It has no
I/O and no dependency on Node or browser APIs, so every client can consume it and a daemon written in
another language (e.g. Rust) can mirror it one-to-one.

## Rules

1. Anything that crosses the client ↔ daemon boundary is defined here first.
2. Nothing here may leak implementation details of a particular daemon (Node APIs, process handles,
   file descriptors, …). The protocol describes _what_, never _how_.
3. Breaking changes require a new `ProtocolVersion`. Additive changes (new message types, new
   optional fields) are allowed within a version.

## Current surface (`v1`)

| Concept               | File           | Notes                                                  |
| --------------------- | -------------- | ------------------------------------------------------ |
| Protocol version      | `version.ts`   | `"v1"`; negotiated during the handshake                |
| Daemon status & info  | `daemon.ts`    | `starting` / `ready` / `shutting_down`, daemon version |
| Client identity       | `client.ts`    | kind (`desktop`, `mobile`, …), name, version, platform |
| Structured errors     | `errors.ts`    | stable error codes + human-readable message + details  |
| Handshake messages    | `messages.ts`  | `client.hello` → `daemon.ready` \| `error`             |
| Transport conventions | `transport.ts` | `GET /health`, `/ws`, default local port               |

## Handshake

```text
client                                  daemon
  │ ── client.hello ───────────────────▶ │  validate + negotiate protocol version
  │ ◀──────────────────── daemon.ready ── │  connection is now usable
  │ ◀───────────────── (or) error ─────── │  followed by close
```

```json
{
  "type": "client.hello",
  "protocolVersion": "v1",
  "client": {
    "kind": "desktop",
    "name": "concors-desktop",
    "version": "0.1.0",
    "platform": "macos"
  }
}
```

```json
{ "type": "daemon.ready", "protocolVersion": "v1", "daemonVersion": "0.1.0", "status": "ready" }
```

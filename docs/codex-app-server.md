# Codex unified chat: transport foundation

The daemon now has a tested `CodexAppServer` transport in
`packages/daemon/src/agents/codex/app-server.ts`. It owns a supplied child process,
performs the initialization handshake, correlates requests, forwards streamed
notifications, and delegates server requests to a host handler. Unhandled input
or approval requests receive an error; they are never implicitly approved.

This is the first part of unified chat. It is not connected to the workspace UI
and does not yet start conversations or persist messages. Existing terminal
profiles continue to launch provider CLIs in terminals.

## Reference and protocol

The separation between transport and provider/session behavior follows the
[Paseo Codex transport](https://github.com/getpaseo/paseo/blob/a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6/packages/server/src/server/agent/providers/codex/app-server-transport.ts),
reviewed at revision `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`. This transport is a
new implementation adapted to Concors' daemon boundary.

The wire format and handshake follow the official
[Codex app-server documentation](https://learn.chatgpt.com/docs/app-server):
newline-delimited JSON-RPC messages over stdio, `initialize`, then `initialized`.
The caller must initialize before making requests. Incoming payloads remain
unknown until the provider adapter validates their method-specific schemas.

## Behavior and verification

Requests have explicit timeouts and are not automatically replayed: a timeout
does not establish whether a state-changing operation took effect. Transport
frames and write buffering are bounded to 2 MiB, with at most 64 outgoing and
16 incoming requests pending. Process failure rejects outstanding work. Closing
the transport terminates its owned process, escalating after two seconds.

Automated child-process tests cover initialization, out-of-order replies,
notifications split inside a UTF-8 character, explicit approval handling,
unknown input requests, timeouts, process exit, and invalid/oversized frames.
The daemon suite passes 33 tests. A local smoke check against the installed
Codex CLI successfully initialized and retrieved seven entries from `model/list`.
It did not start a turn or execute agent work.

## Next integration slice

1. Add typed Codex thread/turn events and normalize them into the shared agent
   lifecycle and timeline, following Paseo's provider adapter.
2. Persist conversation and turn identifiers, timeline items, and pane bindings
   in the machine daemon. Reconcile interrupted/reconnected turns without
   duplicating prompts.
3. Wire the unified chat pane to streaming messages, tool details, explicit
   approvals/input, and interruption. Surface the same state in global Agents.
4. Test two clients viewing one conversation, reconnect during streaming,
   pending approval, failure, and completion immediately followed by a new turn.
5. Build the completion/input notification behavior on authoritative lifecycle
   events, then extend the adapter boundary to Claude Code and OpenCode.

All work stays in the client/daemon repository; Pierre's cloud server repository
is unchanged.

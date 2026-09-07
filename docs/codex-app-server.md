# Codex unified chat

The daemon connects the installed Codex CLI to durable agent sessions. A chat pane
reserves a session and its binding before starting a provider thread. Prompts have
persistent request IDs; reconnecting or retrying the same request never resends a
prompt. Credentials stay with the machine's Codex installation.

## Reference implementation

Reviewed Paseo at `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`:

- `packages/server/src/server/agent/providers/codex-app-server-agent.ts`: thread
  resume, item lifecycle, explicit approval/input handlers, and turn identity.
- `packages/server/src/server/agent/providers/codex/tool-call-mapper.ts`: tool
  summaries and details. Its command normalization helpers are extracted into
  `command-display.ts`, with Apache-2.0 attribution and the existing full license
  in `third-party/paseo-LICENSE`. The remaining mapper is adapted to Concors items.
- `packages/app/src/timeline/turn-liveness.ts`: completion must target the active
  turn, so delayed events cannot close a newer turn.

The [official Codex app-server documentation](https://learn.chatgpt.com/docs/app-server)
is the protocol reference. The installed CLI smoke test additionally verified
`on-request` approval policy and the `workspace-write` thread sandbox spelling.

## State and behavior

SQLite migration 4 adds agent records, paginated timeline items, and durable
request receipts. The machine daemon owns all state. Clients receive global agent
summaries and incremental timeline items over the existing authenticated/tunneled
connection, and read saved conversation pages after reconnecting.

Statuses include starting, idle, working, needs input, done, failed, and interrupted.
Command/file approvals offer only explicit, supported one-time decisions. Structured
user questions can be answered from any client; the first valid answer wins.
Unsupported server requests return errors. Raw reasoning is not stored or displayed.
Closing a client or pane does not stop the agent. Interruption targets a specific
turn. Daemon restart marks unfinished work interrupted and clears stale approvals;
continuing resumes the saved provider thread without replaying its previous prompt.

Limits: 128 saved sessions, eight connected providers (idle providers are evicted
and resumed when needed), and up to 16 pending provider requests. Timeline pages
contain at most 80 items and 384 KiB of item JSON. Individual text/detail fields
are capped at 16,000 characters with an explicit truncation marker. Older items
remain in SQLite and can be loaded in earlier pages. Codex retains its native
thread history independently. Very large native resume responses remain subject
to the transport's 2 MiB frame limit and fail visibly.

## Validation

Real WebSocket tests exercise two clients, one-time prompt dispatch, reconnect
while streaming, explicit approvals, user questions, failure, interruption, late
completion, persisted history, and daemon restart without replay. A real installed
Codex completed a minimal tool-free turn and returned `CONCORS_CHAT_OK`.

Windows/macOS tests use a deterministic provider; they do not establish real Codex
installation or sandbox support on those systems. The UI integration is reviewed in a separate
PR. Claude Code/OpenCode chat adapters and notifications remain later slices.
Pierre's cloud server repository is unchanged.

## Chat client

Choose **Unified chat** from a pane's profile menu, then **Start Codex chat**.
Leave Model empty to use the machine's Codex default, or specify a model available
to that installation. Codex must already be installed and signed in on the machine.
Send with Enter; Shift+Enter inserts a line break. The square button interrupts the
current turn. Closing the pane keeps its conversation in the global Agents view.

The client adapts Paseo's shared timeline presentation: Markdown messages,
collapsible tool summaries/details, explicit approval and question cards, progress
plans, and turn status/timing. It follows output only while scrolled near the end,
with a Latest button to return. Older pages are loaded on demand. Item revisions
prevent a delayed history read from overwriting a newer streamed item. Tool-free
responses and code blocks render without executing HTML or loading remote images.

Agents appear across projects in the sidebar and Agents view, with project context,
prompt-derived names, and authoritative status. A daemon capability check disables
chat on older daemons until they are updated. Uncertain submissions retain their
request ID for an explicit retry; they are never automatically resent.

Browser acceptance covers streaming, reload, cross-client interruption, one-time
approval, structured input, and continuing after closing the original pane. The
browser fixture is a separate test entry point, never a production runtime option.

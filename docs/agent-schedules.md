# Agent schedules

Schedules sit above Workspaces in the desktop and mobile sidebar. They belong to the
selected machine and signed-in account, rather than to a particular client. The daemon
runs them while clients are disconnected. The machine and its daemon must remain on.

## Using schedules

Create a schedule with a workspace, prompt, and either an existing unified agent session
or a new dedicated session. For a new session, select an installed provider and its model
(or leave the model blank for the provider default). Model suggestions come from installed
provider configuration and models discovered in existing sessions; a model ID can also be
entered directly. Provider authentication remains in Settings → Providers.

Choose an interval (at least 15 minutes), a daily time, or weekdays plus a time. Daily and
weekly schedules use an IANA time zone. A repeated clock time at the end of daylight saving
runs once; a nonexistent spring-forward time is skipped. Upcoming-run timestamps in the UI
use the viewing device's time zone.

A dedicated schedule creates one saved conversation on its first run and reuses it. Open
agent brings that same conversation into a tab, even while it is working or waiting for
input. Enabled schedules mark their sessions with a clock in the agent sidebar. Run now
works on paused schedules too. Pausing affects future runs; stop a current turn in its chat.
Deleting a schedule retains the conversation.

## Asking an agent

For example: “Create a Concors schedule to review recent commits every weekday at 09:00
Europe/Rome, using this conversation.” Concors-created schedules appear in the same list
as schedules created manually, with a “Created by agent” label.

Codex, Claude Code, and OpenCode receive the `concors_schedules` MCP tool. ACP providers
receive it when they support HTTP MCP. Pi, OMP, and ACP sessions also receive instructions
for using the same API through their shell tools. These calls retain normal provider tool
approvals. The tool can manage schedules only inside its own workspace.

This does **not** import cron jobs, provider-native loops, or schedules created outside
Concors. Terminal-only agent processes are not schedule targets in this version; use a
unified chat session or a dedicated scheduled session. Newly started/resumed providers get
the scheduling tools; existing processes need to reconnect after updating the daemon.

## Execution and recovery

- A run uses the session's current model and tool-approval settings. New sessions use the
  ordinary approval defaults; scheduling does not grant broader permissions.
- A busy session, a queued prompt, or a pending approval skips the occurrence. Skipped
  occurrences appear in history. An active run is retained even if many later ticks skip.
- Working, needs-input, done, failed, interrupted, and skipped are visible in run history.
  Normal agent notifications and questions continue to work.
- A run is claimed and its next due time committed before provider startup or prompt delivery.
  Crashed deliveries are marked interrupted and never replayed automatically. If the daemon
  is more than 90 seconds late, it records a missed run and advances to the next occurrence.
- Disconnected clients lose write access and reload authoritative schedules on reconnect.
  Revision checks prevent one device from overwriting another's edits. Request IDs make
  retried actions idempotent within the retained 2,048-request receipt window.
- The account's runtime directory contains `schedules.sqlite` alongside `workspace.sqlite`.
  The registry is limited to 64 schedules with 20 recent runs per schedule. Agent histories
  remain in the regular workspace database and are not truncated by this limit.

The agent bridge listens only on loopback with random, per-session credentials. It rejects
browser origins and unrelated Host headers. It never exposes the daemon gateway credential.
Tokens are not stored in schedule definitions, returned to clients, or written into projects.

## Verification

Daemon tests exercise recurrence and DST, persistence/restart recovery, prompt delivery,
model selection, approvals, busy-session skips, action retries, saved-session opening, and
agent API scoping. Desktop and mobile browser tests exercise schedule creation, execution,
conversation navigation and controls through real test daemons with deterministic providers.
The mobile test uses the actual embedded UI and native protocol relay at phone widths;
it does not replace physical iOS/Android testing or live-provider inference testing.

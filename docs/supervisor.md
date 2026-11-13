# Supervisor

Supervisor sits above Schedules in the sidebar. It uses the existing unified agent chat,
provider/model picker, permissions, attachments, and mobile voice composer. Its conversation
belongs to the selected machine and spans that machine's open and saved workspaces. Switching
machines selects that machine's Supervisor. Switching harnesses preserves the existing
provider-specific conversation, just as in an ordinary chat.

## Try it

Run the client and daemon from this branch together (an older daemon displays an update prompt).
Open two disposable workspaces and a unified chat in each. Use your existing Claude Code, Codex,
OpenCode or other configured harness and sign-in; Supervisor does not create another account.

1. Open **Supervisor** and choose an agent/model using the usual composer chip.
2. Ask: “Find the chat where we discussed the mobile release. Read it and summarize what is left.”
3. Ask: “Tell that chat to review the release checklist, and ask the chat in my other workspace to
   review its tests.” Name the workspace/chat when several matches are similar.
4. Open **Delegated work** to see the real delivery states. Follow a conversation link to inspect
   the original chat; delegated prompts carry **From Supervisor**.
5. While a target is busy, send another instruction. It queues by default. Explicitly ask to steer
   or stop a turn when that is what you want. Tool approvals and questions remain in the target
   conversation for you to answer.
6. Navigate away, reload, or disconnect your phone. Work continues on the daemon. Reopen Supervisor
   to see persisted history and delivery updates. Ask it to read the results for a combined summary.
7. Change the harness, then switch back. Each harness's conversation returns in the same chat UI.

The mobile browser acceptance test runs the real shared UI through the native protocol relay.
A native iOS development build is still needed to check the OS keyboard, microphone permission and
App Store sharing drawer on a device. No store release is part of this change.

## Runtime and boundaries

The daemon stores one internal chat container in `workspace.supervisor`, outside `projects`.
It uses the normal agent lifecycle, session binding, queues and provider adapters. Ordinary
workspace operations cannot move or delete that container. `/clear` starts a fresh Supervisor
conversation while preserving its special role. Clients negotiate `supervisor-v1`; older clients
receive neither the internal container nor Supervisor agents. Opening Supervisor advances the
workspace database format to v5 so an older daemon rejects it instead of converting the internal
conversation into an orphaned user workspace. Machines that have not opened Supervisor stay on v4.

Only a selected Supervisor runtime receives the `concors-supervisor` MCP server. Its single
`concors_control` tool exposes a typed operation union: list workspaces/layout/sessions, search
saved message text, read bounded saved transcripts, create sessions, send/queue/steer, open chats,
change workspace layouts, remove queued instructions, explicitly interrupt turns, and read delivery
status. Harnesses without native MCP use the same authenticated loopback JSON endpoint through
their shell. Gateway credentials are never passed to this endpoint. It checks a random session
token, Host, Origin, input schema and request size. The scope is the existing daemon/machine access
boundary, not a new multi-user authorization system.

Read/search calls query local saved history without waking providers. Transcript text is labeled
untrusted context. Operations do not answer other agents' approvals, change their accounts or
permissions, execute terminal keystrokes, remove workspace folders, or change selection directly.
Creating a saved chat requires a separate send operation. Workspace edits use the existing epoch
and version checks and preserve the user's selection when it still exists.

Mutation receipts and prompt provenance are durable. Repeated request IDs return the original
result; different payloads cannot reuse an ID. After restart, uncertain deliveries are marked
interrupted and uncertain mutations are not replayed. The user can inspect the target before
issuing a new instruction. A completion describes the target turn's lifecycle, not proof that the
requested code change was correct.

Claude, Codex and OpenCode already normalize native lifecycle events in their adapters. Supervisor
observes these events for queued/working/input-needed/completed/failed/interrupted updates, without
installing global CLI hooks or repeatedly asking models for progress. It posts durable updates in
the Supervisor timeline. The UI refreshes status while open; automatic extra model turns for
summarization are intentionally not scheduled.

The native iOS host attaches the recipient IDs and registry revision covered by its sharing drawer.
Delegation, including queued delivery, checks those recipients; withdrawal revokes the daemon grant
and configuration changes require another review. Existing target turns retain their usual lifecycle.
Desktop, Android and web retain their existing permission behavior.

## Checks

- `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`
- `pnpm exec playwright test e2e/supervisor.spec.ts`
- `pnpm exec playwright test --config apps/mobile/playwright.direct.config.mts supervisor.spec.ts`

Unit integration coverage includes saved-history reads, duplicate delivery, busy queues, native
approval states, withdrawal, restart recovery, and the authenticated HTTP/MCP contract.

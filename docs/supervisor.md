# Supervisor

Supervisor opens by default on desktop and mobile and sits above Schedules in the sidebar. Explicit session links still open their chat; `?view=workspaces` opens the last workspace. It uses the existing unified agent chat,
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
4. Ask: “Let me know when that agent finishes and bring its reply here.” Supervisor can watch an
   existing conversation as well as work it starts. Approval notices identify the workspace, chat,
   and action (for example, “Write style.css” or “node --test”); they also appear when its instruction
   is queued behind an approval. Completed replies arrive as bounded quoted text in this chat,
   without another user message or model turn. Follow the chat link for the full reply or to answer
   an approval; delegated prompts carry **From Supervisor**.
5. Choose Supervisor's permissions with the existing composer picker. "Always ask", the default,
   is enough: Supervisor's own `concors_control` calls need no approval, because the daemon enforces
   their limits, while its shell and file tools still ask. Bypass permissions also lets those run
   unchecked while Supervisor reads other chats' untrusted text. New targets keep normal
   permissions; Supervisor cannot expand another chat's permissions or answer its approval prompts.
   Ask “Which agents need my approval?” to inspect pending actions. While a target is busy, send
   another instruction. It queues by default. Explicitly ask to steer
   or stop a turn when that is what you want; steering right after sending waits for the turn to
   start, and the result says whether the instruction was sent, queued or steered. Tool approvals and questions remain in the target
   conversation for you to answer.
6. Navigate away, reload, or disconnect your phone. Work continues on the daemon. Reopen Supervisor
   to see persisted history and delivery updates. Ask it to read the results for a combined summary.
7. For a longer workflow, ask it to coordinate three or four agents across two workspaces, wait for
   their results, send dependent follow-ups, and have another agent review the final work. New
   agents open in named tabs without changing your focus. Its event-driven wait can continue after
   you resolve a target approval. Ask it to stop watching a chat when you no longer need updates.
8. Open **Overview** in the header to triage every session without opening each one. Sections
   (Needs you, In progress, Done) list each session once, with its status, where it runs, and its
   one-liners in full: what it needs (a question, a failure, a paused queue), its latest update while it works, and
   the gist of its final reply once done. An approval row shows only the action ("Approve: pnpm
   test") in at most two lines; a longer one unfolds in place to show it in full. The gist is the reply's own
   TL;DR or summary line, else its opening; no model is asked. A row opens the session. An approval
   row offers **Allow once** and **Decline**, as Supervisor's message about it does, and **Ask
   Supervisor**, which drafts a question about it; plans and questions are answered in the chat.
   A chat whose queue is paused with instructions waiting is listed under Needs you, as the
   Supervisor chat marks it ("Queue paused: 2 instructions waiting"), and counts on the Overview
   button; **Review queue** opens the chat to resume it. An open request in the same chat shows
   instead. Once the queue is resumed or emptied, the chat goes back to where it belongs.
   Done shows the last day's finishes and any not yet opened; older ones fold under **Earlier**.
   While Overview is open, the sessions it lists raise no notification cards. Desktop keeps
   Overview beside the chat; a phone opens it in a drawer. Gists need a daemon with
   `supervisor-briefs-v1`.
9. Type **@** in the message to mention an agent or workspace, as **/** lists commands, the
   sessions most recently active first. The message reads `@Name`, and carries the agent's ID, so a
   rename doesn't change what it refers to.
10. Change the harness, then switch back. Each harness's conversation returns in the same chat UI.

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
status, inspect capabilities/permissions, watch/unwatch saved sessions, and wait up to 25 seconds for
a lifecycle change. Wait returns current pending actions and replies without prompting workers;
`on:change` can wait for an already reported approval to be resolved, and a chat deleted or
removed with its workspace during the wait is reported as unavailable. Harnesses without native MCP use the same authenticated loopback JSON endpoint through
their shell. Gateway credentials are never passed to this endpoint. It checks a random session
token, Host, Origin, input schema and request size. The scope is the existing daemon/machine access
boundary, not a new multi-user authorization system.

Read/search calls query local saved history without waking providers. Transcript text is labeled
untrusted context. Operations do not answer other agents' approvals, change their accounts or
permissions, execute terminal keystrokes, remove workspace folders, or change selection directly.
Creating a chat opens its named tab without taking focus by default (`open:false` keeps it saved only). Sending work is a separate operation. Workspace edits use the existing epoch
and version checks and preserve the user's selection when it still exists.

Prompt provenance is durable. The daemon chooses the IDs of everything it creates; a model's
`requestId` is optional and only names a change (send, start, workspace, open-session,
queue-remove, interrupt) so that retrying it returns the original result. Its receipt belongs to
the calling conversation and is kept for a week; different payloads cannot reuse an ID. Reads
always answer from current state. After restart, uncertain deliveries are marked
interrupted and uncertain mutations are not replayed. The user can inspect the target before
issuing a new instruction. A completion describes the target turn's lifecycle, not proof that the
requested code change was correct.

Claude, Codex and OpenCode already normalize native lifecycle events in their adapters. Supervisor
observes these events for queued/working/input-needed/completed/failed/interrupted updates, without
installing global CLI hooks or repeatedly asking models for progress. It posts durable approval and completion updates in the Supervisor timeline, including a bounded
excerpt of the final reply. Watches persist across reconnects and restarts. Each Supervisor
conversation follows at most 64 chats; at the limit, the settled chat idle longest stops being
followed. Only work still in flight keeps a followed chat from retirement, and conversations left
behind by `/clear` retire like any closed chat. Progress and results
stay in the conversation; there is no separate delegation panel. A running Supervisor can wait and
continue the requested multi-step workflow, while background notices do not schedule extra model
turns for summarization.

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

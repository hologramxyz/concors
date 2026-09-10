# Agent interface

Choose **New tab → Agent** to start a chat in a project. Codex is the initial provider.
Open **Agent and model → Back to providers** to choose Claude Code, OpenCode, or Pi.
The machine must have the corresponding CLI installed on its PATH and signed in
with your account. Provider discovery requires the daemon's `agent-providers`
capability; older daemons keep their existing Codex model picker.

## Paseo reuse

See [the UI audit](paseo-ui-audit.md) for the follow-up port and explicit remaining differences.

The following source files were imported from `getpaseo/paseo` revision
`a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6`, under Apache-2.0. The copyright
notice and full license are retained in `third-party/paseo-LICENSE`.

| Upstream source                                             | Concors destination under `apps/desktop/src/agents/paseo` |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `packages/protocol/src/agent-types.ts`                      | `agent-types.ts` (tool detail types extracted)            |
| `packages/protocol/src/tool-call-display.ts`                | `tool-call-display.ts`                                    |
| `packages/protocol/src/path-utils.ts`                       | `path-utils.ts`                                           |
| `packages/protocol/src/tool-name-normalization.ts`          | `tool-name-normalization.ts`                              |
| `packages/app/src/utils/tool-call-detail-state.ts`          | `tool-call-detail-state.ts`                               |
| `packages/app/src/utils/extract-tool-call-file-path.ts`     | `extract-tool-call-file-path.ts`                          |
| `packages/app/src/composer/submit.ts`                       | `submit.ts`                                               |
| `packages/app/src/composer/agent-controls/model-loading.ts` | `model-loading.ts`                                        |

Changes adapt imports, strict optional/indexed types, array syntax, and the English
send-error fallback. The tool icon type is narrowed to the needs of the DOM adapter.
`timeline-item.tsx` and `composer.tsx` connect these helpers to React DOM and Concors'
daemon protocol; Paseo's React Native components cannot be mounted directly here.
Daemon mode presets also follow Paseo's `codex-app-server-agent.ts`.

Additional imports: `components/icons/codex-icon.tsx`,
`components/context-window-meter.utils.ts`, `utils/tool-call-icon-name.ts`, and
`utils/highlight-cache.ts`. DOM adapters replace React Native SVG/clipboard/style
APIs, and the cache constructor uses erasable TypeScript syntax. Syntax highlighting
uses the published `@getpaseo/highlight@0.7.2` package; its packaged third-party
parser licenses remain with the dependency.

## Behavior

- New, split, and converted Agent panes prepare their session automatically and open
  an empty conversation with the normal composer at the bottom. No message is sent
  until submitted. Pane titles use the same live session name as the sidebar.
- Loading and working indicators follow the machine's authoritative status.
- Tool calls expand to show command output, exit codes, and file diffs. Plans show
  steps and completion counts. Sub-agent cards show provider-reported status and
  messages; they are inline activity, not separate navigable child conversations.
- Thinking cards show provider-authored summaries, never raw reasoning content.
- Model choices come from each installed CLI's model catalog. Codex also exposes thinking efforts.
  Settings are saved with the agent and broadcast across clients. Concurrent edits
  reject stale revisions. Controls remain available during active turns; changes apply to the next message.
- The model picker opens on the current provider's models. A back arrow above search
  returns to the provider list; choosing a provider opens its model page without
  changing the current model. Search resets between pages. Escape closes the picker
  and returns focus to its button. Models load when the session starts; the manual
  Refresh models action has been removed. Installed providers are discovered when
  the picker opens; catalogs are cached for 30 seconds. Unavailable catalogs show
  an installation/sign-in error. OpenCode models are limited to connected accounts.
  Selecting another provider's model starts a new chat tab in the same folder.
  The original chat and any running turn remain intact; no messages are replayed
  into the new provider. Retrying the same switch request cannot create two tabs.
- Codex default permissions use workspace-write and on-request approvals. Auto-review
  sends `approvalsReviewer: auto_review` with the same sandbox (requires Codex
  0.115.0 or newer). Full access explicitly selects danger-full-access and no
  approval prompts. Provider errors surface in the conversation.
- Claude Code uses its SDK and normal CLI tool approvals. OpenCode runs a private,
  authenticated loopback server with approval requests. Pi uses its RPC mode with
  an explicit extension that requests confirmation before each tool call.
  Approvals and supported questions appear in the shared chat interface.
  These providers expose model selection, streaming replies, tool activity, and
  interruption. Codex-specific permission modes, thinking effort, plan mode,
  speed tiers, and context usage are not exposed for them. They do not inherit
  Codex's OS sandbox; each CLI retains its own execution and account settings.
- Upload, paste, or drop up to three files, each at most 1 MiB. Images are native
  provider image inputs; other files become machine-local file references. Uploads
  stay in the daemon data directory under `attachments/<session-id>` with private
  file permissions. They are retained with session history; automatic cleanup and
  downloading old attachments are not implemented. Retried requests use the same
  receipt and do not upload or send twice.
- Codex Plan mode and model-provided speed tiers are exposed when available.
  Plan mode uses read-only access, and disabling it restores the default workflow.
- Enter sends; Shift+Enter adds a line. While working, Enter queues a follow-up.
  Queues and drafts belong to the current mounted composer and do not survive
  closing the pane or reloading. Delivered history, settings, and context usage
  are durable and shared. An uncertain send retains its request ID for explicit
  retry, including if another client already sees the turn running.
- Context usage uses Codex's last-turn total against its reported context window;
  the tooltip also shows cumulative usage. Unknown usage stays unknown.
- Dictation uses `SpeechRecognition`/`webkitSpeechRecognition`, when the browser
  provides it, and appends transcript text for review. It requires microphone
  permission and may use the browser vendor's speech service. Unsupported browsers
  and native webviews show it as unavailable; no portable transcription backend is
  included yet.

Native session identifiers are saved with the conversation. Reopening a chat
resumes its provider's session instead of sending the previous prompt again.
Pi session files live under the daemon data directory; Claude Code and OpenCode
use their native session stores. Keep those stores when moving a machine.
Disconnecting the client leaves the daemon and its agents running. Restarting the
daemon interrupts active turns; saved conversations can be continued afterward.
Unreceived output from the other providers is not backfilled after a daemon crash.

## Validation

Daemon tests cover settings synchronization, stale edits, native turn parameters,
attachment storage and request deduplication, structured progress, child activity,
and context events. Provider tests cover model discovery without prompts, atomic
switching, stale revisions, request deduplication, native streaming frames, tool
approvals, interruption, and session resume. Browser acceptance covers the composer,
rich timeline, queued follow-ups, switching to each provider, and returning to the
original chat after reload. Speech recognition is
stubbed in that test; it does not establish microphone/service support on a device.
The imported submit helper is tested for preserved drafts on failure and receipt
retry during an active turn.

Pane profile changes detach the view binding without stopping its agent or terminal.
The previous session remains discoverable. Workspace source packages are excluded
from Vite prebundling so changed schemas reach the development client immediately.

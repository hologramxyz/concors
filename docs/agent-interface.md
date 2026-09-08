# Agent interface

Choose **New tab → Agent** to start Codex in a project. The machine needs a signed-in
Codex installation and the updated Concors daemon (`agent-composer` capability).
The new controls stay disabled against older daemons; existing plain chat remains
available. Pierre's cloud server repository is unchanged.

## Paseo reuse

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

## Behavior

- Loading and working indicators follow the machine's authoritative status.
- Tool calls expand to show command output, exit codes, and file diffs. Plans show
  steps and completion counts. Sub-agent cards show provider-reported status and
  messages; they are inline activity, not separate navigable child conversations.
- Thinking cards show provider-authored summaries, never raw reasoning content.
- Model choices and thinking efforts come from the machine's Codex model catalog.
  Settings are saved with the agent and broadcast across clients. Concurrent edits
  reject stale revisions; controls cannot change during an active turn.
- Default permissions use workspace-write and on-request approvals. Auto-review
  sends `approvalsReviewer: auto_review` with the same sandbox (requires Codex
  0.115.0 or newer). Full access explicitly selects danger-full-access and no
  approval prompts. Provider errors surface in the conversation.
- Upload, paste, or drop up to three files, each at most 1 MiB. Images are native
  Codex image inputs; other files become machine-local file references. Uploads
  stay in the daemon data directory under `attachments/<session-id>` with private
  file permissions. They are retained with session history; automatic cleanup and
  downloading old attachments are not implemented. Retried requests use the same
  receipt and do not upload or send twice.
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

The agent/model selector currently exposes Codex models. Claude Code and OpenCode
remain terminal profiles; their structured chat adapters are separate work.

## Validation

Daemon tests cover settings synchronization, stale edits, native turn parameters,
attachment storage and request deduplication, structured progress, child activity,
and context events. Browser acceptance covers the composer, rich timeline, queued
follow-ups, and persisted settings/history after reload. Speech recognition is
stubbed in that test; it does not establish microphone/service support on a device.
The imported submit helper is tested for preserved drafts on failure and receipt
retry during an active turn.

# Agent interface

Choose **New tab → Agent**, then select an installed provider. Open
**Agent and model → Back to providers** to browse another provider's models.
Selecting one creates a separate conversation in the same folder; the original
chat and any running work remain available. Concors does not replay a transcript
into a different agent.

Open **Settings → Providers** to install supported packages on the connected
machine, enable providers, or configure a profile. Sign in with your own CLI
account using a regular terminal. Installation is separate from authentication.
See [provider support](unified-chat-provider-support.md) for the exact capability
matrix, configuration details, and verification limits.

## Paseo reuse

See [provider support](unified-chat-provider-support.md) for current behavior and
the [historical parity audit](unified-chat-parity-audit.md) for the original defects. The
earlier [UI audit](paseo-ui-audit.md) records the initial composer/timeline port.

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

- Chat settings and working / needs input / done states come from the machine
  and synchronize across clients. Model, thinking, mode, and feature controls
  reflect the selected provider. Settings edits apply to the next message and
  reject stale revisions.
- Model catalogs load on demand. Qualified model IDs and image-input capabilities
  are preserved. The native mobile bridge accepts the same bounded catalog as
  desktop. There is no manual **Refresh models** action in the model picker.
- Native commands and skills appear when reported by the provider. `/compact`
  calls the provider's actual compaction operation and shows running, completed,
  interrupted, or failed activity. Concors never presents an ordinary prompt as
  successful compaction.
- Tool cards preserve native command output, file changes, searches, and child
  activity when supplied. Supported child conversations can be opened read-only.
  Thinking cards show text explicitly emitted for display by the provider;
  opaque/redacted fields and signatures are excluded.
- Tool denial and **Cancel turn** are separate actions. Cancellation interrupts
  the turn, settles pending questions, and rejects late frames. Questions support
  multiple selections and provider-specific MCP elicitation forms.
- Codex defaults to workspace-write with on-request approvals. Auto-review uses
  the same sandbox; full access explicitly removes those restrictions. Other
  CLIs retain their own tool permissions and execution settings. A shared UI
  does not give every CLI Codex's OS isolation.
- **Import session**, **Fork session**, **Rewind**, **Steer current turn**, and
  **MCP servers** appear only where the adapter exposes them. Rewind states
  whether it changes conversation history, checkpointed files, or both. Forks
  and imports open a separate chat; they send no prompt.
- Enter sends; Shift+Enter adds a line. While working, Enter queues a follow-up
  on the daemon. Up to 20 queued messages can continue after all clients close.
  Stop, failure, and a daemon restart pause delivery until explicitly resumed.
- Unsent drafts are scoped to machine and conversation. They survive view
  unmounts; browser storage also preserves them for seven days when available.
  Restricted webviews fall back to scoped memory. Uncertain sends retain their
  request ID and require an explicit retry.
- Attach up to three files, each at most 1 MiB. Images require the selected model
  to support them; other files become machine-local references. Attachment bytes
  stay in private daemon storage and are excluded from queue broadcasts.
  New messages include image/text attachment previews retrieved on demand.
  Historical attachment download and automatic cleanup are not implemented.
- Dictation uses the browser's SpeechRecognition API when available, with
  microphone permission. Native iOS directs users to keyboard dictation. There
  is no portable transcription backend in this change.

Native session IDs are durable. Reopening a conversation resumes its provider
session; the native history adapters backfill available transcript output after
restart using stable item identities. Keep the provider's session store when
moving a machine. Disconnecting a client leaves the daemon and agents running;
a daemon restart marks active turns interrupted and pauses their queues.

The expanded protocol uses the `agent-providers-v2` client capability. An older
client receives an explicit upgrade error before expanded agent messages reach
its old parser. New clients retain the existing fallback for older daemons.

## Validation

The [support report](unified-chat-provider-support.md#validation) records unit,
browser, native CLI, and packaging evidence separately. Browser tests use
controlled providers and do not certify account authentication or native iOS
and Android controls on physical devices.

## Chat primitive audit

See [the detailed primitive audit](chat-primitives-audit.md) for structured tasks,
plan implementation/review, questions/editors/confirmations, permission scopes,
async question recovery, attachments and the shared mobile verification. It also
records the remaining custom-UI and provider-dependent limitations.

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

## Third-party components

Source provenance, adaptation notes, and license locations are recorded in
[third-party source notices](../third-party/source-notices.md).

## Behavior

- Chat settings and working / needs input / done states come from the machine
  and synchronize across clients. Model, thinking, mode, and feature controls
  reflect the selected provider. Settings edits apply to the next message and
  reject stale revisions.
- Model catalogs load on demand. Qualified model IDs and image-input capabilities
  are preserved. The native mobile bridge accepts the same bounded catalog as
  desktop. There is no manual **Refresh models** action in the model picker.
- Native commands and skills appear when reported by the provider: typing `/` at
  the start of a message lists them above the composer. Up/Down moves, Enter runs
  the command (or fills it in when it needs an argument), Tab fills it in to add
  arguments, and Escape hides the list. `/compact`
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
- Attach any number of files, each up to 50 MB (see
  [Attachment uploads](#attachment-uploads)). Each uploads as soon as it is
  attached; a message sent meanwhile goes once the uploads finish. Images reach
  the agent as images when its model takes them; other files, and images too
  large for a provider, become machine-local paths. Attachment bytes stay in
  private daemon storage and are excluded from queue broadcasts. Messages
  include image/text attachment previews retrieved on demand, up to 20 MB.
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

## Attachment uploads

Files no longer travel inside the message. The composer streams each one to the
machine as soon as it is attached, and the `send`, `steer` and `queue-add`
operations carry only `uploads`, references to those files. The protocol is in
`packages/protocol/src/uploads.ts`:

- `upload.request` `begin` announces the file's name, type and size (at most
  50 MB). The client then sends `upload.chunk` messages of 128 KB, as base64 in
  JSON because the client's socket interface and the mobile bridge carry only
  text. It keeps at
  most four unconfirmed; the daemon confirms each with `upload.progress` once it
  is on disk, so an upload never queues more than that ahead of other messages.
  `finish` checks the size and answers with the reference; `cancel` stops one.
- The daemon writes to `<state>/attachments/uploads/<upload id>/~incoming`
  (directory 0700, file 0600) and, once finished, renames it to the sanitized
  file name. A message claims its files by moving that directory to
  `<state>/attachments/<chat id>/<upload id>/`, where the agent reads them and
  where they are removed with the chat. Claims repeat harmlessly, so retries
  and queued deliveries work. The database keeps references, never the bytes.
- An unfinished upload is removed when its client cancels or disconnects, and
  at startup after a crash. A finished one no message claims is removed after
  seven days, as long as a saved draft lasts; removing it from the composer
  removes it at once.
- Images larger than 5 MB of base64, Anthropic's limit and the strictest of the
  providers', go to the agent as a path instead. The composer shrinks still
  images to fit that before uploading, as it shrank them to 1 MB before.
- Drafts save only finished uploads, as references. A file still uploading when
  the app reloads has to be attached again; one stopped by a dropped connection
  or a closed composer uploads again when they come back.

The daemon advertises `attachment-uploads`. Against a machine without it, the
composer keeps the old behaviour (three files of 1 MiB, sent inline) and says
the machine needs a Concors update to attach more or larger files. The daemon
still accepts the inline form from older clients. A client that does not
declare `attachment-uploads` in `client.hello` is sent at most three files per
queued message and eight per chat item, the most its parser accepts.

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

## Message navigation

The tick rail beside a wide conversation indexes every saved user message.
Hover to preview a prompt; nearby ticks expand without moving their click targets.
Click to jump, or focus the rail and use Up/Down, Home/End, and Enter. Reading an
older prompt pauses output-follow until you scroll back down or choose **Latest**.

**Browse your messages** opens the same index as a list in narrow panes and on
mobile. The index reads bounded, session-scoped preview pages independently of
the visible timeline; jumping loads the missing history without resending a prompt.
A history revision invalidates the old index. Older daemons fall back to loaded messages,
with more loaded automatically as you scroll up in the conversation. Native CLI text remains on the
machine; no provider request is needed to list the saved prompts.

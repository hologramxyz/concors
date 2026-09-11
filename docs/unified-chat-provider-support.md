# Unified chat: provider support and implementation evidence

This is the implementation follow-up to the
[September 10 Paseo parity audit](unified-chat-parity-audit.md). It describes
Concors' desktop and shared mobile chat after PR #52, with mobile integration
in PR #53. The historical audit remains a record of the pre-fix code.

## Provider coverage

Concors now has the six built-in integrations in the audited Paseo manifest:
Codex, Claude Code, OpenCode, Pi, GitHub Copilot, and Oh My Pi (OMP). OMP remains
disabled by default, matching the audited manifest.

There are also 38 opt-in ACP presets and configurable profiles with their own
label, executable arguments, environment, and model filter. All 44 entries come
from the audited catalog at Paseo
[`d7c7044`](https://github.com/getpaseo/paseo/commit/d7c7044dfc91d1d18721dc8757ac3bb913d8c232).
The [preset metadata](../packages/protocol/src/provider-presets.ts) retains its
attribution and [Apache license](../third-party/paseo-LICENSE). These are agent
integrations, not an inventory of model vendors or automatically authenticated
accounts. Preset availability is not live certification of every CLI.

ACP negotiates the installed agent's capabilities. Cursor, Kimi, Kiro, and TRAE
have the adaptations identified in the audit: parameterized model configuration,
per-model thinking choices, delayed command discovery, and Kiro session/skill
extensions. Factory Droid's preset rejects injected MCP configuration. Arbitrary
Paseo plugins are not loaded into Concors.

## Settings and installation

1. Connect to the machine and open **Settings → Providers** on desktop or mobile.
2. Find a provider and choose **Install** when a package installer is available.
   Otherwise use its installation guide. Discovery itself never runs `npx` or
   downloads a package.
3. Sign into the real CLI in a terminal on that machine. Installed provider bins
   are added to new terminal environments. Installation does not establish that
   an account is signed in or has an available model.
4. Choose the provider when opening an Agent pane. Use **Configure** for a custom
   executable, account environment, model filter, or supported MCP overrides.

Managed package installs use pinned catalog packages in the daemon's private
provider directory, with at most two concurrent jobs and a five-minute timeout.
They do not replace a system installation. The CLI uses the user's existing
account and credentials; Concors does not resell inference.

Provider configuration is written atomically with private file permissions on
POSIX systems. Clients can see saved environment keys and MCP server names, but
cannot read stored credential values. New values replace the specified keys;
explicit removal deletes a key. Blank MCP JSON preserves saved overrides; `[]`
removes the overrides. Concurrent edits reject stale revisions. Windows file
protection depends on the daemon account's directory ACLs.

MCP configuration accepts stdio or remote servers where supported. Codex accepts
stdio/HTTP, Claude and OpenCode accept their native transports, and ACP receives
only compatible negotiated transports. Pi and OMP use their own CLI configuration.
OpenCode's private HTTP transport credentials remain adapter-owned even when a
profile supplies similarly named environment variables.

## Native capabilities

“Native” below means the adapter is wired to the underlying operation. A CLI can
still reject an operation because of its version, account, current turn, or
available checkpoint. The UI never guesses unsupported controls.

| Provider              | Compact            | Import               | Fork          | Rewind scope           | Steer active turn | MCP status | Child history |
| --------------------- | ------------------ | -------------------- | ------------- | ---------------------- | ----------------- | ---------- | ------------- |
| Codex                 | Native             | Native               | Native        | Conversation           | Native            | Native     | Native        |
| Claude Code           | SDK command/status | SDK store            | SDK fork      | Checkpointed files     | —                 | SDK        | SDK¹          |
| OpenCode              | Native summarize   | Native               | Native        | Files and conversation | —                 | Native     | Native        |
| Pi                    | RPC                | Native session files | —             | —                      | RPC               | —          | —             |
| OMP                   | RPC                | Native session files | —             | —                      | RPC               | —          | —             |
| Copilot / ACP presets | If advertised      | If advertised        | If advertised | —                      | —                 | —          | —             |

¹ Claude child transcript lookup is enabled for its default session store. A
configured `CLAUDE_CONFIG_DIR` supports parent history/import/fork through its
own store; child-history lookup is not advertised there.

Compaction has an explicit running/result state, including provider errors such
as insufficient history. Canceling an approval interrupts the active turn; it
does not merely deny one tool and allow the turn to continue. Unacknowledged
interrupts retire the transport before another turn can reuse it.

Model catalogs retain up to 4,096 models, 1,024-character qualified IDs, image
support, native efforts/modes/features, and reported context usage. Unknown
usage stays unknown. Shared mobile native controls preserve the same catalog
and selection values rather than silently rejecting large catalogs.

Tool cards retain provider-supplied shell, file, search, diff, and child metadata.
Multi-select questions and supported MCP elicitation forms are answered through
the shared client. MCP status is read from the provider; a successful install
is never shown as proof that every server is healthy.

## Sessions, queues, and recovery

- Switching providers, importing a native session, and forking create a separate
  chat tab without replaying prompts. A fork holds its source session steady
  until the native copy finishes. The mobile follow-up explicitly navigates to
  accepted new chats without following another device's selection.
- Rewind validates the current revision, pauses the queue, and publishes a
  history revision so other clients discard stale timeline pages. The UI names
  the scope before confirmation; Claude file checkpoints are not conversation
  rollback.
- Steer is a separate operation for Codex, Pi, and OMP. It is neither a queued
  follow-up nor a way to execute a slash command during a turn.
- The daemon stores up to 20 queued follow-ups with private attachment bytes.
  Dequeue and request reservation are atomic. A client disconnect does not stop
  delivery; Stop, failure, or daemon restart pauses it until explicitly resumed.
- Request receipts prevent duplicate sends, queue entries, and session copies.
  Recorded operation failures remain failures on retry. Uncertain client sends
  retain their original request ID and are not automatically resubmitted.
- Claude, Pi, OpenCode, and ACP history uses stable native identities. Claude's
  local model-change scaffolding is excluded from replayed user messages.
  Missing provider stores cannot be reconstructed from Concors metadata alone.
- Drafts are scoped to the machine and session, with seven-day browser retention
  when storage is available. Restricted embedded contexts retain scoped memory;
  this does not promise draft durability across every native app restart.

## Validation

The changes were checked at distinct layers:

- The final integrated mobile branch passed all 455 repository tests (one opt-in
  live API test skipped), including all shared desktop/daemon changes. This
  includes 201 daemon, 46 client-core, 77 desktop, and 44 mobile tests.
- Workspace type checks, lint, and formatting passed on both implementation
  branches. Mobile type checking also builds its embedded workspace assets.
- Five desktop browser scenarios passed: composer/queue behavior, chat controls,
  switching to Claude Code/OpenCode/Pi, and returning to the original chat.
- All nine mobile direct browser scenarios passed across the integration run and
  focused provider rerun. They use real daemon transport with controlled
  providers, covering approvals, phone-width provider settings, files, terminals,
  provider switching through web/native bridge composers, and fork navigation.
  The provider tests were updated to select an agent before starting the chat.
- Real Codex compaction events and native OpenCode summarization were exercised.
  Claude/Pi compaction rejection paths were observed and surfaced; successful
  compaction on every account/history is not claimed. Native completion fixtures
  cover their terminal compaction states.
- Real Claude, Pi, and OpenCode completed a short prompt and recovered the same
  native transcript after closing/recreating the adapter. Claude default and
  configured-store readers returned the same single user turn and reply.
- Copilot 1.0.83 completed ACP initialization/session creation without a prompt;
  an authenticated inference turn was not exercised. OMP 18.1.17's missing-model
  startup was observed; RPC v2/readiness/approval behavior has fixture coverage.
- The built daemon passed its relocated-bundle smoke check, including version,
  health, workspace, PTY input/output, resize, and clean shutdown.

GitHub Actions jobs were rejected before startup because of account billing or
spending limits. This is an external CI blocker. Local checks do not substitute
for native Windows/macOS compilation, signing, or physical iPhone/Android tests.
No claim is made that all 38 optional ACP presets were authenticated and tested
live. Native command, model, and session availability remains provider-dependent.

## Remaining scope boundaries

The core audit defects and session operations above are implemented. Wider Paseo
features still outside this change include provider quota/rate-limit dashboards,
historical attachment downloads/automatic cleanup, a general plugin loader, and
a portable dictation backend. Pi extension-specific custom UIs are limited to
the supported question and control contract. There is no automatic replay of an
unconfirmed request after a crash and no blanket execution-isolation guarantee
across unrelated CLIs.

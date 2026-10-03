# Unified chat: provider support and implementation evidence

This is the implementation follow-up to the
[September 10 capability audit](unified-chat-parity-audit.md). It describes
Concors' desktop and shared mobile chat after PR #52, with mobile integration
in PR #53. The historical audit remains a record of the pre-fix code.

## Provider coverage

Concors has six built-in integrations:
Codex, Claude Code, OpenCode, Pi, GitHub Copilot, and Oh My Pi (OMP). OMP remains
disabled by default.

There are also 38 opt-in ACP presets and configurable profiles with their own
label, executable arguments, environment, and model filter. The
[preset metadata](../packages/protocol/src/provider-presets.ts) and
[third-party notices](../third-party/source-notices.md) record provenance. These are agent
integrations, not an inventory of model vendors or automatically authenticated
accounts. Preset availability is not live certification of every CLI.

ACP negotiates the installed agent's capabilities. Cursor, Kimi, Kiro, and TRAE
have the adaptations identified in the audit: parameterized model configuration,
per-model thinking choices, delayed command discovery, and Kiro session/skill
extensions. Factory Droid's preset rejects injected MCP configuration. Arbitrary
third-party plugins are not loaded into Concors.

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

Managed package installs go into the daemon's private provider directory, with
at most two concurrent jobs and a five-minute timeout. The npm-published agent
CLIs (Codex, Claude Code, OpenCode, Pi, Copilot, OMP) install their `latest`
release, because vendors gate new models on the CLI version and an install that
starts out of date would immediately show an update; `--save-exact` records the
version that was installed. The `npx` ACP adapters install the exact version their
catalog command names, since nothing offers updates for them afterwards.
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

### Model selection and catalog caching

The picker displays and selects the effective session model even when no explicit
override was saved. Native catalogs retain canonical model IDs and recommendations.
Claude's `resolvedModel` metadata supplies version numbers for alias rows such as
Opus and Fable; a duplicate Default recommendation is folded into its named model.
Custom deployment labels and special aliases retain their names. The inventory
comes from the installed provider and account, so a version it does not advertise
is not added by the UI. See [Claude's model configuration](https://code.claude.com/docs/en/model-config)
for how its aliases and full model names differ.

Visible conversations warm the installed providers in the background without
sending prompts. Composers share a five-minute in-memory cache scoped to the
connection, workspace epoch, and project directory. Reopening the picker or
switching panes reuses its rows; expired data remains visible during a refresh.
Discovery requests are coalesced, failed refreshes retain usable models, and
provider edits or a completed sign-in invalidate the cache. A genuinely cold
catalog can still take time to discover; the provider list is not replaced by a
loading banner. Visible, enabled composers also recheck freshness on window focus
and once per minute. Disconnect clears cached metadata; account/configuration
revisions prevent late responses from restoring stale rows. A fresh app connection
starts a new cache.

The daemon update is required for newly exposed native resolution metadata.
Older daemons still benefit from correct effective-model selection and UI caching,
but cannot supply Claude version metadata they discarded. Native mobile and the
web composer use the same selection and catalog logic.

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

The [chat primitive audit](chat-primitives-audit.md) records the follow-up fixes
for plans, question forms, approval scopes, async input, tools and attachment
previews, including exact source and test boundaries.

Tool cards retain provider-supplied shell, file, search, diff, and child metadata.
Multi-select questions and supported MCP elicitation forms are answered through
the shared client. MCP status is read from the provider; a successful install
is never shown as proof that every server is healthy.

## Sessions, queues, and recovery

- Switching providers replaces the current pane's session binding without adding
  a tab or changing the split layout. Each provider keeps its own conversation;
  switching back restores that history without replaying prompts. The association
  is saved by the daemon and survives reconnects/restarts. Active turns, approvals,
  and queued messages must be finished or stopped/cleared before switching so work
  is never hidden in a detached session. Existing separate tabs are left intact.
  This behavior requires an updated daemon/session host; older runtimes still
  implement the previous new-tab behavior.
- Importing a native session and forking create a separate chat tab without
  replaying prompts. A fork holds its source session steady
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

- The final integrated mobile branch passed **483 repository tests**, with one
  opt-in live API test skipped: 229 daemon, 46 client-core, 77 desktop, 44 mobile,
  28 protocol, 37 API-client and 22 daemon-client tests.
- Workspace type checks, lint and formatting passed on the integrated branch;
  desktop type checks and lint also passed on the desktop PR. Mobile type checking
  builds the embedded workspace assets.
- Five desktop browser scenarios passed: the three account sign-in flows, shared
  chat, and the new questions/plan-review/file-read/attachment-preview scenario.
- All nine mobile direct browser scenarios passed, followed by a focused phone
  chat rerun after isolating account sign-in in the fixture. Coverage includes
  forms, dismissal, plan approval, file reads, no horizontal overflow, provider
  settings, and web/native-bridge switching through Claude/OpenCode/Pi.
- The earlier native probes below remain evidence for the initial provider work;
  the new primitive mappings were checked with deterministic native-protocol
  fixtures and real daemon/browser transport, not inference on every account.
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

The fixes above cover the identified core defects. Context window and plan usage per provider
are described in [Context window and plan usage](agent-usage.md). See the [primitive audit](chat-primitives-audit.md)
for precise limits, including queued async answers and unsupported custom UIs. Additional
features still outside this change include imported attachment downloads/automatic cleanup, a general plugin loader, and
a portable dictation backend. Pi extension-specific custom UIs are limited to
the supported question and control contract. There is no automatic replay of an
unconfirmed request after a crash and no blanket execution-isolation guarantee
across unrelated CLIs.

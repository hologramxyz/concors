# Unified agent chat: Paseo parity audit

**Historical baseline: September 10, 2026, Concors `19e1243` after PR #48.**

The findings below describe that revision, before the fixes. See
[provider support and implementation evidence](unified-chat-provider-support.md)
for the current adapters, settings, native controls, session behavior, validation,
and remaining limits. The [chat primitive follow-up](chat-primitives-audit.md)
covers plans, questions, permission scopes and tool rendering in more depth. This audit is retained to make the original reproductions
and comparison with Paseo reviewable.

At the audited revision, Concors had working foundations for Codex, Claude Code, OpenCode, and Pi, but it
did not yet have Paseo's provider coverage or feature parity. In particular,
manual compaction is not consistently wired, canceling a tool request does not
reliably cancel the turn, and several native features never reach our shared UI.
Passing the existing tests is not sufficient to call these integrations complete.

## Scope and evidence

- Concors: [`19e1243`](https://github.com/concors-dev/concors/commit/19e12437ed2d6acfdc94632c99db1d14970ec4c6), the audited `main` after PR #48.
- Paseo: [`d7c7044`](https://github.com/getpaseo/paseo/commit/d7c7044dfc91d1d18721dc8757ac3bb913d8c232), fetched for this audit. This supersedes the coverage assessment in the earlier [UI audit](paseo-ui-audit.md).
- Reviewed provider registration, native adapters, command dispatch, permissions,
  models/modes, session lifecycle, persistence, composer/timeline, and the shared
  mobile integration. A separate OPSR application is not covered.
- **Source** means an implementation path was inspected. **Fixture** means a
  deterministic local transport/schema reproduction. **Native** means a real
  installed CLI was exercised in a temporary directory. None of these alone
  establishes every provider/account/OS combination.

## 1. Which agents does Paseo actually support?

There are three distinct layers: built-in integrations, configured ACP agents,
and account/model profiles. Counting every model vendor as another agent would
overstate both products' coverage.

### Built-in integrations

| Agent          | Paseo at the audited revision                              | Concors unified chat                                  |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| Codex          | Built-in; native app-server integration                    | Supported; most complete integration, with gaps below |
| Claude Code    | Built-in; native SDK integration                           | Supported; basic conversation and approval flow       |
| OpenCode       | Built-in; native server integration                        | Supported; basic conversation and approval flow       |
| Pi             | Built-in; native RPC integration                           | Supported; basic conversation and approval flow       |
| GitHub Copilot | Built-in; ACP integration                                  | Missing                                               |
| Oh My Pi / OMP | Built-in, **disabled by default**; separate native runtime | Missing                                               |

Sources: [Paseo manifest][p-manifest], [provider registry][p-registry], and
[Concors provider schema](../packages/protocol/src/agents.ts).
Development mocks are excluded. Cursor has a specialized factory, but it is
configured through the ACP path rather than appearing in the built-in manifest.

### ACP catalog: 38 additional presets

Paseo's [in-app catalog][p-acp-catalog] contains the following entries. They create
custom provider configurations; they are not 38 automatically installed or
authenticated agents. Concors currently has no corresponding ACP transport or
provider configuration flow.

| Catalog entries 1–13 | Catalog entries 14–26 | Catalog entries 27–38 |
| -------------------- | --------------------- | --------------------- |
| Agoragentic          | DimCode               | Kimi Code CLI         |
| Amp                  | Dirac                 | MiniMax Code          |
| Auggie CLI           | Factory Droid         | Minion Code           |
| Autohand Code        | fast-agent            | Mistral Vibe          |
| Cline                | Gemini CLI            | Nova                  |
| Codebuddy Code       | Gajae Code            | Poolside              |
| CodeWhale            | GLM Agent             | Qoder CLI             |
| Cortex Code          | goose                 | Qwen Code             |
| Corust Agent         | Grok                  | siGit Code            |
| crow-cli             | Hermes                | Stakpak               |
| Cursor               | Junie                 | TRAE CLI              |
| DeepAgents           | Kilo                  | VT Code               |
| Devin CLI            | Kiro CLI              | —                     |

These are catalog facts, not live compatibility certification of each CLI. Some
entries use wrappers: Amp's preset, for example, launches `amp-acp`. The Factory
Droid preset explicitly disables injected MCP servers. Cursor, Kimi, Kiro, and
TRAE have dedicated ACP adaptations in the [registry][p-registry]. Generic ACP
still needs capability negotiation and provider-specific handling.

### Profiles and plugins

Paseo also permits a named profile to extend an existing provider, with separate
command arguments, environment, label, and replacement or additional models.
Examples include alternate Claude-compatible accounts and Codex-compatible
endpoints. Plugins can supply further providers. Concors' closed four-provider
enum cannot represent these profiles. OpenCode and Pi do expose their own
connected model vendors in Concors, which is useful but is a different feature.
See [Paseo custom providers][p-custom].

## 2. Highest-priority findings

### P1 — Manual compaction is not consistently implemented

The [Concors send path](../packages/daemon/src/agents/manager.ts#L464) dispatches
`/compact` as ordinary `turn/start` text for all four providers. There is no
explicit compaction operation in our protocol or composer command system.
A fixture daemon reproduced this for all four integrations.

| Provider    | Paseo behavior                                                                                                | Concors finding                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Handles `/compact` separately and calls `thread/compact/start`; reconciles item events and `thread/compacted` | Ordinary prompt dispatch; no native manual compaction call. Existing `contextCompaction` rendering is partial.              |
| Claude Code | Processes SDK compaction status/boundary events and updates context usage                                     | The real SDK emitted `status: compacting` during our `/compact` probe, but Concors produced zero compaction timeline items. |
| OpenCode    | Dispatches `/compact` and `/summarize` to `session.summarize`; handles summary/status events                  | Sends text to `prompt_async`; no summarize call or compaction event mapping.                                                |
| Pi          | Dispatches native `compact`; handles manual/automatic compaction and its toggle                               | Sends text to RPC `prompt`; no compact RPC or compaction event mapping.                                                     |

Paseo references: [Codex][p-codex-compact], [Claude][p-claude-compact],
[OpenCode][p-opencode-compact], [Pi][p-pi-compact]. Concors references:
[Claude](../packages/daemon/src/agents/providers/claude.ts),
[OpenCode](../packages/daemon/src/agents/providers/opencode.ts),
[Pi](../packages/daemon/src/agents/providers/pi.ts),
[Codex item mapping](../packages/daemon/src/agents/codex/items.ts#L146).

The Claude native probe observed two completed turns and a compaction-start
status, **not a compact-boundary event**. It proves that SDK command handling
exists and our UI drops its activity; it does not prove successful context
reduction. Automatic compaction performed internally by a CLI must likewise
not be confused with a working Concors manual-compaction control.

Required fix: add explicit command/capability handling, route each provider's
native compaction operation, and persist a single accurate running/completed/
failed indicator. Handle duplicate notifications, interruption, reconnect, and
context updates. Codex's current item title says “Context compacted” even while
the item is running; correct that wording as part of the same work.

### P1 — “Cancel turn” can merely decline a tool

The [UI](../apps/desktop/src/agents/chat.tsx#L294) offers “Cancel turn,” but
[the manager](../packages/daemon/src/agents/manager.ts#L417) forwards a decision
without requesting interruption. The shared
[adapter permission helper](../packages/daemon/src/agents/providers/contract.ts#L111)
converts both `decline` and `cancel` to `false`.

Native reproduction: ask the agent to read a temporary `audit.txt`, return
`{ decision: "cancel" }` at its permission request, and inspect the final state.
Pi finished with `completed` and emitted an assistant reply after cancellation.
OpenCode also finished with `completed`, rather than `interrupted`.
Claude has the same boolean conversion by source inspection; its cancellation
behavior was not tested live in this audit. Do not generalize this finding to
Codex's native approval handling.

Paseo preserves permission denial separately from interruption; its
[ACP response handler][p-acp-cancel], for example, issues a native cancel when
interruption is requested. Concors should preserve the distinction too, settle
all pending input requests, and reject late events from the canceled turn.

### P1 — Model catalogs silently lose valid choices

[The shared catalog helper](../packages/daemon/src/agents/providers/contract.ts#L29)
and [model parser](../packages/daemon/src/agents/controls.ts#L53) truncate to 100.
The protocol also limits catalogs to 100. A 150-model fixture returned only 100,
so providers/accounts later in a combined OpenCode or Pi catalog can disappear.

Separately, catalog model IDs have no matching length limit, but settings and
selection operations cap them at 100 characters. A 130-character ID can be
listed but fails selection validation. These are separate defects in the
[protocol](../packages/protocol/src/agents.ts).

Required fix: consistent model-ID validation and bounded pagination or a
deliberate larger catalog policy with an explicit truncation indicator. Preserve
qualified provider/model IDs and validate selection against the complete catalog.

### P1 — Image support is assumed for every selected model

Concors discards model input capabilities and unconditionally sends native
images in the Claude/OpenCode/Pi adapters. Text-only models available through
OpenCode or Pi may reject those messages. Paseo explicitly guards
[Pi image input][p-pi-images] and uses a local-file hint for text-only models;
its [provider contract documentation][p-provider-docs] also explains the risk of
persisting rejected image content in Pi/OMP history.

This is a source-level gap, not a live reproduction against a text-only model in
this audit. Add capability-aware input conversion before treating attachment
support as universal, and test a follow-up message after a rejected attachment.

### P2 — Context, modes, and model controls are still Codex-centric

Only Codex feeds the shared context meter. Other adapters drop native usage
information, leaving [“Context usage pending”](../apps/desktop/src/agents/context-meter.tsx)
indefinitely. Non-Codex configuration explicitly rejects effort, plan mode,
non-default permission mode, and speed settings in
[the manager](../packages/daemon/src/agents/manager.ts).

These controls are mostly hidden, rather than visibly broken. They are still a
parity gap: Paseo exposes provider-specific modes, thinking options, and supported
feature toggles. See its [session contract][p-session],
[mode definitions][p-manifest], and [OpenCode adapter][p-opencode].
Add a capability/model-driven contract rather than applying Codex permission
or sandbox semantics to every CLI. Preserve current permission defaults.

### P2 — Questions and tool activity lose native structure

[Concors questions](../packages/protocol/src/agents.ts#L27) have no `multiSelect`
field, the UI stores one answer per question, and requests are capped at three
questions. Claude and OpenCode reject larger forms. This prevents faithful
rendering of some native agent questions. Paseo's
[question form][p-questions] supports checkbox and radio selection.

The [shared adapter](../packages/daemon/src/agents/providers/contract.ts#L92)
represents every non-Codex tool as an MCP tool call. Shell commands, file edits,
search, and subagent calls therefore lose the specialized presentation already
available to Codex. Claude also drops nested `parent_tool_use_id` frames.
An expandable generic payload is not equivalent to a readable diff or a child
conversation. Preserve typed tool metadata and provider-authored reasoning
summaries, without inventing details the provider did not report.

## 3. Wider feature coverage

This matrix describes the audited implementation. “Implemented” is deliberately
distinct from “verified on every native platform.”

| Feature                          | Concors state                                                              | Difference or acceptance work                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Own CLI accounts                 | Implemented for the four adapters                                          | CLI installation/sign-in remains external. Installed-on-PATH does not prove authentication.                                         |
| Provider/model picker            | Implemented on desktop and shared mobile flow                              | New agent panes still start as Codex. Allow choosing an installed provider before creating a session.                               |
| Switch provider                  | Creates a new chat; preserves the old session                              | Sound behavior. Do not silently replay one provider's transcript into another.                                                      |
| Streaming replies                | Implemented for all four                                                   | Existing adapter fixtures pass; exercise partial events, tool-only turns, and failures per native provider.                         |
| Working / needs input / done     | Shared authoritative state                                                 | Cancel semantics and compaction activity remain exceptions above.                                                                   |
| Multiple sessions                | Implemented                                                                | Runtime cap is eight; idle runtimes can be evicted and resumed. No automatic task coordination is implied.                          |
| Normal Stop action               | Explicit native interrupt paths exist                                      | Existing adapter tests cover it; distinguish this from the broken approval “Cancel turn” path.                                      |
| Tool approvals                   | Implemented; own native settings differ                                    | No blanket guarantee of identical OS isolation. Add native accept/decline/cancel tests for each adapter.                            |
| User questions                   | Partial                                                                    | Multi-select and larger forms need protocol/UI support. Pi's richer extension UI is only partly mapped.                             |
| Plans, speed, effort             | Primarily Codex                                                            | Native modes/features should be reported and validated per provider/model.                                                          |
| Context and compaction           | Partial                                                                    | Findings above; quota/rate-limit visibility is also absent.                                                                         |
| Slash commands / skills          | No shared discovery or command router                                      | Some text commands may work inside an individual CLI; that is not a consistent unified feature.                                     |
| MCP                              | CLI configuration may still load native MCP tools                          | No shared MCP configuration, catalog, health, or full elicitation parity. Do not describe all MCP use as unsupported.               |
| Tool rendering / subagents       | Richest for Codex                                                          | Other adapters need native tool mappings; no navigable child conversations.                                                         |
| Markdown, code, copy, file links | Implemented in shared timeline                                             | Existing unit coverage passes. Terminal/file-editor work is separate from provider parity.                                          |
| Attachments                      | Up to three files, 1 MiB each; private daemon storage                      | Native images need capability checks. Other files are path hints; old attachments cannot be downloaded through chat.                |
| Queued follow-ups                | Client memory; sent by mounted composer                                    | Survives pane/tab unmount within its scope. Does not become a daemon-owned queue or continue draining after the client disconnects. |
| Drafts and uncertain-send retry  | Connection/machine-scoped memory plus request IDs                          | Drafts survive pane switches and mobile socket reconnection within the scope; hard reload/app restart loses unsent memory.          |
| Sent history and settings        | Durable, shared through daemon                                             | Native session identifiers are saved; ordinary client disconnect leaves the agent running.                                          |
| Daemon restart / missed history  | Partial                                                                    | Active turns become interrupted. Non-Codex resume returns no historical turns, so missed output is not backfilled.                  |
| Import existing native sessions  | Missing shared flow                                                        | Paseo session listing/import is separate from resuming sessions originally created in Concors.                                      |
| Steer an active turn             | Missing explicit operation                                                 | Queuing another message is not equivalent to native steer. Paseo distinguishes send/steer/queue.                                    |
| Rewind / fork                    | Missing explicit operations/UI                                             | Gate by actual provider support; even Paseo does not support every rewind type for every adapter.                                   |
| Dictation                        | Browser SpeechRecognition where available; iOS keyboard dictation guidance | No portable transcription backend. Physical-device microphone behavior was not validated here.                                      |
| Mobile parity                    | Shared daemon/protocol and composer integration                            | Unit/bridge coverage is useful; it does not certify actual SwiftUI menus, keyboard, focus, and device reconnect behavior.           |

Concors evidence: [manager](../packages/daemon/src/agents/manager.ts),
[protocol](../packages/protocol/src/agents.ts),
[composer](../apps/desktop/src/agents/composer.tsx),
[draft store](../apps/desktop/src/agents/draft.ts),
[attachments](../packages/daemon/src/agents/attachments.ts),
[native mobile composer](../apps/mobile/src/workspace/native-chrome.ios.tsx).
Paseo evidence: [session contract][p-session], [composer send behavior][p-input],
[provider implementation directory][p-adapters], [custom-provider docs][p-custom].

## 4. Why the implementations differ

Paseo gives each provider a native implementation behind a shared contract:
catalogs, modes, capabilities, optional features, commands, permissions,
interruption, history, and runtime information. Unsupported features can remain
absent without pretending every CLI behaves like Codex. ACP adds a reusable
transport for many agents, while native adapters handle richer provider-specific
behavior. See [the contract][p-session] and [registry][p-registry].

Concors shares durable state and request receipts successfully, but the internal
transport is still shaped around Codex notifications. The new adapters normalize
only a small subset of their native events. Adding names and logos to the picker
would not address that loss of behavior.

## 5. Recommended implementation sequence

1. **Make the existing four reliable.** Separate cancel from decline; implement
   native compaction and its lifecycle; fix catalog/ID limits and image capability
   handling. Add failing regression cases before the corresponding fixes.
2. **Extend the shared provider contract.** Add provider descriptors, native modes,
   model capabilities, supported commands/features, and normalized context/tool
   events. Keep daemon validation authoritative and support older clients/daemons.
3. **Add provider breadth through ACP.** Implement process lifecycle, initialize,
   authentication status, new/load session, models/modes, streaming tools,
   permissions/questions, cancel, and negotiated host terminal/filesystem access.
   Add Copilot, then exercise Cursor, Gemini CLI, and another ACP implementation
   before exposing the complete catalog. Keep a status per preset: configured,
   unavailable, or validated. A catalog entry alone must not imply verified parity.
4. **Add OMP separately.** Its runtime has protocol negotiation and transport
   differences; renaming Pi is insufficient. Preserve approvals rather than
   copying another application's unattended defaults. See [OMP runtime][p-omp].
5. **Finish richer interactions.** Provider modes/effort, usage, multi-select
   questions, typed tools, slash/skill discovery, then import/rewind/fork/steer and
   daemon-owned queued work where desired. Add custom account profiles with
   explicit configuration and useful installation/authentication diagnostics.

Each stage should be a focused PR with small commits and the same desktop/mobile
behavior backed by shared protocol tests. Importing Paseo code requires preserving
its Apache-2.0 notices, as previous imports already do.

### Release acceptance checklist

For each claimed integration, record CLI version, OS, authentication method, and
whether each test is native or fixture-based:

- [ ] Discover models and modes without sending a prompt; handle missing CLI,
      expired auth, slow startup, a large catalog, and a long qualified model ID.
- [ ] Start a conversation, change model, stream a reply and tool output, edit a
      temporary file, show the diff, and ask both single- and multi-select questions.
- [ ] Accept, decline, and cancel independently. Cancel must interrupt the turn
      and settle pending requests; a later prompt must still work.
- [ ] Compact manually and automatically. Show one lifecycle marker, reconcile
      duplicate events, update context, recover after failure, and continue the
      same native session. No fabricated success or silent ordinary-text fallback.
- [ ] Exercise supported effort/plan/mode controls and reject unsupported values.
- [ ] Send an image to a vision model and a text-only model; send another prompt
      afterward. Exercise a non-image attachment and send failure/retry.
- [ ] Disconnect/reconnect during streaming, tool execution, input requests, and
      compaction; restart the daemon and explain/recover any missed history.
- [ ] Run multiple providers concurrently; switch tabs/providers without stopping
      or replaying the original session; verify request deduplication.
- [ ] Repeat core flows on desktop and a physical phone, including provider menus,
      keyboard, pending questions, scrolling, dictation, and background/reconnect.

## 6. Validation performed in this audit

**197 existing tests passed** at the pinned Concors revision:

| Command                                                    | Result    |
| ---------------------------------------------------------- | --------- |
| `pnpm --filter @concors/daemon exec vitest run src/agents` | 23 passed |
| `pnpm --filter @concors/protocol test`                     | 28 passed |
| `pnpm --filter @concors/client-core test`                  | 41 passed |
| `pnpm --filter @concors/desktop test`                      | 74 passed |
| `pnpm --filter @concors/mobile test`                       | 31 passed |

Additional isolated audit probes:

| Probe                                            | Observed result                                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Fixture daemon: send `/compact` to each provider | Four ordinary `turn/start` requests containing `/compact`; no explicit compact dispatch                               |
| Fixture catalog: parse 150 valid models          | 100 returned                                                                                                          |
| Schema: select a 130-character model ID          | Rejected by `AgentSettingsSchema`                                                                                     |
| Native Claude: short reply, then `/compact`      | SDK `system/status: compacting`; zero normalized compaction items; both turns completed; no observed compact boundary |
| Native Pi: cancel one temporary-file read        | One canceled approval; final status `completed`; assistant replied afterward                                          |
| Native OpenCode: cancel one temporary-file read  | One canceled approval; final status `completed`                                                                       |

The native probes used temporary projects, normal approvals, and the existing
CLI accounts. All requested tools were denied; no repository work was delegated
to an agent. Copilot, OMP, and the 38 ACP catalog entries were inspected in source,
not installed and authenticated for native tests. No physical iOS/Android,
Windows, or macOS testing was performed in this audit. The release checklist
therefore remains open; this PR is an assessment, not a parity certification.

[p-manifest]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/protocol/src/provider-manifest.ts
[p-registry]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/provider-registry.ts
[p-acp-catalog]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/app/src/data/acp-provider-catalog.ts
[p-custom]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/docs/custom-providers.md
[p-session]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/agent-sdk-types.ts#L660
[p-codex-compact]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/codex-app-server-agent.ts#L4889
[p-claude-compact]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/claude/agent.ts#L4260
[p-opencode-compact]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/opencode-agent.ts#L3740
[p-pi-compact]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/pi/agent.ts#L1800
[p-acp-cancel]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/acp-agent.ts#L2376
[p-pi-images]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/pi/agent.ts#L391
[p-provider-docs]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/docs/providers.md#L68
[p-opencode]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/opencode-agent.ts
[p-questions]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/app/src/components/question-form-card.tsx
[p-input]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/app/src/composer/input/input.tsx
[p-adapters]: https://github.com/getpaseo/paseo/tree/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers
[p-omp]: https://github.com/getpaseo/paseo/blob/d7c7044dfc91d1d18721dc8757ac3bb913d8c232/packages/server/src/server/agent/providers/omp/protocol-session.ts

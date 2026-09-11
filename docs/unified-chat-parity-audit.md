# Unified agent chat: initial capability audit

Historical baseline: Concors `19e1243`, September 10, 2026. This records defects
found before the provider and chat primitive fixes; it does not describe current
behavior. See [provider support](unified-chat-provider-support.md) and the
[chat primitive audit](chat-primitives-audit.md) for the implementation and evidence.

## Findings

- The shared chat initially integrated Codex, Claude Code, OpenCode, and Pi.
  Additional ACP agents, configurable providers, and installation controls were missing.
- Session import, fork, rewind, steer, MCP settings, native commands, and some
  model/effort choices lacked a shared capability contract.
- Compaction could take a prompt path instead of the provider's native operation.
  Permission denial, interruption, and pending-input dismissal needed distinct handling.
- Native questions, plan approvals, restored task lists, file reads, and public
  thinking sometimes lost structure during normalization or rendering.
- Attachment formats and provider limits needed validation before dispatch.
  Imported history did not guarantee retrievable attachment bytes.
- Draft, retry, and follow-up state needed durable ownership and protection
  against duplicate dispatch across clients and restarts.

## Resulting implementation

The daemon owns normalized sessions and capabilities. Desktop and mobile use the
same chat components and protocol. Unsupported native operations remain hidden
or fail explicitly; a shared client does not imply identical provider behavior.

The linked reports distinguish unit, browser, native CLI, and packaging checks.
Physical device verification and authentication of every optional provider are
not implied by fixture tests. Source provenance and licenses remain in
[third-party notices](../third-party/source-notices.md).

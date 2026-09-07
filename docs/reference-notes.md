# Concors reference review

Reviewed 2026-09-07 through source and documentation; apps were not launched.
Second project is provisionally identified as Herdr (herdr.dev), matching the user's spoken description; confirmation requested.

## Paseo

- Repository: https://github.com/getpaseo/paseo
- Reviewed commit: a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6
- Reference checkout: /tmp/concors-reference-paseo
- Unified chat means a consistent structured conversation UI across providers. Provider adapters translate native sessions into shared events; each agent retains its own conversation.
- Stream items include user messages, assistant messages, thoughts, tool calls, todo lists, notifications, compaction, and plugin items (`packages/app/src/types/stream.ts`).
- Tool presentation separates readable summary, status, icon, error, file target, and expandable detail (`packages/app/src/tool-calls/presentation.ts`).
- Chat rendering separates older virtualized history, recent mounted history, and live output (`packages/app/src/agent-stream/model.ts`). Turn footers show working state and timing (`turn-footer.tsx`).
- Composer handles attachments, cancellation, queued messages, and optimistic submissions (`packages/app/src/composer/actions.ts`).
- Timeline synchronization preserves message identity across acknowledgements/reconnects. Active-turn lifecycle is authoritative and separate from rendered messages; elapsed time follows turn liveness (`docs/timeline-sync.md`).
- Workspace attention buckets prioritize needs-input, failure, running, attention, done (`packages/protocol/src/agent-state-bucket.ts`).
- Provider integration paths and boundaries: `docs/providers.md`; lifecycle, child agents, resumable closure, archive: `docs/agent-lifecycle.md`.

## Herdr

- Repository: https://github.com/herdrdev/herdr
- Reviewed commit: b99002ac99b09e00b4ca692436cb15a6b0d676f1
- Reference checkout: /tmp/concors-reference-herdr
- Spaces/workspaces contain tabs, which contain splittable terminal panes. Agents are recognized processes within panes. Server owns processes; attached clients own presentation.
- Spaces sidebar carries project/branch/Git context; agents sidebar permits space grouping or attention-priority ordering. See `src/client/shell/agent_sidebar.rs`, `src/config/sidebar.rs`, and `src/ui/sidebar/tokens.rs`.
- States distinguish blocked, working, done (unseen completion), idle (seen), and unknown. Current client docs describe independent completion acknowledgement per client; CLI/API can reflect server seen state.
- Aggregate priority: blocked > unseen idle/done > working > seen idle > unknown (`src/workspace/aggregate.rs`).
- Agent detection starts with foreground process identity. Complete, active lifecycle integrations own status where supported; otherwise screen manifests examine the live bottom buffer, independent of user scroll position. Some integrations provide session identity only. See `docs/next/website/src/content/docs/agents.mdx` and `src/pane/agent_detection.rs`.
- Completion and attention are separate sound events with built-in MP3s, custom paths, and per-agent overrides (`src/sound.rs`, `src/config/sound.rs`). Completion sound is suppressed for the actively viewed tab when terminal focus is not explicitly lost; entering blocked can still request attention (`src/app/actions.rs`).
- Client notifications validate completion against current state, replace pending notifications for a pane, and navigate to the originating pane (`src/client/shell/notification_policy.rs`).
- Progress here primarily means lifecycle/activity and attention, not a trustworthy percentage-complete estimate.

## Potential Concors direction, pending the user's detailed prompt

Use Paseo as the reference for structured provider-independent chat; use Herdr for spaces, agent navigation, status rollups, unseen completion, and distinct completion/input sounds. Define agent state once in the daemon/protocol and consume it consistently in chat, sidebar, and notifications. Keep lifecycle, attention acknowledgement, connection state, and runtime persistence distinct. No implementation decisions are finalized by this review.

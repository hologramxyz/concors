# Concors reference review

Reviewed 2026-09-07 through source and documentation; apps were not launched.
Second project is provisionally identified as Herdr (herdr.dev), matching the user's spoken description; confirmation requested.

## Structured chat

Provider adapters normalize native sessions into shared events. Each agent retains
its own conversation. The timeline displays messages, tool results, plans,
questions, and lifecycle events. The daemon owns working and attention states;
clients share those states across chat, sidebar, and notifications.

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

Use shared structured chat across providers; use Herdr for spaces, agent navigation, status rollups, unseen completion, and distinct completion/input sounds. Define agent state once in the daemon/protocol and consume it consistently in chat, sidebar, and notifications. Keep lifecycle, attention acknowledgement, connection state, and runtime persistence distinct. No implementation decisions are finalized by this review.

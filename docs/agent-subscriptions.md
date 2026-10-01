# Provider subscriptions

People often hold several subscriptions for the same provider — a personal Claude plan and a work
one, two ChatGPT accounts for two jobs — and want each machine to run on one of them, switching
the whole machine over instantly when a plan hits its limit. Concors models one subscription as
one provider configuration: a `ProviderConfig` whose `subscription: { nickname }` field marks it
as an extra signed-in account of its engine. The choice is deliberately **per machine, not per
chat**: exactly one subscription (or the default account) is active per engine, and every chat on
the machine uses it.

## How a subscription works

Only the Claude and Codex engines support subscriptions (`SUBSCRIPTION_ENGINES` in
`packages/protocol/src/providers.ts`), because their CLIs accept an isolated credential home:
`CLAUDE_CONFIG_DIR` for Claude Code and `CODEX_HOME` for Codex. Codex also receives a stable
`CODEX_SQLITE_HOME`, keeping conversation state independent from the selected account. Existing
threads created before that split are discovered in their original account home and resumed there,
so switching accounts does not hide their rollout. When a subscription configuration is saved, the
daemon's provider registry creates
`<data-dir>/accounts/<engine>/<config-id>` (mode `0700`) and pins it into the configuration's
`env` unless the caller supplied its own directory. Every CLI process behind that configuration —
conversations, sign-in commands, the Codex app server — inherits that env, so each subscription
keeps its own OAuth tokens side by side with the others on the same machine. Removing a
subscription deletes the registry-created Claude credential home. For Codex, it deletes
`auth.json` but retains non-credential legacy conversation state so old chats remain recoverable;
a user-supplied credential directory is never deleted.

Claude Code keeps conversations and the person's setup under `CLAUDE_CONFIG_DIR` too, with no
separate setting for them, so on its own a credential home would also give each account its own
history: a chat could not be resumed after switching, and every account would start without the
person's settings. Each registry-created Claude home therefore links the person-level entries to
the machine's own Claude directory (`$CLAUDE_CONFIG_DIR` of the daemon, normally `~/.claude`), the
one the default account uses (`providers/claude-home.ts`):

| Shared through a link                                                                                           | Kept per account                                         |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `projects/` (transcripts), `file-history/`, `todos/`, `plans/`, `history.jsonl`                                 | `.credentials.json`, `.claude.json` (account state, MCP) |
| `settings.json`, `CLAUDE.md`, `keybindings.json`, `agents/`, `commands/`, `skills/`, `output-styles/`, `rules/` | `plugins/`                                               |

Plugins stay apart because Claude Code records a plugin by the absolute path it was installed
under and rejects a marketplace recorded under another config directory. Links are made when a
subscription is created and checked before every launch, so homes from before this change are
migrated on their next use: their entries move into the machine's directory (prompt history is
appended), and anything that conflicts with the machine's copy is kept in the home's
`.concors-unshared/` rather than deleted. Removing a Claude subscription migrates first, so its
conversations survive; deleting the home then removes the links, never what they point to. A
filesystem without symlinks leaves the account on its own copy, as before. Codex needs none of this
because `CODEX_SQLITE_HOME` already separates conversation state from the sign-in.

Subscriptions run their engine's regular CLI: binary resolution falls back to the base
configuration's install directory (`ProviderRegistry.baseId`), so a subscription is "installed"
whenever its engine is. Built-in preset ids cannot become subscriptions.

## Activation

The registry persists one active subscription per engine (`activate` operation on
`provider.request`, guarded by `expectedRevision`; null reverts to the default account). While a
subscription is active, the engine's regular configurations are transparently redirected to its
credential home (`ProviderRegistry.credentialOverlay`), so every chat on the machine — including
existing panes — runs on that account; activating drops idle runtimes and clears catalog and
plan-usage caches so the switch takes effect on the next turn. Subscription configurations
themselves, and any configuration with an explicitly set credential directory, are never
redirected. Terminals get the same overlay (`ProviderRegistry.terminalEnvironment`), so `claude`
or `codex` typed into a terminal started after the switch signs in with the active account rather
than the machine's empty `~/.claude` or `~/.codex`. Sign-in from Settings bypasses the overlay, so connecting the default account or a
specific subscription always addresses that credential home. A chat's account prompt does not: it
checks (and, if the login expired, renews) the account the chat actually runs under, so a chat on a
machine with an active subscription is not asked to sign in to the unused default account. Subscriptions are excluded from the
per-chat provider catalog: the composer keeps offering "Claude Code" / "Codex", never an account
choice. Removing the active subscription reverts the machine to the default account.

## Cross-machine model

Credentials never leave a machine and the control plane stores nothing about provider accounts.
Each machine holds its own independently minted sign-in per subscription — the provider's
supported multi-device model — so the same subscription can be active on several machines at once
without refresh-token rotation conflicts. Connecting a subscription on a machine where it has
never signed in costs one device-code login there; after that, switching between signed-in
subscriptions is instant and local.

## Settings → Subscriptions

The desktop settings page (`apps/desktop/src/settings/subscriptions-settings.tsx`, also reachable
from the mobile settings drawer) separates the subscription library from machine assignments.
Built-in CLI sign-ins are not library entries: only accounts explicitly added as subscriptions are
shown, oldest first and newly added accounts at the bottom. Each local or cloud machine has one
Claude selector and one ChatGPT selector, and selecting an account copies its public provider
configuration to that machine before activating it. Its credentials are still created
independently on that machine, so an assignment that has not signed in there shows a Connect
action. The page opens live management connections while visible; machine status reflects those
connections instead of the control plane's last heartbeat timestamp.

The local daemon holds the library's public account definitions. An account displays its signed-in
email by default; `accountNickname` stores an optional override. Sign-in state
without an open session uses the provider-level `account` operation on `provider.request`
(`AgentManager.providerAccount`), which reuses the session account backends and their privacy
rules: flows are socket-scoped, transient, and never enter receipts or broadcasts. A successful
provider-scoped sign-in refreshes idle sessions of that configuration in every directory.

Connected library accounts also use the provider-level `usage` operation. The daemon starts a
short-lived provider without creating a chat, asks the CLI for its native plan windows, caches the
answer for `AGENT_USAGE_TTL_MS`, and closes it. The UI renders the returned windows and reset times
without assuming fixed plan names, models, or window counts; assignment selectors include the two
most-used windows so an account near a limit is visible while choosing it. This requires the
daemon's `provider-plan-usage` capability (`PROVIDER_USAGE_CAPABILITY`).

The page requires the daemon's `provider-subscriptions` capability
(`PROVIDER_SUBSCRIPTIONS_CAPABILITY`); older daemons show an update hint. Release and install the
updated daemon on managed machines as well as deploying the client. No control-plane changes or
database migrations are needed.

## Validation

`packages/daemon/src/agents/providers/registry.test.ts` covers credential-home provisioning,
engine restrictions, base-install binary resolution, activation and its credential redirection,
and removal cleanup; `packages/daemon/src/agents/providers.test.ts` covers the provider-level
account flow and catalog exclusion over a real socket;
`apps/desktop/src/settings/subscriptions.test.ts` covers grouping, configuration building and safe
cross-machine copies; `e2e/subscriptions.spec.ts` walks library add → sign in → assignment →
per-machine sign in, including Codex device auth across a background refresh.
`providers/claude-home.test.ts` covers linking, migration and conflict handling of Claude homes,
and `registry.test.ts` that history survives switching and removal.

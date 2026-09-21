# Provider subscriptions

People often hold several subscriptions for the same provider — a personal Claude plan and a work
one, two ChatGPT accounts for two jobs — and want to choose per machine and per chat which one an
agent runs on, then switch instantly when a plan hits its limit. Concors models one subscription
as one provider configuration: a `ProviderConfig` whose `subscription: { nickname }` field marks
it as an extra signed-in account of its engine.

## How a subscription works

Only the Claude and Codex engines support subscriptions (`SUBSCRIPTION_ENGINES` in
`packages/protocol/src/providers.ts`), because their CLIs accept an isolated credential home:
`CLAUDE_CONFIG_DIR` for Claude Code and `CODEX_HOME` for Codex. When a subscription configuration
is saved, the daemon's provider registry creates
`<data-dir>/accounts/<engine>/<config-id>` (mode `0700`) and pins it into the configuration's
`env` unless the caller supplied its own directory. Every CLI process behind that configuration —
conversations, sign-in commands, the Codex app server — inherits that env, so each subscription
keeps its own OAuth tokens side by side with the others on the same machine. Removing a
subscription deletes the registry-created credential home, which is its sign-out; a user-supplied
credential directory is never deleted.

Subscriptions run their engine's regular CLI: binary resolution falls back to the base
configuration's install directory (`ProviderRegistry.baseId`), so a subscription is "installed"
whenever its engine is. Built-in preset ids cannot become subscriptions.

Because a subscription is an ordinary provider configuration, everything already keyed by provider
id works per subscription for free: the composer's provider picker lists it under its label
("Claude — Work"), `switch-provider` moves a pane to it, plan usage is cached per configuration,
and the account prompt's dismissal memory is per configuration.

## Cross-machine model

Credentials never leave a machine and the control plane stores nothing about provider accounts.
Each machine holds its own independently minted sign-in per subscription — the provider's
supported multi-device model — so the same subscription can be active on several machines at once
without refresh-token rotation conflicts. Connecting a subscription on a machine where it has
never signed in costs one device-code login there; after that, switching between signed-in
subscriptions is instant and local.

## Settings → Subscriptions

The desktop settings page (`apps/desktop/src/settings/subscriptions-settings.tsx`, also reachable
from the mobile settings drawer) groups the built-in sign-in and extra subscriptions per engine,
shows each one's sign-in state, and offers **Add subscription** (name it, then sign in
immediately), **Connect / Manage sign-in**, and a confirmed **Sign out and remove**. Sign-in state
without an open session uses the provider-level `account` operation on `provider.request`
(`AgentManager.providerAccount`), which reuses the session account backends and their privacy
rules: flows are socket-scoped, transient, and never enter receipts or broadcasts. A successful
provider-scoped sign-in refreshes idle sessions of that configuration in every directory.

The page requires the daemon's `provider-subscriptions` capability
(`PROVIDER_SUBSCRIPTIONS_CAPABILITY`); older daemons show an update hint. Release and install the
updated daemon on managed machines as well as deploying the client. No control-plane changes or
database migrations are needed.

## Validation

`packages/daemon/src/agents/providers/registry.test.ts` covers credential-home provisioning,
engine restrictions, base-install binary resolution, and removal cleanup;
`packages/daemon/src/agents/providers.test.ts` covers the provider-level account flow over a real
socket; `apps/desktop/src/settings/subscriptions.test.ts` covers grouping and configuration
building; `e2e/subscriptions.spec.ts` walks add → sign in → pick in a chat → remove in the
browser.

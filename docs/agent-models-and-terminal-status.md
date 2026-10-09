# Model names, catalog caching, and terminal completion

## Model identity

The unified composer displays provider-reported model names instead of a synthetic
“Machine default” model row. Model catalogs retain default/alias metadata and
canonical IDs, so Claude aliases such as “Fable” or “Opus” can display their reported
version and context variant. Capability lookups (including thinking effort) match
canonical IDs as well as aliases. Claude Code's curated picker can omit the valid
`claude-fable-5` explicit ID, so the daemon adds that documented compatibility row
when the CLI does not report it itself.

Claude reads its effective model from the CLI's context metadata, retains initialization
model rows, and publishes root-session model events. OpenCode publishes assistant model events and restores saved session
model metadata. Pi and ACP return their current native model on startup/resume;
ACP also forwards model changes. Unrelated child-session events do not replace the
parent's model.

If a provider has not reported any concrete model yet, the UI says “Select model”;
it does not guess a version. A provider with an empty catalog can still
be opened to authenticate, using its native automatic selection. For OpenCode
versions without session model metadata, an automatically selected model becomes
known when the provider reports its first response. Choosing a catalog model shows
that selection immediately.

## Remembered settings

Each machine's daemon remembers, per provider configuration, the last model, thinking
effort, approvals (Codex's Default / Auto-review / Full access), speed, native mode
(Claude's permission modes, for example) and features chosen in any chat. A new chat on
that machine opens with the provider last chosen there and that provider's remembered
settings. Resumed native sessions get the same settings but keep their own model. Plan
mode is per conversation and is not carried over.

This lives in the daemon's workspace database, not in the client, so every VPS and the
local machine keep their own, and every device connected to a machine sees the same
defaults. Once the provider reports its catalog and controls, choices it no longer offers
(a retired model, an effort the model lacks) are dropped instead of failing the first turn.
If the remembered provider was removed, disabled or uninstalled, new chats fall back to Codex.

## Catalog lifecycle

- The client keeps bounded, memory-only catalogs per daemon connection, workspace
  epoch, and project directory, shared across chat remounts. Disconnect clears them.
- Cached choices remain visible and usable during refresh. A cold catalog can take
  time to discover; there is no global loading banner. Errors remain visible alongside
  retained choices. In-flight discovery is deduplicated.
- The visible, enabled composer checks its five-minute cache on mount, picker
  opening, window focus, and once per minute while the document is visible. Installed
  providers warm in the background with at most two discovery requests at a time.
  Hidden/disabled chat panes do not warm catalogs.
- Daemon entries are valid for 60 seconds after successful discovery, with a
  five-second retry backoff after failure. Startup seeds the cache. Configuration
  and account revisions invalidate it; late pre-change results cannot restore an
  older client catalog.
- Live model-list transports are reused. Claude's SDK caches initialization data,
  and ACP catalogs are session-negotiated, so stale discovery uses a separate
  prompt-free provider process, closed afterward. It never reinitializes a live
  Claude query, sends a prompt, or approves a tool.
- Codex catalogs follow every `model/list` cursor and exclude provider-hidden rows,
  matching the app-server picker contract instead of silently stopping at its first page.

“Fresh” means the installed provider's current catalog, subject to its own account,
configuration, and network availability, not a guarantee of access to every model.

## CLI versions and updates

Vendors gate new models on the CLI version: Claude Code's remote catalog carries a
minimum Claude Code version per model, and Codex's model list depends on the client
version it reports. An outdated CLI therefore hides the newest models without any error.

The serving daemon checks every npm-published provider every 30 minutes (and when
Settings → Providers is refreshed): it runs the CLI's `--version` and reads the
package's `latest` release from the npm registry. Only the package name is sent.
Provider statuses and model-picker catalog rows carry the result as `version`; the
composer shows a quiet "Codex x.y.z available" label beside its send controls for
an outdated current provider (like Claude Code's own update hint), which opens the
update; the model picker's provider menu offers the same update.

"Update" runs a command scoped to the install that owns the CLI, inferred from where
the executable really lives (symlinks and mise shims/wrappers followed): Concors'
own install prefix (`npm install --prefix`), a mise tool (`mise upgrade <tool>`), a
global npm prefix, Homebrew, or the CLI's own updater for Claude Code's and
OpenCode's native installs. Managed VPSs start with Codex, Claude Code and OpenCode
in Concors' own prefix, and packaged daemons bundle npm, so Update works there without
a system Node. Anything else gets no command, and the user updates it the way they
installed it. If an update exits
cleanly but the version does not move (a minimum release age, a pin), the error says
so. On Windows, versions are shown but the install method is not inferred.

Copies in Concors' own prefix (every managed VPS, and anything installed from
Settings → Providers) update on their own after a check finds a new release, but only
while nothing uses that CLI: no chat of that provider is starting, working or waiting
for an answer, and no terminal runs it (as its profile or typed into a shell). npm
rewrites the package in place, which a live CLI would not survive. Otherwise the
update waits for a later check, and Update stays available meanwhile. Each release is
tried once automatically, so a failed or held-back update leaves its error for the
user instead of retrying every 30 minutes. While any update runs, new chats of that
provider wait for it before launching the CLI. Installs Concors does not own are never
updated without the user pressing Update.

When an installed version changes, the daemon drops its catalogs and restarts idle
runtimes of that provider on the new binary; running turns finish first. Chats keep
their threads. Test daemons with injected providers do not run version checks.

## Terminal completion

A detected working turn followed by a live idle prompt records
`agentTurnCompleted`. The sidebar uses the same green Done indicator as unified
chat. It survives client reconnects and clears for the next turn, process change,
or terminal exit. A newly opened idle CLI is not marked Done. Approvals retain
their amber indicator. Codex can return to idle from its prompt even without OSC
title updates; Claude retains its existing viewport-based detection.

Terminal Done means the observed CLI turn returned to its prompt, not proof that
the requested task succeeded. Plain terminal processes do not expose structured
completion/error events like unified chat.

## Verification and rollout

The completed change passed 566 workspace tests (one opt-in live API test skipped),
workspace typechecks, scoped ESLint/Prettier checks, and the desktop web build.
Four targeted desktop browser scenarios passed, including the two-client terminal
flow; the provider scenarios were rerun after the final cache lifecycle change.

Regression coverage includes alias/version labels, canonical capability matching,
catalog expiry/deduplication/error recovery, connection/directory isolation, late
responses, and prompt-free Claude discovery during a live approval. Browser tests
switch through Claude/OpenCode/Pi, revisit cached catalogs, preserve conversations,
and verify green terminal completion across two clients and reconnects.

A read-only metadata query against the installed Claude CLI confirmed real alias
resolution (including Fable, Opus, Sonnet, Haiku and the 1M variant); no inference
prompt was sent. Fixture transport tests cover native event forwarding. This is
not a claim of live inference certification for every provider or physical phone.

Deploy the updated frontend and daemon/session host together to get the complete
fix. New protocol fields are optional for older peers. Existing daemon processes
continue using their loaded code until restarted; coordinate a session-host
restart with active terminal users. This PR does not restart the live preview.

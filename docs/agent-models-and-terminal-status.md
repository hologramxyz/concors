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

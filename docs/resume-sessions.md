# Resume saved sessions

An empty agent chat offers **Resume session** on desktop and mobile. New chats still prepare the default provider automatically. The picker initially combines saved conversations from all enabled, installed providers for the pane's workspace directory on the connected machine. Each row has its provider logo and name, title, and last-active time. Provider filter chips also pair logos with their names and narrow the list without discarding loaded pages; title/ID search starts empty, and older results load automatically while scrolling. Refresh sits beside Close in the header. It does not restore the removed account/session toolbar.

Drafts, attachments, queued messages, pending requests, and active/non-empty conversations cannot be replaced. A selected session reuses the empty pane; a session already open in that workspace is focused instead. Detached, idle Concourse sessions are rebound with their existing settings. Newly imported sessions start with no unrelated model override and hydrate the provider's native history without sending a prompt. Permission defaults remain conservative.

## Protocol and discovery

The additive `agent-resume-sessions` capability gates the UI. `provider.request/sessions-list` takes a project, pane directory, provider profile, optional cursor/query, and explicit refresh. It does not require a Concourse conversation. Results are bounded to 100 rows per page. Search scans subsequent pages automatically, including when an intermediate page has no matches.

Discovery uses independent, prompt-free transports; Claude and Pi/OMP read transcript files without starting a CLI. Codex and ACP forward native cursors, Claude uses its SDK offset, and OpenCode/Pi use progressively larger native catalogs. ACP must advertise both listing and loading. Cache entries are scoped by connection/epoch on the client and provider-configuration revision/directory on the daemon. They expire after 30 seconds; Refresh bypasses cached results. Each probe has a 15-second deadline and is closed after use.

The combined picker loads at most three provider pages concurrently, keeps independent cursors and retryable errors, and sorts loaded sessions by recency. A failing or slow provider does not hide successful results. Native IDs are scoped by provider, so identical IDs from different providers remain separate. Filtering preserves the loaded catalog, while refresh and search isolate old responses from the current results. The rendering window grows in batches of 50 rows while provider requests remain bounded to 100 rows per page.

The daemon only permits `agent.request/resume-session` for IDs offered by scoped discovery within five minutes. Reservation checks the current agent revision, full saved history, pending/queued work, pane binding, and existing native session identity in one SQLite transaction. Request receipts make retries idempotent. Unsupported providers and discovery errors stay local to their provider; the picker remains usable.

## Limits

This resumes saved conversation state, not ownership of a running terminal process. Stop the native CLI first. Known busy sessions and active detached Concourse agents are rejected, but providers do not offer a universal cross-process lock or reliable external-busy signal. There is no claim of safe simultaneous writes from two native clients.

Listings remain in the current directory (not sibling worktrees or other workspaces). Native offset-based catalogs can move while another client updates them; duplicate rows are collapsed, and Refresh starts a fresh listing. Provider availability, authentication, native retention, and native history/model support still apply. No copied prompt, automatic tool approval, live CLI termination, or provider installation is performed by the picker.

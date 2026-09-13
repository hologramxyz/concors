# Search

The sidebar Search button and Ctrl+Shift+K open the same Search interface on desktop and mobile.
Outside terminals, Ctrl+K (Command+K on macOS) is also supported. Desktop uses a dialog; mobile
uses the existing animated bottom drawer, leaving the sidebar visible behind it until a result is
chosen. Escape, the close button, and the backdrop dismiss Search and restore its opener. Reopening
starts with an empty query and the All category.

Search is a machine-scoped navigation finder, not a full-text index:

- Workspaces match their names and directory paths. Duplicate names have distinct IDs and show
  their paths to make the destinations distinguishable.
- Tabs match their names, workspace, pane profile, working directory, and attached agent's name,
  provider, and model. Each split leaf has its own destination in saved display order; mobile uses
  the same flat labels as its tab picker. Selecting a result opens that exact agent/terminal pane.
- Commands are secondary: use the Commands category, or type an action such as Settings or
  Shortcuts in All. Only available commands appear; desktop split/focus commands stay off mobile.

Matching ignores case and accents, requires every typed word (in any order), and ranks exact names
ahead of path/metadata matches. Equal matches favor the active workspace. Thirty navigation results
are rendered at a time, with Show more to reveal the rest. Live snapshots update renamed/removed
tabs and agent metadata without a separate index or network request.

Search only sees the selected machine's subscribed workspace and agent metadata. Switching machine
or account does not retain a query or reuse another connection's index. It does not enumerate other
machines, read directories, load transcripts, or persist searchable data on disk. The UI explicitly
states that messages and file contents are not searched. Full-text chat/file search would need a
separate daemon-backed query API with pagination, permissions, and exact-result navigation.

Desktop selection uses the existing shared workspace command and local pane focus. Mobile selection
stays device-local and does not alter desktop layout/selection. Existing unsent chat drafts survive
navigation. Closing the drawer must not unregister an action before it executes, so selected commands
capture their enabled handler before closing and open the destination afterward.

Validation lives in `apps/desktop/src/search/index.test.ts`, `e2e/sidebar-search.spec.ts`, and
`apps/mobile/e2e-direct/search.spec.ts`, alongside existing shortcut/dialog/sidebar/native-surface
regressions. Browser fixtures use temporary projects on real test daemons with deterministic agents.

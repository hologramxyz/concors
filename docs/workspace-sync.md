# Workspace synchronization, first milestone

The daemon owns workspace metadata. `workspace.subscribe` after the normal handshake returns a complete `workspace.snapshot`; every committed command broadcasts the next snapshot to subscribers. Reconnect always refreshes from a full snapshot. Incremental event replay is deferred until state size justifies it; clients already consume monotonically increasing revisions and an epoch that changes when the store is replaced.

Commands carry a UUID, epoch, and a discriminated operation. Project mutations carry `expectedVersion`; edits to different projects can proceed independently, while a stale edit to the same project is rejected. Selection uses daemon arrival order and does not increment project versions. Neither does showing a newly started terminal or agent in its pane: each new pane starts its session by itself a moment after it appears, and counting that as an edit made the user's next command fail as stale. This first local milestone has one shared selection; per-user selection awaits authenticated machine identities. Never trust a client-supplied user ID as authorization.

The daemon records the state and command receipt in one SQLite transaction. Identical retries return the original result with the current snapshot; reusing an ID for a different operation is rejected. A timeout/disconnect can mean an unknown outcome, so a retry must reuse the exact command and ID. Receipts currently remain for the database lifetime. Future retention must introduce an explicit retry horizon before pruning them.

The CLI saves `workspace.sqlite` beneath `CONCORS_DATA_DIR`, defaulting to `~/.concors`. Embedded servers use an in-memory store unless passed `workspacePath`. Machine identity and epoch live in that store. Incompatible database versions or malformed persisted state fail startup instead of silently resetting data. SQLite uses the Node 24 built-in module; no third-party native database binding is added.

Limits: 64 projects, 32 tabs per project, 32 panes per tab, and 512 KiB of workspace metadata. Slow subscribers over the send-buffer limit are disconnected and must refresh. Layout nodes form an explicitly validated binary tree. Closing a pane collapses its parent split; closing the final pane closes its tab. Selected-tab deletion picks a neighboring tab. Project removal only removes workspace metadata.

The Add project dialog opens an existing directory, creates a new folder, or clones a repository through durable machine-side setup jobs. Terminal launch validates an existing absolute directory and atomically binds the new session to its pane. See [terminal sessions](terminal-sessions.md) for runtime behavior. Structured agent status and server discovery arrive in subsequent PRs.

Browser WebSockets are limited to the existing local Vite and Tauri origins. Native/CLI callers can omit Origin. This is not authentication: use loopback or an independently protected connection only. Do not expose this daemon to an untrusted network until machine access grants are implemented with Pierre's server. Remote connection support in the transport is not a claim that cloud access is ready.

Validation covers two actual WebSocket clients, stale edits, duplicate retries, reconnects, persisted receipts after restart, transaction rollback, malformed trees, and pane/tab selection repair.

## Desktop workspace UI

Run `pnpm daemon:dev` and `pnpm desktop:web:dev`, then open `http://localhost:1420` in two browser windows. Add a project, create tabs, split panes, change profiles, rename tabs, drag them to reorder (or use Alt+Shift+Arrow keys), and drag split boundaries (or use arrow keys on a focused separator). The other window receives each saved change. Reload either window to verify restoration. Disconnecting from the daemon leaves the last snapshot visible and disables edits until a fresh snapshot arrives. Internet loss does not disable the loopback daemon.

The machine switcher supports this computer and saved connection bookmarks. Bookmarks are device-local until cloud inventory is integrated; each connected daemon owns its independent projects and layout. Cloud provisioning, Agents, and Servers are explicitly marked as future milestones. Adding a project supports existing folders, new folders, and Git clones; see [project setup](project-setup.md). Shell, Codex, Claude Code and OpenCode profiles can launch real terminal sessions. Unified chat remains a placeholder.

Automated browser acceptance test:

```bash
pnpm exec playwright install chromium
pnpm test:workspace:e2e
```

The test starts two temporary daemons on ports 7429/7430, builds the web app and serves it with `vite preview` on 1420; stop any existing Vite instance first. It uses independent browser contexts to verify layout/profile/navigation sync, keyboard resizing, reload, actual WebSocket disconnection/reconnection, and isolation when switching machines. Temporary SQLite files live under the system temp directory. Traces are retained on failure in ignored `test-results/`.

## Rearranging panes

Drag a pane header within its tab; a tab with one pane has nothing to drag. As in split editors:

- A narrow band along the outside of the workspace moves the pane beside all the others, in a new
  half-width or half-height split (`scope: "workspace"`).
- A band along another pane's edge, a quarter of its size, splits that pane and puts the dragged
  pane on that side of it (`scope: "pane"`).
- Another pane's centre swaps the two (`placement: "center"`).

One outline shows the target: half of the hovered pane, the whole of it for a swap, or half of the
tab. It never covers another pane, except for the outer band. After an edge drop a `pane.resize`
puts the new divider on the hovered pane's midline, the outline's inner edge, so the pane lands on
the outline. Panes are rectangles that fill the tab, though, so the space the pane left must go to
someone: when it lies beyond the outline or across the split, the dragged or hovered pane also
covers it. Over the dragged pane itself there is no target. Escape, or letting go outside the
workspace or over the pane itself, cancels.

A tab nobody named is called after its oldest pane, so rearranging panes never renames it.

Dragging a chat's row in the sidebar onto another workspace, or choosing **Move to workspace** in its
menu, moves it there (`chat-move`): an open chat with its tab through `tab.transfer`, a closed one
through the agent operation `move`. The chat keeps running in its own folder, because a CLI ties a
conversation to the folder it began in. Only chat tabs move: a terminal's session belongs to its
workspace. A chat with a schedule stays, because a schedule belongs to its chat's workspace.

`pane.move` commits the tree change atomically using the project version captured at drag start.
Pane IDs, profiles, and session bindings stay unchanged; no terminal or agent is stopped or
restarted. Layouts sync across clients and survive reload. Clients only enable dragging when
the daemon advertises `workspace-pane-rearrangement`. Dropping a pane on another tab in the tab bar,
or choosing **Move to tab** in its menu, sends `pane.transfer` (`pane-transfer`): the pane joins that
tab on the right, keeps its session, and a tab it leaves empty closes. Touch dragging is not
implemented. The drag uses pointer events rather than HTML drag and drop, which ignores CSS cursors.

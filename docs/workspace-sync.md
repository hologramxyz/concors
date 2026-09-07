# Workspace synchronization, first milestone

The daemon owns workspace metadata. `workspace.subscribe` after the normal handshake returns a complete `workspace.snapshot`; every committed command broadcasts the next snapshot to subscribers. Reconnect always refreshes from a full snapshot. Incremental event replay is deferred until state size justifies it; clients already consume monotonically increasing revisions and an epoch that changes when the store is replaced.

Commands carry a UUID, epoch, and a discriminated operation. Project mutations carry `expectedVersion`; edits to different projects can proceed independently, while a stale edit to the same project is rejected. Selection uses daemon arrival order and does not increment project versions. This first local milestone has one shared selection; per-user selection awaits authenticated machine identities. Never trust a client-supplied user ID as authorization.

The daemon records the state and command receipt in one SQLite transaction. Identical retries return the original result with the current snapshot; reusing an ID for a different operation is rejected. A timeout/disconnect can mean an unknown outcome, so a retry must reuse the exact command and ID. Receipts currently remain for the database lifetime. Future retention must introduce an explicit retry horizon before pruning them.

The CLI saves `workspace.sqlite` beneath `CONCORS_DATA_DIR`, defaulting to `~/.concors`. Embedded servers use an in-memory store unless passed `workspacePath`. Machine identity and epoch live in that store. Incompatible database versions or malformed persisted state fail startup instead of silently resetting data. SQLite uses the Node 24 built-in module; no third-party native database binding is added.

Limits: 64 projects, 32 tabs per project, 32 panes per tab, and 512 KiB of workspace metadata. Slow subscribers over the send-buffer limit are disconnected and must refresh. Layout nodes form an explicitly validated binary tree. Closing a pane collapses its parent split; closing the final pane closes its tab. Selected-tab deletion picks a neighboring tab. Project removal only removes workspace metadata.

This milestone registers project directory metadata; it does not create/clone folders, start processes, or bind live sessions. Pane profiles are saved choices, not evidence that a CLI has launched. Session bindings are reserved nullable IDs; future runtime commands must validate their ownership before binding. Agent status, terminal streams, and server discovery arrive in subsequent PRs.

Browser WebSockets are limited to the existing local Vite and Tauri origins. Native/CLI callers can omit Origin. This is not authentication: use loopback or an independently protected connection only. Do not expose this daemon to an untrusted network until machine access grants are implemented with Pierre's server. Remote connection support in the transport is not a claim that cloud access is ready.

Validation covers two actual WebSocket clients, stale edits, duplicate retries, reconnects, persisted receipts after restart, transaction rollback, malformed trees, and pane/tab selection repair.

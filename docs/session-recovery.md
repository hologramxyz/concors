# Session continuity across daemon restarts

## Findings

Projects, tab order, split layouts, selection, and pane session bindings already live in the machine's SQLite workspace. They survive a daemon restart. Terminal PTYs, their process trees, emulator screens, scrollback, input ownership, and output sequence counters currently live inside `TerminalRuntime` in the daemon process. `TerminalManager.close()` disposes those runtimes and kills their PTYs; startup marks saved running sessions interrupted. Reopening a shell would preserve neither the running command nor its in-memory state.

Agent chat is different: `AgentManager` stores provider thread IDs and conversation history and calls `thread/resume` when reconnecting a saved conversation. This restores a conversation, not guaranteed execution of an interrupted turn. Pending approvals and an in-flight tool call cannot be reconstructed by replaying a prompt safely.

The reference Paseo checkout separates terminal work into a worker, but `packages/server/src/terminal/terminal-worker-process.ts` calls `manager.killAll()` on parent IPC disconnect. Copying that worker lifecycle alone would not provide restart continuity. Herdr's terminal activity manifests are useful for detecting CLI activity, but activity detection is separate from keeping processes alive.

## Recommended implementation

Run a durable machine session host independently of the replaceable API daemon. The host owns PTYs, their emulator/scrollback state, process identity, terminal activity detection, and session lifecycle. The daemon remains the authenticated gateway for clients and the owner of workspace layout. Restarting the gateway disconnects viewers; it must not send stop commands to the host.

Use a local socket with restrictive permissions on Linux/macOS and a named pipe restricted to the current user on Windows. Authenticate the gateway to the host and version the protocol. Never expose this local control endpoint directly to browsers. Package the host with the app; do not require a user-installed terminal multiplexer. On Windows, validate that neither a parent job object nor GUI exit terminates the host or its ConPTY children.

Keep a stable terminal session ID across gateway restarts. The host must own its own lifecycle journal; do not let two processes write terminal lifecycle records independently in the workspace database. Launch requests need durable idempotency keys. Reconcile a launch acknowledged by the host but not yet bound into a workspace pane without launching a duplicate process. Explicit session close stops the PTY; daemon shutdown only detaches.

After reconnect, the daemon lists host sessions and reconciles saved pane bindings. Clients request an authoritative serialized screen and sequence watermark, then resume newer output. Clear old viewer ownership and reacquire it using the existing claim rules. Do not replay unacknowledged keystrokes or terminal commands: their previous execution may already have happened. Keep output bounded while no clients are attached; session hosts must continue draining PTYs.

Extend host ownership to structured agent-provider processes if in-flight Agent chat turns must also survive gateway restart. Conversation resume remains the fallback after an actual provider or host failure. Preserve provider session identity, pending approval identity, and operation receipts; never automatically resubmit a user turn or approve a tool request.

## Delivery sequence

1. Extract and test a versioned session-host transport and runtime interface. Keep the existing terminal behavior behind the interface first.
2. Move PTY ownership to the independent host, with protected local discovery, single-instance locking, lifecycle journaling, and idempotent launch/stop operations.
3. Implement gateway reconciliation and automatic client reattachment with the same pane/session IDs, terminal screen, working directory, and live process tree.
4. Add bounded disk screen checkpoints for host/OS crashes. Clearly distinguish restored screen history from a recovered live process. A machine reboot loses arbitrary process memory; offer a fresh shell or an explicit provider-session resume, not automatic command replay.
5. Move Agent chat provider ownership to the host and test in-flight turn/approval continuity separately.

Existing PTYs cannot simply be adopted by the new host. Roll out with a one-time migration boundary: leave old sessions attached to the old runtime until they exit or the user explicitly restarts them. New sessions can use the host immediately. Keep the API daemon's restart action separate from a deliberate stop-all-sessions/host-upgrade action.

## Acceptance checks

- Start a long-running process that writes a counter, record its PID and pane binding, restart the gateway gracefully and with SIGKILL, and assert the same process continues without duplicated output or command execution.
- Preserve shell working directory, exported variables, jobs, terminal modes, alternate-screen applications, dimensions, screen contents, and bounded scrollback.
- Reconnect two devices during continuous output; neither loses the snapshot boundary nor steals input ownership. Repeat gateway restarts and race launch/bind/stop against disconnects.
- Verify a terminal-launched Codex remains working in the sidebar across reconnect and returns to idle/needs-input using live activity signals.
- Crash the host and simulate a machine reboot: show honest recovery state, retain layouts/history, and never replay commands or prompts.
- Exercise process lifetime and endpoint permissions on Linux, macOS, and Windows. Test provider continuity and unresolved approvals independently of terminal continuity.

This document proposes the recovery work. The accompanying activity-detection change does not yet introduce a persistent host or resume terminal processes after daemon restart.

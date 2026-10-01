# Session continuity

## What survives a restart

`concors-daemon serve` now runs a connection gateway. It discovers or starts a detached machine session host in `CONCORS_DATA_DIR`. The host owns the existing runtime: the workspace database, PTYs and their process trees, headless terminal emulators, agent providers, project setup, and pending approvals. It is the only writer of the machine's runtime database.

Stopping or killing the gateway closes client connections, not sessions. On restart, the gateway reconnects to that same host. Clients reattach using the same pane and terminal IDs and receive a screen snapshot followed by newer output. Shell environment, working directory, foreground commands, Codex/Claude processes, and in-flight Agent chat turns remain alive. Terminal history is bounded to the host's 500-line scrollback, with the existing 1 MiB snapshot limit. A connected client retains its last screen during reconnect and preserves its scroll offset where possible.

No keystrokes, commands, prompts, or approval decisions are replayed by the gateway. Pending Agent chat approvals keep their identity in the host. Terminal input ownership is released on disconnect and reclaimed under the existing ownership rules.

## If the host itself is lost

A gateway restart is different from terminating the session host or rebooting the machine. Arbitrary process memory cannot be recovered in those cases. Saved projects, tabs, splits, and pane bindings remain in SQLite. When an interrupted pane is opened, the updated client automatically requests recovery:

- A shell reopens in the project directory. Previous shell variables, jobs, and arbitrary commands are not replayed.
- Codex opens `codex resume`; Claude opens `claude --resume`. These are the providers' native conversation pickers. The user selects the correct saved conversation; Concors does not guess using the last conversation from a shared directory.
- A shell that was detected running one of those agents also opens that provider's picker. Unknown processes recover to a shell; OpenCode opens its normal UI.
- Explicitly ended/stopped sessions stay ended. They are not automatically relaunched.

Recovery uses the expected old session binding and workspace epoch, serializes launches in the host, and accepts a recovery another client already completed. Concurrent recovery cannot create two processes for the same pane. Failures such as a missing executable offer a compact retry action; the old “Session interrupted / Start new session” banner is not used for recoverable sessions.

Agent chat conversation IDs/history remain persisted. Loss of the host interrupts an in-flight turn; provider conversation resume can restore history but does not silently resubmit that turn or approve a tool request.

## Local operation and upgrades

Start the gateway normally:

```sh
concors-daemon serve
```

Restart that process whenever needed. Its session host stays alive, unless the daemon itself
changed: a gateway replaces a host started by a different build, so an updated daemon never keeps
serving through the previous build's host. The build is recorded in the host descriptor and is a
fingerprint of the daemon program, not its version, because a rebuild usually carries the same
version — exactly when stale code would otherwise go unnoticed. A replacement ends that host's
terminals and agent sessions, like upgrading a machine's daemon; saved projects, tabs and history
are untouched. That is why rolling out a daemon version to cloud machines only makes it
available: each machine updates when no agent on it is working or waiting, or when its owner
presses **Update now** in the app ([managed machines](managed-machines-v1.md), 4.4). The same works for a gateway started by the desktop wrapper. No tmux installation is required. The same CLI entry point launches the host in source, bundled-JavaScript, and planned single-executable distributions.

To deliberately stop the runtime for maintenance, stop the gateway first, then run this command with the same `CONCORS_DATA_DIR`:

```sh
concors-daemon stop-host
```

This ends live processes. Starting the gateway afterward boots a fresh host and clients use the recovery path above. Runtime code loaded by an existing host is retained until host maintenance; restarting just the gateway does not reload that runtime. `serve --ephemeral` retains the old single-process lifecycle for isolated tests or temporary machines, and should use a separate data directory.

The initial upgrade cannot adopt PTYs owned by a pre-host daemon. Leave that old daemon running until a migration restart is acceptable. On the first migration restart, saved panes recover automatically; subsequent gateway restarts preserve their processes. Never run an old/ephemeral daemon and a persistent host against the same data directory simultaneously. The gateway reserves its public listening port before starting a host, so accidentally starting it over an existing daemon at that port cannot open a second runtime database.

The host listens on a random loopback port protected by a random bearer credential. Discovery/ownership files live in a private directory with private file modes; credentials are not command-line arguments and are not exposed to clients. An exclusive runtime owner prevents simultaneous gateways from creating multiple hosts. Authenticated health checks distinguish a usable host from a stale endpoint; an unresponsive live owner is never replaced blindly.

## Service managers

For a VPS service, run the host and gateway in **separate service units**. A service manager that kills an entire process group/cgroup on gateway restart can otherwise kill its detached descendants too. For example, adapt these units to the installed executable and service user:

```ini
# concors-session-host.service
[Unit]
Description=Concors persistent machine sessions

[Service]
User=concors
StateDirectory=concors
Environment=CONCORS_DATA_DIR=/var/lib/concors
ExecStart=/usr/local/bin/concors-daemon session-host
ExecStartPost=/usr/local/bin/concors-daemon wait-host
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```ini
# concors-gateway.service
[Unit]
Description=Concors connection gateway
Wants=concors-session-host.service
After=concors-session-host.service

[Service]
User=concors
Environment=CONCORS_DATA_DIR=/var/lib/concors
ExecStart=/usr/local/bin/concors-daemon serve
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Keep the host's lifecycle independent in other supervisors as well. Runtime upgrades or host-service restarts still have the host-loss semantics above. On macOS/Windows, the host is a detached process with redirected standard streams; native-platform CI exercises actual process lifetime. Packaged app/service-manager lifecycle should also be verified before release.

## Validation

Integration tests exercise a real PTY process through graceful gateway shutdown and SIGKILL, checking the same PID, environment, working directory, pane binding, screen, and continuing output. Other tests cover simultaneous gateways, the private endpoint, occupied public ports, stale host replacement, persistent Agent chat turns and approvals, and concurrent recovery requests. Browser coverage uses two clients with Codex and Claude test executables, verifies unchanged process IDs after restart, and checks native-picker recovery without the interruption screen after host failure.

The complete runtime stays outside the gateway, avoiding a second owner of SQLite or split launch receipts.

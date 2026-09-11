# Terminal sessions

Run `pnpm daemon:dev` and `pnpm desktop:web:dev`, then open http://localhost:1420.
Open an existing folder, create a folder, or clone a repository with **Add project**. Then create a tab, select a profile,
and the terminal starts automatically. Split panes and panes switched to a terminal profile also start automatically; ended sessions still require an explicit restart. Terminals focus automatically when available; click or focus a terminal to type when another device is viewing it.
Agent CLIs must already be installed and authenticated on the daemon machine; the client does not
install them or move credentials. This milestone provides their interactive terminals, not unified
chat or semantic agent status. Shell exit status is not an agent turn-completion signal.

The development daemon now requires a loopback bind. To view a VPS-hosted development instance
from your computer, forward both local ports with SSH:

```bash
ssh -N -L 1420:127.0.0.1:1420 -L 7420:127.0.0.1:7420 user@your-machine
```

Open http://localhost:1420 on your computer. Remote authentication and cloud routing will integrate
with Pierre's server separately; this PR does not modify that repository.

## Agent sidebar

The Agents sidebar contains chats bound to Agent panes and live Codex/Claude Code/OpenCode
terminal profiles bound to terminal panes. Closing a pane, tab, or project, or switching its
profile, removes detached sessions from the sidebar on every client without deleting history.
Exited, failed, and interrupted terminal sessions are omitted. Selecting an entry focuses its
owning project, tab, and pane; there is no separate Agents page.

A live terminal profile is labeled **Open in terminal** with a static status icon. Process
liveness does not indicate whether the model is generating, waiting for input, or idle. Only
structured chat events drive working/done/needs-input indicators. Commands launched manually
inside a shell are not currently discovered as separate sidebar agents.

## Lifetime, replay and control

- The daemon owns each PTY. Closing a pane, navigating away, or disconnecting a client leaves it
  running. **Stop** in the **Sessions** menu requests process termination and waits for the exit event.
- **Sessions** lists current and historical terminals, including sessions detached by removing a
  project/tab. Create an empty pane in the same project and choose **Attach an existing session**
  to restore a detached binding. A session can be bound to one pane, viewed by multiple devices.
- A launch receipt and pane binding are saved in one SQLite transaction before process creation.
  Retrying the same request ID and payload never creates another process. Stale pane versions and
  attempts to replace running sessions are rejected. Typed input is never replayed automatically.
- Attach sends a serialized xterm screen followed by sequenced output. A fresh snapshot recovers
  sequence gaps. The emulator includes terminal modes and up to 200 lines of replay scrollback;
  it is not a raw tail of escape sequences.
- Clicking or focusing the terminal claims input and terminal dimensions. An unowned terminal activates
  automatically without stealing from another device. Passive viewers retain the owner's
  dimensions and can scroll their viewport. Closing the controlling view releases ownership.
- Daemon restart preserves bindings and history, marks previously running sessions **interrupted**,
  and offers **Start new session**. It does not resume an old shell or preserve its screen buffer.

The runtime retains at most 16 running PTYs and 32 emulator instances. It keeps 500 emulator
scrollback lines and coalesces output over 5 ms. PTY output pauses when the emulator write queue
exceeds 256 KiB and resumes below 64 KiB. Slow WebSocket clients are disconnected by the transport's
send-buffer limit and can reattach. Terminal history currently has a 256-session limit, with no
history-pruning UI yet. Input frames and terminal dimensions are bounded by protocol schemas.
The SQLite store migrates from user_version 1 to 2 without resetting workspace state.

## Reuse and validation

Source provenance for adapted terminal primitives is recorded in
[third-party notices](../third-party/source-notices.md).

`pnpm daemon:test` exercises real PTYs and WebSockets: duplicate launch receipts, cross-device
output, ownership, reconnect replay, detach/rebind, stop, and restart interruption. Profile tests
cover missing executables and Windows shim resolution. CI runs daemon tests on Linux, macOS and
Windows. `pnpm test:workspace:e2e` checks rendered terminal interaction and reload across two Chromium
contexts. Packaging native PTY binaries into distributable daemon sidecars remains release work;
these checks validate development runtimes, not signed desktop/mobile packages.

`patches/node-pty@1.1.0.patch` restores executable permission on the macOS prebuilt spawn helper
during dependency installation. Keep this patch until upgrading to an upstream version that ships
the helper correctly; the macOS runtime test verifies that an actual shell can launch.

## Color support

PTYs advertise `TERM=xterm-256color`, `COLORTERM=truecolor`, and `CLICOLOR=1`.
Daemon-launcher overrides (`NO_COLOR`, `FORCE_COLOR`, `CLICOLOR`, `CLICOLOR_FORCE`)
are removed before setting interactive terminal defaults. This prevents the VPS launcher’s
`NO_COLOR=1` from silently disabling colors in Codex, Claude Code, and other TUI apps.
Users can still override colors inside their own shell or application settings.

The client has explicit light/dark ANSI palettes and preserves 256-color and RGB escape
sequences during streaming and snapshot replay. Resets are queued with snapshot data,
preventing overlapping attach responses from duplicating the displayed screen.
A daemon update and new terminal sessions are required for the environment fix;
the client palette updates existing sessions immediately.

## Saved terminal profiles

Open **Settings → Terminals** to add, edit, or delete profiles. Each profile has a name,
executable command, and arguments (one argument per line; spaces inside a line stay together).
Codex, Claude Code, and OpenCode are included initially. **Terminal** opens the machine's default
shell, while **Agent** opens agent chat; both remain separate from the editable profile list.

The plus-tab menu and pane actions use the same profile list and provider icons.
**Edit pane profiles** opens the list in Terminals settings, where profiles can be added or edited.
A profile executes on the selected machine, in the pane's folder. Commands resolve through that
machine's PATH or an executable path. Arguments are passed individually, without shell expansion;
use an explicit shell command if you need a shell script.

Profiles are saved in the machine's workspace database and synchronized with connected clients.
Concurrent edits report a conflict instead of overwriting another client's change. Each pane
keeps the profile definition selected when it was created or configured, so editing/deleting a
profile does not change existing sessions. Splitting a pane keeps that definition, including if
the profile has since been deleted. Select a profile again or open a new tab to use an edited
version. Older daemons keep their built-in launch menus; editing requires the `terminal-profiles`
capability.

Gateway restarts preserve running processes. After loss of the session host, recovery retains
the existing policy: detected Codex/Claude sessions open their native conversation picker, and
other custom commands recover to a shell instead of automatically replaying arbitrary commands.

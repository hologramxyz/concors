# Terminal sessions

Run `pnpm daemon:dev` and `pnpm desktop:web:dev`, then open http://localhost:1420.
Register an **existing absolute directory on the daemon machine**, create a tab, select a profile,
and click **Start terminal** (or **Start codex/claude/opencode**). Click **Take control** to type.
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

## Lifetime, replay and control

- The daemon owns each PTY. Closing a pane, navigating away, or disconnecting a client leaves it
  running. **Stop session** requests process termination and waits for the exit event.
- **Sessions** lists current and historical terminals, including sessions detached by removing a
  project/tab. Create an empty pane in the same project and choose **Attach an existing session**
  to restore a detached binding. A session can be bound to one pane, viewed by multiple devices.
- A launch receipt and pane binding are saved in one SQLite transaction before process creation.
  Retrying the same request ID and payload never creates another process. Stale pane versions and
  attempts to replace running sessions are rejected. Typed input is never replayed automatically.
- Attach sends a serialized xterm screen followed by sequenced output. A fresh snapshot recovers
  sequence gaps. The emulator includes terminal modes and up to 200 lines of replay scrollback;
  it is not a raw tail of escape sequences.
- **Take control** claims input and terminal dimensions. Passive viewers retain the owner's
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

Paseo commit `a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6` informed the PTY/headless-xterm architecture,
serialized attach snapshots and explicit resize claim/update contract. The output coalescer and
Windows npm CLI shim escaping are adapted from its terminal implementation; attribution is in the
source and the full Apache-2.0 license is preserved in `third-party/paseo-LICENSE`.

`pnpm daemon:test` exercises real PTYs and WebSockets: duplicate launch receipts, cross-device
output, ownership, reconnect replay, detach/rebind, stop, and restart interruption. Profile tests
cover missing executables and Windows shim resolution. CI runs daemon tests on Linux, macOS and
Windows. `pnpm test:workspace:e2e` checks rendered terminal interaction and reload across two Chromium
contexts. Packaging native PTY binaries into distributable daemon sidecars remains release work;
these checks validate development runtimes, not signed desktop/mobile packages.

`patches/node-pty@1.1.0.patch` restores executable permission on the macOS prebuilt spawn helper
during dependency installation. Keep this patch until upgrading to an upstream version that ships
the helper correctly; the macOS runtime test verifies that an actual shell can launch.

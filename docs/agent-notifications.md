# Agent notifications and unread attention

The daemon owns attention for unified-chat agents. Each completion or new request for input
gets a durable attention ID, kind, timestamp, and seen flag. Clients acknowledge that exact
ID when its conversation is visible in a focused window. Acknowledgements broadcast to every
connected client and survive restart. A late acknowledgement cannot clear newer attention.
Starting another turn clears old completion attention. Failure and interruption clear attention
and retain their existing status/error display; failure-specific alerts remain future work.

The additive `agent-attention` capability enables acknowledgements. Older persisted agents and
older daemons default to no attention. No SQLite migration is necessary: attention is stored
inside the existing agent JSON record.

## Delivery policy

- Settings enables sound and desktop notifications independently, per browser profile or app
  installation. Both default off. Browser permission is requested only after the user enables
  desktop notifications. Test buttons exercise both sounds and desktop delivery.
- Completion is silent while viewing that conversation. Requests for input use their distinct
  sound even in the focused conversation; neither produces a redundant desktop banner there.
- Background events wait briefly, then recheck authoritative attention and focus. Reading on
  another device or resumed work cancels queued alerts.
- Initial snapshots and reconnects restore unread badges without replaying alerts. Notifications
  represent live transitions while the client runs, not an offline inbox.
- Browser windows use Web Locks and bounded local-storage receipts to claim delivery once per
  attention ID for that machine/epoch/profile. Without Web Locks, concurrent-window deduplication
  is best effort; without storage, only the current connection can deduplicate. Different
  devices can each notify until shared attention is acknowledged.
- Clicking a browser/native notification or in-app card opens the agent's global conversation.
  Switching machines or resuming work invalidates old click targets. Dismissing a card closes
  its browser notification but does not mark the conversation read.

Browser notifications use the browser's permission API and silent delivery; Web Audio supplies
the selected sound. Audio needs a user gesture after loading; Settings test buttons unlock it.
OS permissions, focus modes, and browser background throttling can affect delivery.

Tauri uses a small Rust bridge around `notify-rust` for Linux/macOS/Windows delivery and click
callbacks while the app runs. The standard Tauri notification plugin does not expose desktop
click actions. Native callbacks bring the existing window forward, then navigate through the
same validated attention ID. Native callback workers are bounded. OS notification-center entries
may remain after attention is cleared; their callbacks are invalidated, and the OS controls
expiry/dismissal. Windows packaged app identity and macOS notification behavior require installed
app testing. This does not implement launching a closed app from a notification.

## Source attribution

The completion/input policy follows [Herdr](https://github.com/herdrdev/herdr), revision
`b99002ac99b09e00b4ca692436cb15a6b0d676f1`, particularly `src/app/actions.rs` and
`src/sound.rs`. Unmodified `assets/sounds/done.mp3` and `request.mp3` are included under
`apps/desktop/src/notifications/sounds/`. These assets are Apache-2.0 licensed; the upstream
license is preserved in [third-party/herdr-LICENSE](../third-party/herdr-LICENSE).
The shared daemon acknowledgement protocol and React/native integration are Concors code.

Terminal activity detection also adapts Herdr's `src/detect/manifests/claude.toml`
(manifest `2026.09.04.1`) and `src/detect/manifest.rs` screen regions at the same revision.
The TypeScript adaptation excludes prompt input, detects live spinner/background-task and
permission controls, recognizes idle prompt boxes, and preserves state in transcript view.
It reads the emulator's live viewport, independently of client scroll position, and broadcasts
state changes to all clients. Herdr's Claude hook at this revision reports session identity,
not a complete activity lifecycle; output volume and process existence are not working signals.
PTY tests cover manually launched Codex and Claude, two-client transitions and reconnects;
browser tests verify both sidebars and removal when the agent returns to the shell.

## Verification and remaining platform work

Policy tests cover baseline suppression, duplicate events, focused input, remote reads, resumed
work, disconnect cancellation, delivery-lock races, and preferences. Two-client daemon tests
cover acknowledgement synchronization, stale acknowledgements, and restart persistence.
Browser acceptance tests use real daemon sessions with the deterministic agent provider and
a fake OS Notification API to verify delivery counts, click navigation, shared unread state,
reload suppression, and stale-notification closure. Existing chat and terminal acceptance
tests continue to run. CI compiles/lints the Tauri code on Linux, macOS, and Windows.

Before packaged desktop release, smoke-test actual sound, permission denial, click-through,
focus behavior, and notification-center expiry on all three OSes. Mobile background push,
device-token registration, APNs/FCM delivery, and cold-start deep links remain in the mobile
milestone; this client change does not modify the cloud server.

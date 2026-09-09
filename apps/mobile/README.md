# Concors mobile

Expo SDK 57 / React Native hosts the **actual Concors desktop React workspace** in a
bundled, offline WebView. The phone shell is chat-first: bottom composer, swipeable
push sidebar, top tab/pane picker, and modal settings. There is no bottom navigation
and no second implementation of chat/tool rendering.

**Status: implemented client and interactive preview, not store-submission ready.**
Production connectivity, push and deletion require the [server contracts](../../docs/mobile-backend.md).
Signed builds and physical device checks require team-owned accounts/devices.
See the [parity matrix](../../docs/mobile-parity.md) and [release runbook](../../docs/mobile-release.md).

## Try it now — no daemon or account needed

From the repository root, with Node 24 and pnpm 11.1.1:

```bash
pnpm install --frozen-lockfile
pnpm mobile:demo
```

Open the printed URL (normally <http://localhost:8081>) in a phone browser or browser
phone-size mode. Select **Explore demo**; it opens straight into the agent chat.

1. The bottom composer starts as a compact single line. Tap the text field to smoothly expand it and open
   the keyboard; tap outside or dismiss the keyboard to collapse without losing your draft.
   Enter inserts a newline; the send button submits.
   Allow the pending request, then send a message to see streaming.
2. While the approval is pending or an agent is working, send a follow-up to queue it.
   Attach a small file; switch to Terminal · Pane 2 with the top picker and back.
   Drafts, attachments and queued messages survive pane/tab navigation.
3. Swipe right on the conversation to open Projects / Agents / Servers.
   The workspace moves right. Swipe left, press Close sidebar, or tap the workspace
   to return. Code blocks/terminal controls retain their own gestures.
4. Tap your **name/avatar** at the bottom of the sidebar for the animated Account drawer,
   then **Settings** (or **Sign out**). The settings
   picker contains account, appearance, notifications, SSH, billing, machines and diagnostics.
   Search and the machine selector open animated bottom drawers without dismissing the sidebar.
   The machine drawer shows each machine's current status and selection.
5. Use the floating glass **…** at the top for **New tab** or **Add pane to this tab**,
   then choose Agent, Terminal, Codex, Claude Code or OpenCode.
   That same menu offers rename, pane profile and confirmed close (no left/right reordering).
   The sidebar button, picker and actions button are separate translucent, backdrop-blurred controls.
   The picker opens a bottom drawer with tab headings, pane counts and indented panes.
   Choose a pane to switch views, or dismiss with Close, Escape or the backdrop.
   Tapping the covered trigger hits the backdrop and closes the drawer without reopening it.
   Desktop-only split/arrange/resize actions are intentionally absent on phones.
6. Add a project from the sidebar's animated drawer (open/create/clone). Expand tool calls, diffs,
   plans, thinking and sub-agent updates. Try `ask me a question` for an input request.
   Model, effort and permissions use icon-only desktop controls when expanded.
   Context usage and dictation sit on the right beside the primary button; the sliders button contains only
   Plan and Speed. Dictation focuses the native keyboard and explains how to use its microphone.
   There is one primary button: Stop while working with an empty draft, Queue for a follow-up,
   or Send when idle.
7. Select **Terminal · Pane 2** for the shared xterm terminal: type, use extra keys,
   reload the renderer or explicitly stop the process after confirmation.

### Tabs versus panes

A project contains tabs; each tab contains one or more panes. A pane is a chat or
terminal view. The initial demo has one tab, **Mobile launch**, with an **Agent**
pane and a **Terminal** pane—not two tabs.

- **New tab** creates a separate group with its first pane.
- **Add pane to this tab** keeps a new session alongside the current work, inside that tab.
- Select any indented pane under any tab to open it. Mobile shows one at a time;
  desktop can show that same tab's panes side by side.
- Navigation changes only this device's selected view. Adding, renaming, changing a
  profile or closing updates the shared workspace on connected devices.
- Adding a pane uses the existing shared split operation (beside the selected pane
  on desktop); mobile does not expose split directions. Closing the last pane also closes its tab.
- A pane profile changes the kind of view; it is not a way to create another pane.
  Closing a pane removes its saved view, not a promise to terminate its remote process.
  Use the agent/terminal's explicit stop control to stop work.

Everything in the demo is simulated, including commands, repository setup, SSH,
billing and machines. New demo machines remain in simulated provisioning; use the
original machine for workspace tests. Refresh resets the fixture and signs out;
browser credentials are memory-only. The demo cannot verify a live gateway or push.

## Run on a phone / simulator

Use development builds, **not Expo Go**, for the complete native integration.
Install [Xcode or Android Studio prerequisites](https://docs.expo.dev/guides/local-app-overview/).

```bash
# macOS + Xcode; add --device for an attached iPhone
EXPO_PUBLIC_DEMO=true pnpm --filter @concors/mobile ios
# Android Studio + emulator or USB-debugging device
EXPO_PUBLIC_DEMO=true pnpm --filter @concors/mobile android
```

On PowerShell set `$env:EXPO_PUBLIC_DEMO="true"` first. Restart Metro after changing
demo/real environment variables. EAS development/preview builds are also configured;
link the team's Expo project as described in the release runbook. Native push needs
physical devices, APNs/FCM credentials and the server integration.

Tapping the real textarea focuses the system keyboard. Mobile Enter inserts a newline;
Ctrl/Command+Enter sends. Dictation uses the phone keyboard's microphone, not browser
speech recognition. Attachment capture/selection may request iOS photo/camera/audio
permission only when explicitly chosen in the system file picker.

## Connect to the real service

Create `apps/mobile/.env.local` from `.env.example`. Set the real HTTPS
`EXPO_PUBLIC_API_URL`, disable `EXPO_PUBLIC_DEMO`, then run `pnpm mobile:dev`.
Native sign-up/sign-in, inventory and organization switching use the existing API.
Unavailable gateway/push/deletion capabilities are shown honestly; failures are retryable.

The latest upstream machine agent provides authenticated terminal sessions, not the
Concourse workspace/chat protocol. Its `/token` API is now supported in the shared API
client, but is deliberately **not wired to the workspace transport** until the authenticated
bridge is implemented. See [the current backend assessment](../../docs/mobile-backend.md).

With an existing session credential supplied privately through your local environment,
run the read-only prerequisite check from the repository root:

```bash
pnpm --filter @concors/mobile live:preflight
```

It requires `CONCORS_PREFLIGHT_API_URL` (HTTPS), `CONCORS_PREFLIGHT_MACHINE_ID` and
`CONCORS_PREFLIGHT_TOKEN`. Do not put the token in command arguments, source control,
`EXPO_PUBLIC_*` variables or chat. The command only reads the account, machines and
advertised capabilities. It does not provision anything, mint access tokens, create
sessions or verify a live chat. Missing workspace capability returns a nonzero exit
status with an explanation; a successful preflight only permits attempting the next test.

For private integration testing, `EXPO_PUBLIC_DEV_DAEMON_URL` accepts a clean WSS
gateway URL. It supplies **no authentication itself**: use an already protected private
network/gateway, never expose a bare daemon publicly. It requires a real signed-in
account/machine selection and bypasses cloud ticket/machine-ID checks. Production
ignores it. This is not a production access mechanism.

`EXPO_PUBLIC_*` values ship in the app: never put secrets in them. Native tokens use
device-only SecureStore. Transcripts, drafts, workspace and terminal buffers are
in-memory; the daemon remains authoritative. Reloading the renderer discards unsent
in-memory drafts. Switching panes does not.

## Source sharing and boundaries

- `apps/desktop/src/mobile/` is a responsive entry beside the desktop UI, not a fork.
  It imports the existing composer/timeline/tool/markdown/plan, project controls,
  xterm terminal, machines, settings and command palette.
- `apps/mobile/src/workspace/` owns the Expo host, lifecycle, OS clipboard and renderer.
- `packages/client-core` shares connection lifecycle, token persistence, notification
  validation and schema-validated protocol/account bridge contracts.
- The renderer has no credentials, connection tickets, generic fetch RPC, filesystem
  access, remote scripts or its own network socket. External HTTPS/email links require
  host confirmation. Navigation is otherwise denied.
- Phone project/tab/pane selection is local; explicit layout edits use authoritative,
  version-checked daemon operations. Navigation never sends a process stop.
- Servers matches the desktop placeholder until server discovery exists upstream.
  Unified chat uses the same daemon Codex adapter; other profiles are terminals.
- Billing/provisioning views are source-shared. **Store policy review is a release
  gate**, not an assumption that desktop checkout can ship unchanged in every store.

`pnpm assets` builds the shared offline workspace and generates icons from the desktop
SVG. Generated HTML and native `ios/`/`android/` projects are ignored. No mobile client
imports daemon or Tauri runtime implementations.

## Verification

```bash
pnpm mobile:test
pnpm --filter @concors/mobile typecheck
pnpm exec playwright install chromium
pnpm test:mobile:e2e
pnpm mobile:build
```

The browser suite covers chat, approvals, streaming, attachments, queue/draft retention,
model controls, touch swipes, keyboard-sized layouts, project/tab/pane edits, tools,
settings, terminal and cold links. `mobile:build` exports iOS/Android Hermes bundles and
web assets, **not signed IPA/AABs**. These checks do not replace the physical-device,
real-backend, accessibility and store-policy matrix in the release runbook.

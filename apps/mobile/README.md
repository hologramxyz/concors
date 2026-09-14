# Concors mobile

Expo SDK 57 / React Native hosts the **actual Concors desktop React workspace** in a
bundled, offline WebView. The phone shell is chat-first: bottom composer, swipeable
push sidebar, flat top Tabs picker, and modal settings. There is no bottom navigation
and no second implementation of chat/tool rendering.

**Status: implemented client and interactive preview, not store-submission ready.**
Direct desktop testing works without a cloud account or server change; see below.
Managed cloud connectivity uses desktop's machine/token contract; optional push and deletion
still require backend services. See the [server contract](../../docs/mobile-backend.md).
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
3. Swipe right on the conversation or terminal to open Projects / Agents / Servers.
   The workspace moves right. Swipe left, press Close sidebar, or tap the workspace
   to return. Vertical terminal scrolling and taps still work; code blocks and terminal
   toolbar controls retain their own gestures.
4. Tap your **name/avatar** at the bottom of the sidebar for the animated Account drawer,
   then **Settings** (or **Sign out**). The settings
   picker contains account, appearance, notifications, SSH, Shortcuts, Terminals, machines
   and diagnostics. Signup, purchasing and billing are intentionally excluded from mobile.
   Search and the machine selector open animated bottom drawers without dismissing the sidebar.
   The machine drawer shows each machine's current status and selection.
5. Open the top **Tabs** picker: one flat row per chat or terminal, including desktop split panes.
   **New tab** is at the bottom. Each row's **…** offers type/profile selection and confirmed close;
   rename is available when the row is the only pane in its desktop tab.
   New tab opens the creation drawer with Agent and the machine's saved terminal
   profiles. On a current daemon, Add/Manage terminal profiles opens Terminals settings.
   Within an agent chat, the model icon opens provider/model selection for Codex, Claude Code,
   OpenCode and Pi when installed on the machine. Changing provider starts a new chat;
   the original remains available in Tabs.
   The sidebar button, picker and **Files** button are separate backdrop-blurred controls.
   Choose a pane to switch views, or dismiss with Close, Escape or the backdrop.
   Tapping the covered trigger hits the backdrop and closes the drawer without reopening it.
   Desktop-only split/arrange/resize actions are intentionally absent on phones.

The in-memory demo has no filesystem; **Files** opens an explanation. Use a current desktop
daemon to test actual files, as described below. 6. Add a project from the sidebar's animated drawer (open/create/clone). Expand tool calls, diffs,
plans, thinking and sub-agent updates. Try `ask me a question` for an input request.
Model, effort and permissions use icon-only desktop controls when expanded.
Context usage and dictation sit on the right beside the primary button; the sliders button contains only
Plan and Speed. Dictation focuses the native keyboard and explains how to use its microphone.
There is one primary button: Stop while working with an empty draft, Queue for a follow-up,
or Send when idle. 7. Select **Mobile launch · 2** (Terminal) for the shared xterm terminal: type, use extra keys,
reload the renderer or explicitly stop the process after confirmation.

### Mobile tabs and desktop sync

Mobile calls each chat or terminal view a **tab**. The picker lists every pane in the
project at one level, in desktop tab order and split-tree order, with no group headings.
The initial demo shows **Mobile launch · 1** (Agent) and **Mobile launch · 2** (Terminal).
On desktop these are still two panes inside the original **Mobile launch** tab.

- **New tab** creates a new desktop tab with a single pane. There is no mobile Add pane mode.
- Select any row to open that one view. Next/Previous tab shortcuts cycle through the same flat list.
  Existing desktop splits, pane IDs and session IDs stay intact; navigation never rewrites the layout.
- Navigation changes only this device's selected view. Adding, renaming, changing a
  profile or closing updates the shared workspace on connected devices.
- **Close tab** closes only that row's pane, even if other panes share its desktop tab.
  Closing an inactive row keeps the current view selected. Closing the last pane removes its empty desktop tab.
- Split panes have no individual saved names: their labels use the desktop name and position.
  Rename is therefore offered only for single-pane desktop tabs, so siblings are never renamed inadvertently.
- **Tab type** changes the kind of view; it does not create another tab.
  Closing removes its saved view, not a promise to terminate its remote process.
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
speech recognition. Native iOS attachments use the system document picker; the app does
not request camera, photo-library or microphone access. Android also blocks camera,
recording and broad media/storage permissions.

## Connect to the real service

### First: connect to the same daemon as desktop

Set `EXPO_PUBLIC_DEV_DAEMON_URL` to a private WSS endpoint for the **existing desktop
daemon**, `EXPO_PUBLIC_DEMO=false`, and use a development/preview build. Restart Metro
with `--clear` after switching modes. The welcome screen offers **Connect to desktop**.
This is a real workspace connection, not a demo account or a simulated machine.

Connecting opens the workspace directly; there is no AI data-sharing onboarding page
or replacement prompt. Managed access still requires authentication, and direct access
still requires the private endpoint. Settings retains the ordinary privacy-policy link.
Disconnecting closes this viewer, not the remote sessions.

The host uses the same `DaemonConnection` protocol as desktop and obtains the actual
machine ID from its workspace snapshot. Cloud login is not needed for the workspace;
inventory, billing, provisioning and push API calls remain blocked in this mode.
The footer is a profile entry, not a machine status label. Tap **Your profile → Sign in**
to verify the same Concors account used on desktop; its actual name, email and avatar then
appear in the footer/drawer. This optional profile session is isolated in memory and
never grants cloud machine access or changes the desktop connection. Passwords and
session tokens stay in the outer host, not the embedded workspace renderer. Reloading
the private browser preview requires signing in again; normal native account login
continues to use the existing SecureStore flow.

Use **Your profile → Settings → Disconnect desktop** to leave. This detaches
the phone, not the daemon's agents or terminals. Reconnects retain in-memory drafts;
explicit disconnect or page reload discards unsent input. Cold session links must match
the connected daemon. The direct option is disabled in production builds.

For a browser/phone preview, `scripts/direct-gateway.mjs` is a small loopback-only
development adapter. It validates one Tailscale identity and the exact preview origin,
then forwards only `/ws` and `/health` to a fixed loopback daemon port. It adapts the
approved origin without changing the daemon's production origin allowlist; it does not
forward cookies, account authorization or Tailscale identity headers to the daemon.
For optional profile login, set `CONCORS_DIRECT_PROFILE_API_URL` on the adapter to the
same exact HTTPS account API origin used by desktop. This is disabled by default.
The private `/desktop-daemon/profile-api` route only forwards email sign-in, sign-out,
`/api/v1/me`, and read-only `/api/v1/github/` identity for the desktop avatar, with exact
methods, bounded bodies, no redirects and no cookie forwarding. GitHub repositories,
account management and connection changes are not exposed by this profile-only route.
The same Tailscale identity/origin check protects these routes. It does not substitute
a Tailscale profile or copy a desktop session token.

Example on the computer running the daemon (replace the origin and login):

```bash
CONCORS_DIRECT_DAEMON_PORT=7420 \
CONCORS_DIRECT_GATEWAY_PORT=7444 \
CONCORS_DIRECT_GATEWAY_ORIGIN=https://your-device.your-tailnet.ts.net:8444 \
CONCORS_DIRECT_GATEWAY_USER=you@example.com \
node apps/mobile/scripts/direct-gateway.mjs
```

In another terminal, add **only** the daemon path to your private preview:

```bash
tailscale serve --bg --https=8444 --set-path=/desktop-daemon http://127.0.0.1:7444
```

Keep port 8444 private, never Funnel. Do not reset or replace unrelated Serve routes.
The adapter trusts [Serve's identity headers](https://tailscale.com/docs/features/tailscale-serve#identity-headers),
so it must remain loopback-only behind Serve. Other local processes are part of that
trust boundary. Tagged devices without a user identity are denied. Private-network
access is not a substitute for managed cloud authorization or production pairing.

Then run the mobile host with its protected socket URL:

```bash
APP_VARIANT=preview EXPO_PUBLIC_DEMO=false \
EXPO_PUBLIC_DEV_DAEMON_URL=wss://your-device.your-tailnet.ts.net:8444/desktop-daemon/ws \
pnpm mobile:web --clear
```

The origin serving the mobile host must match the adapter's configured origin. For a
standalone Tailscale preview, export the web bundle with the same configuration and
serve those files at that origin. For an installed development build use `mobile:dev`
with the same environment. Plain WS is allowed **only for loopback in development**
for the isolated browser test; preview builds require WSS.

### Test the latest desktop sync

Use a current daemon with `provider-settings`, `agent-native-controls`, `agent-queue`,
`agent-providers`, and `terminal-profiles` capabilities;
the in-memory demo cannot prove real provider switching or saved profile launch.

1. Open Settings → Providers. Search the catalog, install a supported CLI on the
   connected machine, and sign into it using a regular terminal. Installed and
   authenticated are separate states. Create a new Agent pane and choose a provider.
   In an agent chat, tap the composer and its model icon. Go back to providers, choose
   an installed Claude Code, OpenCode or Pi provider, then a model. The new chat should
   open automatically; use Tabs to return to the original conversation.
   Current daemons with `agent-accounts` also offer dismissible Codex, Claude and
   OpenCode sign-in in the chat. Other providers still use their own CLI setup.
2. In Tabs, choose New tab → Add terminal profile. Save a harmless command
   (for example, `pwd` on a Unix machine), close settings, and launch that profile
   from New tab. The same saved profile should appear on desktop.
3. In Settings → Shortcuts, inspect external-keyboard commands. Mobile should not
   expose desktop-only split/arrangement commands.
4. Connecting and switching organizations should open the workspace without an
   AI data-sharing prompt. Native iOS model controls use the same provider marks as desktop.
5. Run `/compact` when the selected CLI exposes it. Check its running/result state.
   Queue a follow-up, disconnect the phone, and verify delivery from desktop. Stop
   pauses queued work; use Resume queue before expecting further delivery.
6. Agent chats use the desktop timeline and composer. There must be no legacy connected
   toolbar or Import session, Fork session, Rewind or MCP servers buttons above the chat.
7. Open the sidebar: it has glass Search, with no logo or extra menu
   button. The workspace slides above it with a visible 32px rounded glass-style rim; hidden
   sidebar controls must never show through the main view. Tap your name/avatar to open Account, not Settings. The drawer starts
   with the machine selector, followed by Add machine, Settings and Sign out.
   Direct previews offer **Your profile → Sign in** until you authenticate your real
   Concors account, with **Disconnect desktop** kept separate from profile sign-out. Add machine
   explains setup and refreshes existing cloud machines; it does not provision or
   purchase one. Closing nested machine sheets restores focus to the account drawer.
   CPU/RAM sits just below the sidebar machine selector, using the selected daemon's
   live readings. It takes no space in chat and unsubscribes when the sidebar closes.
   Older daemons show **Update daemon for usage**; stale/offline readings are not
   presented as current. See [measurement limits](../../docs/host-resource-usage.md).

The full [provider support report](../../docs/unified-chat-provider-support.md)
covers six built-in agents, 38 opt-in ACP presets, credential/MCP settings, native
capability limits, and live versus fixture evidence. Restricted webviews retain
unsent drafts in scoped memory; hard app-restart durability is not guaranteed.

For store-identity TestFlight/Play internal builds, follow the
[candidate runbook](../../docs/mobile-release.md#production-identity-candidates-then-submission).
Those require team project/signing setup and explicit upload approval, not the demo.

### Browse and edit the project's real files

The connected daemon must include desktop [PR #36](https://github.com/concors-dev/concors/pull/36)
and advertise `project-files` (plus `project-file-create` for creation). Updating the phone
alone cannot enable files on an older running daemon. No control-plane/server PR is needed.
Upgrade/restart that daemon when it is safe for your sessions, or test with a separate current daemon.

1. Open a project, then tap the top-right **Files** button. Swipe left on chat or the terminal
   to open Files; swipe right on directory rows, preview links or the header to return without
   activating the touched control. In a code editor, swipe right from the leftmost 28px;
   the rest of the editor keeps text selection and scrolling. **Back to chat** also returns.
   Swipe right from chat or the terminal opens the project sidebar. Inputs, file tabs, popup menus and
   terminal toolbar controls keep their own gestures; vertical terminal gestures never navigate.
   The Files button and navigation also work on older/offline daemons, with an explanation of
   what is missing. They do not invent a filesystem or bypass the daemon's capabilities.
2. Browse the project's registered root directory. Expand folders, filter loaded filenames,
   toggle hidden files, refresh, or create a file/folder with the tree's toolbar.
   The Files header keeps the same glass back button and project pill in the directory and editor.
   Tap that project pill to return to the directory without losing an open file's draft; there is
   no separate redundant folder icon in this header.
3. Tap a Markdown file for its rendered preview and **Edit source** to change it. Other supported
   text files open in the shared desktop CodeMirror editor. **File options** contains Find in file,
   wrap, Vim, copy and reload. **Save** writes to the daemon machine, not the phone.
4. Use the open-file strip to switch documents; the project pill returns to the directory tree.
   Chat/file drafts survive navigation and connection replacement. Another client's edit triggers
   conflict review instead of silently replacing its work. Dirty file close/disconnect asks in-app.
5. Open **Tabs** from chat to manage sessions in one flat list.
   Mobile displays one selected view; desktop may show the same panes side by side.
   File documents are separate client-local editor tabs, not new daemon panes or processes.

Unsaved file drafts are memory-only: save before reloading or closing the app. Browser navigation
has an unsaved-change guard where supported; mobile OS force-quit cannot be intercepted. The same
desktop limits apply (UTF-8 text up to 1 MiB, no symlinks/binary previews, no rename/delete).
See [file behavior and safety boundaries](../../docs/project-files.md).

### Glass rendering: web styling versus native iOS

The iOS workspace now uses [Expo UI SwiftUI buttons](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/button/)
with `buttonStyle('glass')` for the workspace menu button, sidebar Search, Tabs,
Files, Back and directory controls.
The agent composer uses a real React Native `TextInput` above an
[Expo GlassEffect `GlassView`](https://docs.expo.dev/versions/latest/sdk/glass-effect/) background.
These views sit **above** WKWebView, with chat scrolling behind the composer; they are not CSS
effects or native blur painted over HTML text. The shared renderer reserves layout, hides its
duplicate controls from touch/VoiceOver, and retains draft, attachment, queue, configuration and
delivery logic. Native controls relay bounded, scope/connection-checked UI events to that logic.
Open web drawers suppress the native layer so their focus traps and backdrops remain usable.

The rounded workspace boundary is a decorative **CSS backdrop-blurred rim**, including inside
WKWebView, not another native Liquid Glass control. It reveals a 3px translucent edge while
sliding above the sidebar, without resizing the terminal or blurring chat content. It fades away
when closed, never intercepts touches, and has opaque/reduced-motion accessibility fallbacks.

The iOS-specific imports do not enter Android or Safari bundles. Android/web retain their shared
controls and web styling. Older iOS or Reduce Transparency uses native bordered controls and an
opaque composer. Both native glass availability checks run before mounting glass; accessibility
changes are observed while running. Reduce Motion disables composer expansion animation.
The model/effort/permission buttons open native action sheets. Dictation remains the iOS keyboard's
microphone: the app never secretly starts recording. Attachments use the native document picker,
retain the three-file/1 MiB limits, and remove their temporary cached copies after reading.

EAS profiles pin the SDK 57/Xcode 26.6 image (see [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/)).
Rebuild the native app after installing these packages; a Safari reload or JS-only update cannot
add their native modules. To test on a Mac with Xcode 26+ and an iOS 26+ simulator:

```bash
pnpm install --frozen-lockfile
APP_VARIANT=preview EXPO_PUBLIC_DEMO=true EXPO_PUBLIC_DEV_DAEMON_URL= pnpm --filter @concors/mobile ios --configuration Release
maestro test apps/mobile/e2e/native/glass.yaml
```

For a real iPhone, use the existing EAS development/preview profile or add `--device` to the local
iOS build, using the private daemon configuration above instead of demo mode when testing real
sessions. No signing credentials are committed. Native iOS and Android workflows are manual-only
(`workflow_dispatch`); they do not run on pull requests. Native compilation and simulator startup
exceed the PR time budget, and their latest UI runs have not passed. Run them explicitly when
native validation is needed. Android manual runs build the optimized arm64/x86_64 release APK
and AAB and audit SDK, permissions, and 16 KB alignment. iOS exercises native headers, composer,
settings, Files, and draft persistence in an iOS 26 simulator.

Automatic PR jobs have a seven-minute timeout. Mobile browser, direct-daemon, and managed-host
acceptance run as separate jobs so they do not accumulate into one long serial check.
All CI apps
use the preview identity and demo data; they are not store submission artifacts.

### Managed cloud connections

Create `apps/mobile/.env.local` from `.env.example`. Set the real HTTPS
`EXPO_PUBLIC_API_URL`, disable `EXPO_PUBLIC_DEMO`, then run `pnpm mobile:dev`.
Native sign-in, inventory and organization switching use the existing API.
V1 is an existing-account companion: signup, purchasing, subscription management and
billing links are absent, and commerce RPCs are blocked in the native host.
Optional push/deletion capabilities are separate from managed machine access.

The mobile host now connects using `/machines/:id/token` and the managed daemon's
`/ws` endpoint with the `concors.bearer.<token>` subprotocol. Cloud machine IDs and
daemon workspace IDs are separate namespaces. Machine tokens are saved in device-only SecureStore before the socket opens and cleared
on disconnect; the renderer never receives them. Host profiles and availability are shared
with desktop through `@concors/client-core`. A 401/4401 re-mints once, then reports
“Access revoked”; foreground events cannot bypass that limit.

Machine access does not require the optional `/mobile/capabilities` endpoint.
The published daemon v0.2.0 predates the mobile branch’s active-socket expiry fix;
verify its rollout separately when checking the revocation deadline. See [the backend contract](../../docs/mobile-backend.md).

With an existing session credential supplied privately through your local environment,
run the read-only prerequisite check from the repository root:

```bash
pnpm --filter @concors/mobile live:preflight
```

It requires `CONCORS_PREFLIGHT_API_URL` (HTTPS), `CONCORS_PREFLIGHT_MACHINE_ID` and
`CONCORS_PREFLIGHT_TOKEN`. Do not put the token in command arguments, source control,
`EXPO_PUBLIC_*` variables or chat. The command only reads the account, machines and
advertised capabilities. It does not provision anything, mint access tokens, create
sessions or verify a live chat. Unavailable managed machine metadata returns a nonzero exit
status with an explanation; a successful preflight only permits attempting the next test.

`EXPO_PUBLIC_DEV_DAEMON_URL` supplies **no authentication itself**. The private tunnel
must enforce access; do not expose a bare daemon. Leave it unset for cloud sign-in.
Unlike cloud connections, direct mode derives the machine ID from the daemon instead
of claiming a cloud inventory machine ID identifies a desktop workspace.

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

### Path-hosted private web previews

For a preview under a shared HTTPS origin, set `CONCORS_MOBILE_WEB_BASE_PATH=/concors-mobile`
when running `expo export --platform web --clear`. This prefixes the app's assets and router
links; it is opt-in and rejected for production builds. Set `EXPO_PUBLIC_DEV_DAEMON_URL`
to the matching secure socket path on that origin, for example
`wss://private.example/concors-mobile/desktop-daemon/ws`, rather than an older preview port.
Mount the export and its SPA routes below the same path. Use a separate loopback gateway
with the exact new origin and the same allowed Tailscale identity; never enable Funnel or
relax identity/origin checks to work around a browser connection failure. Profile sign-in
automatically stays below the socket's gateway prefix. Preserve unrelated routes and the
existing daemon/session host when changing preview hosting.

## Verification

```bash
pnpm mobile:test
pnpm --filter @concors/mobile typecheck
pnpm exec playwright install chromium
pnpm test:mobile:e2e
pnpm test:mobile:direct
pnpm mobile:build
```

If another checkout owns the direct-suite ports, use a separate pair (the production
daemon origin allowlist is unchanged):

```bash
CONCORS_MOBILE_DIRECT_PORT=7458 CONCORS_MOBILE_WEB_PORT=8098 pnpm test:mobile:direct
```

The browser suite covers chat, approvals, streaming, attachments, queue/draft retention,
model controls, touch swipes, keyboard-sized layouts, project/tab/pane edits, tools,
settings, terminal and cold links. `mobile:build` exports iOS/Android Hermes bundles and
web assets, **not signed IPA/AABs**. These checks do not replace the physical-device,
real-backend, accessibility and store-policy matrix in the release runbook.

The separate direct suite uses an isolated real daemon and PTY with a deterministic
coding-provider fixture (not the mobile demo server). A second desktop protocol client
verifies shared edits/session IDs, chat/approvals, terminal input, draft-preserving
reconnects, disconnect without stopping work, cold links and zero cloud API requests.
It does not claim a real provider account or physical device was tested.
The direct suite also exercises real directory reads, Markdown links, file/folder creation,
explicit saves, competing disk edits, in-app discard guards, draft-preserving reconnects,
file-view and terminal swipes, session/input preservation after navigation and 320/390/430px editor
layouts. A compatibility test removes file capabilities and verifies the Files explanation sends no
unsupported file requests. File tests use disposable temporary projects; they never edit the user's
existing workspace.

### Managed companion acceptance

`pnpm test:mobile:managed` runs the mobile browser client and desktop UI against the
same real terminal, with mocked machine discovery/token responses. It uses desktop
port 15432, mobile port 8088 and isolated daemons on 7429/7430. This verifies the
client integration, not native SecureStore or the deployed control plane.

For live C2 acceptance, set `EXPO_PUBLIC_API_URL` to
`https://concors-server-dev.up.railway.app`, leave demo/direct overrides disabled,
and sign in on a phone and desktop with access to `test-vps-3`. Select that machine
(`m-cjs3xaa6hk.dev.concors.app`), open the same terminal pane on both devices, and
run `printf 'companion-%s\n' acceptance`. Confirm both viewers show the output.
Background/resume the phone and confirm it returns to the same terminal.

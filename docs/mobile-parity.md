# Mobile / desktop parity

The mobile client uses a bundled, offline rendering of the actual Concors React UI,
inside the Expo native host. Chat, composer business logic, markdown, tool calls, plans, terminal,
project setup/actions, and account/appearance/SSH/Shortcuts/Terminals views are source-shared.
iOS headers and the composer field/toolbar render natively above WKWebView using Expo UI and
Expo GlassEffect; a scoped UI bridge invokes the shared navigation and agent logic.
Android/web retain the shared DOM controls. The mobile entry lives beside the desktop UI;
desktop UI does not move into domain packages.

The host owns authentication, SecureStore, machine access, socket reconnect,
foreground lifecycle, push, and external-link policy. An explicitly validated bridge
relays protocol messages and allowlisted account actions; account credentials and
connection tickets never enter the renderer. All UI code/fonts/styles are packaged
with the app. The renderer cannot fetch a remote application or open its own socket.
New desktop account methods outside the mobile allowlist show an explicit unavailable
message inside settings rather than crashing the workspace. Mobile's first release is
an existing-account companion: signup, purchasing, provisioning and billing/checkout
are intentionally absent, with commerce calls rejected at the host boundary.

Direct desktop previews now use the same daemon as desktop without cloud login or a
simulated account. The actual machine ID comes from its snapshot. Direct mode blocks
cloud API actions and exposes device settings plus daemon-backed terminal profiles; Disconnect detaches
the client without stopping remote work. This mode is preview-only and requires a
restricted private endpoint. The simulated demo remains a separate, mutually exclusive mode.

Phone-specific behavior:

- No bottom navigation. The existing chat composer occupies the bottom of the workspace;
  tapping its text field opens the platform keyboard.
- A swipeable Projects / Agents / Servers sidebar pushes the workspace to the right.
  Swipe back, press the mobile menu icon, or tap the workspace scrim to close it.
- A compact name/avatar trigger opens an animated Account bottom drawer with the current machine,
  Add machine setup guidance, Settings and Sign out. Direct previews use the same drawer with an
  honest Desktop connection identity and Disconnect desktop. Existing-machine management remains
  in Settings; no purchasing or provisioning is exposed. The sidebar has no redundant product title.
- Tabs/panes, Machine, Search, Settings, Add Project and New Tab use the shared Radix dialog with animated
  bottom-sheet presentation, focus restoration and reduced-motion support.
  Opening Search or choosing a machine leaves the sidebar visible behind it.
- Separate glass controls contain the sidebar toggle, sidebar Search, picker and Files button (native SwiftUI
  glass on supported iOS builds; CSS backdrop blur in the web/Android renderer),
  with matching rounded pressed states and opaque fallbacks for reduced transparency.
  The picker uses a tab/pane breadcrumb and lightly indented
  pane options under named tab headings with counts, without hierarchy lines or guide text.
  Tab/pane and machine selection open bottom drawers with scrollable, touch-sized options.
  The backdrop, Close button and Escape dismiss them and restore focus. Tapping the
  covered trigger dismisses via the backdrop without reopening. The settings section
  picker remains a popover. Pane choices support arrow keys and Home/End; machine and settings
  choices also support typeahead. Row actions are separate buttons, not nested listbox controls.
  Navigation is device-local; explicit create/rename/profile/close edits update the shared workspace.
- The composer collapses to a single line with attachment and primary actions.
  Text-field focus animates the measured height to reveal model, effort and permission icons,
  context/dictation on the right beside the primary button,
  and a sliders control for Plan/Speed. iOS uses native action sheets for composer options;
  web/Android use popovers. Owned option controls preserve expansion.
  Keyboard dismissal or an outside click collapses it without losing the draft.
  Height/content animations respect reduced motion; collapsed action taps do not move their target.
  One centered primary action shows Stop while active with an empty draft, Queue with
  follow-up content, or Send when idle. Controls fit a single row down to 320px width.
- Desktop split/placement/arrangement/resize controls and commands are intentionally
  absent on phones. Existing desktop split panes remain accessible in the top picker.
- The tab/pane drawer has tab cards with per-tab menus (add pane, rename, close), per-pane
  menus (profile, close) and a New Tab footer. Creation uses the shared new-session drawer
  and locally packaged provider logos. Add Pane uses the shared split operation without
  exposing geometry. Each menu targets its own row, including unselected tabs/panes.
  Closing the last pane warns that its tab will also close; hardware close shortcuts remain.
- Files opens full-screen from the right, with a directory tree and separate open-file strip.
  Swipe left from chat or the terminal opens it, swipe right returns; the sidebar retains the
  opposite gesture. Horizontal terminal gestures are handled before xterm can consume them;
  vertical gestures and taps retain terminal behavior.
  Tree, CodeMirror, Markdown, file links, create, explicit save and conflict review are desktop code.
  Editors preserve their own gestures and do not automatically summon the keyboard on opening.
  The Files header shares the chat header's native/web glass surfaces, button dimensions,
  pressed states and accessibility fallback. Its project pill returns to the directory, replacing
  the separate folder icon. Swiping the header does not activate its buttons.
  Dirty-close/disconnect dialogs are in-app, since sandboxed web renderers cannot use browser modals.
  The host supplies a browser unload guard. Unsaved documents remain memory-only; force-quit/reload
  can discard them, so save first. File access requires the current daemon's file capabilities.
- Drafts, attachments, queues and uncertain-send retry IDs survive pane/tab navigation
  and foreground socket replacement. They remain memory-only and account scoped;
  a full renderer reload discards unsent input. Changing machines starts a new draft scope.
- External keyboards use the shared command palette/shortcuts. Pane focus follows
  the top picker's order. Soft Enter adds a newline; the send button submits.

## Source parity

| Area              | Shared implementation                                                                | Phone behavior                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Composer          | `agents/composer.tsx`, `draft.ts`, Paseo submit logic                                | Attachments, queue, retry, model/effort/permissions/plan/speed/context, interrupt; native keyboard dictation         |
| Agent providers   | Shared provider settings, model picker, daemon registry and native control bridge    | Six built-ins, 38 optional ACP presets, own-account configuration; switching/import/fork opens a separate local chat |
| Conversation      | `agents/chat.tsx`, `timeline-item.tsx`, `markdown.tsx`, `plan-progress.tsx`          | Same history, streaming, approvals/questions, thinking, tool/MCP/diff/sub-agent rendering and copy actions           |
| Projects          | `workspace/project-setup-dialog.tsx`, `project-actions.tsx`                          | Open/create/clone/remove; setup continues remotely                                                                   |
| Tabs/panes        | Protocol workspace reducer, `workspace/new-tab-menu.tsx`                             | Hierarchical picker; new-tab/add-pane drawer; rename/profile/confirmed close; no desktop geometry controls           |
| Project files     | `files/tree.tsx`, `file-tab.tsx`, `code-editor.tsx`, `document.ts`, file protocol    | Full-page tree/editor, Markdown, links, create, explicit save/conflicts; local file tabs and draft guards            |
| Terminal          | `terminal/terminal-pane.tsx`, `surface.tsx` and xterm                                | Same replay, input ownership, resize/recovery; extra key strip and confirmed stop                                    |
| Terminal profiles | `terminal/profiles-context.tsx`, `workspace/new-tab-menu.tsx`, shared settings       | Machine-synced profiles and literal command arguments; add/manage from the creation drawer or Terminals settings     |
| Settings          | `views/settings-view.tsx` and `settings/*`                                           | Drawer: account/orgs, theme/corners, SSH, Shortcuts, Terminals, native-safe diagnostics; no commerce                 |
| Notifications     | Shared attention engine, provider and sound settings                                 | Foreground notices; native opt-in push remains backend gated                                                         |
| Machines          | Shared `@concors/client-core` host discovery/availability and machine token contract | Existing-machine selection, status and refresh; account-scoped secure credentials; no provisioning                   |
| Servers           | Same empty state as desktop                                                          | No discovered servers until upstream discovery exists                                                                |

Paths above are relative to `apps/desktop/src/`. The earlier mobile-only chat and
terminal renderers were removed. Tauri-specific APIs are replaced by narrow native
adapters at build time; this does not bundle the desktop runtime on a phone.

Implementation/verification checklist (updated as each slice lands):

- [x] Bring current desktop baseline into PR #32 (including corner preferences).
- [x] Offline UI bundle, validated bridge and native host integration.
- [x] Sidebar gestures, local selection, top picker and settings drawer.
- [x] Reused desktop conversation/composer, project controls and terminal.
- [x] Rich interactive demo and parity-focused browser tests.
- [x] iOS/Android Hermes and web export, native project generation, Expo Doctor 21/21.
- [x] Desktop regression cases and refreshed private preview.
- [x] Native Expo UI glass headers and Expo GlassEffect agent input; unsigned iOS 26
      simulator Release build and native UI acceptance passed, with screenshots inspected.

The native glass implementation was exercised on iPhone 17 / iOS 26.5 with Xcode 26.6.
The test covers native input/expansion, option sheets, Files navigation, draft retention
and the tabs/panes drawer. Physical-device, older-iOS, Reduce Transparency and Android
accessibility checks remain release gates; fallbacks are implemented but not claimed
as physically verified.

Verification on 2026-09-09: 246 unit tests pass (one opt-in API integration test is
skipped), all 21 phone browser scenarios pass, and all 27 desktop browser scenarios
pass in a single isolated-port run.
The new direct acceptance scenario also passes against an isolated real daemon and
PTY with a deterministic coding-provider fixture: a desktop protocol client and the
phone share edits, agent/tool approvals and terminal IDs, preserve drafts on reconnect,
and disconnect without stopping work or calling a cloud API. This is not a claim of
real-provider or physical-device testing. Four adapter tests verify identity/origin
denials, restricted paths, WebSocket forwarding and configuration validation. A
read-only probe through the private WSS route returned the existing desktop daemon's
exact machine, project, tab and pane IDs; it did not mutate that workspace.
Initial local browser runs hit process crashes; both complete regression suites passed
on retry with browser temporary files moved from the crowded RAM-backed `/tmp` to disk.
CI exposed a notification-test setup race: a ready label from an older project did not
prove the separate control socket had received the newly created agent. The test now
awaits its own project/session; three consecutive isolated notification runs pass.
The phone suite covers 320/375/390/430px toolbars, contained picker chevrons, repeated
backdrop dismissal without reopening, hierarchical tab/pane creation and closing, collapsed/expanded composer
focus and keyboard dismissal, single centered send/stop actions,
drawer focus/animations/reduced motion, sidebar-preserving search and machine selection,
account menus and machine management.
The file integration also has isolated real-daemon acceptance scenarios for
directory browsing, Markdown links, file/folder creation, hidden files, refresh,
explicit saving, competing disk revisions, draft retention on reconnect, in-app
discard guards, the browser host unload guard and 320/390/430px editor layouts.
The tab drawer regression targets an unselected tab/pane and checks hardware close
shortcuts with the drawer unmounted. Files opens a capability explanation on older daemons and in
the in-memory demo, rather than presenting a simulated filesystem as live data. Terminal touch
regressions cover both panel directions, Files-button taps, vertical gesture isolation,
session preservation and working terminal input after navigation.
The appearance scenario additionally exercises theme
and corner preferences. A local-WebView test removes the browser UUID helper and
verifies new-tab requests still use secure, valid IDs. The earlier simulated static preview was opened at iPhone size for
chat/sidebar/settings/terminal screenshots with no page errors. Other Tailscale routes
were unchanged; mobile preview is tailnet-only, not Funnel.

To run desktop acceptance beside an existing checkout, use
`CONCORS_E2E_WEB_PORT=1447 pnpm test:workspace:e2e`. Alternate-origin handling is
confined to test fixtures; it does not relax the production daemon allowlist.

The 2026-09-10 sync includes main through `f6708c2`: agent providers
(#48), Shortcuts settings (#49), saved terminal profiles (#50), and the mobile managed
host/secure credential fixes from #47/#51, plus the latest Online/Connected machine labels.
The label helper is now shared by desktop, the mobile selector and mobile machine settings.
Historical test results above describe earlier
builds; they are not signed acceptance evidence for this integration.

Follow-up publishing work also fixes a mobile-only provider-switch regression: the
new provider's chat is explicitly selected locally after the daemon accepts the
request. Other devices' selection changes do not navigate this phone, and a late
response from an unmounted pane/old connection does not steal its selection. The
native composer now packages desktop's Claude/OpenCode marks and Pi symbol, with
the same provider-specific controls. Consent version 2 reconfirms the expanded disclosure.

Local verification for this follow-up (2026-09-10):

- `pnpm test`: 424 passed; one opt-in live API test skipped. The additional shared
  machine-label regression then passed with all 44 client-core tests (425 total cases).
- Mobile UI: 26 browser scenarios passed.
- Direct daemon: seven existing file/chat/terminal/profile scenarios passed; the two
  new provider scenarios exposed the navigation regression above, then both passed
  on a focused rerun after the fix. They exercise all three additional providers
  through the web composer and native surface bridge, preserving the original chat.
- Managed acceptance: one desktop/phone shared-terminal scenario passed even when
  optional capability discovery returns 404.
- iOS/Android Hermes and web bundle exports passed. Native compilation, signing,
  physical-device tests and real AI-provider accounts are **not** implied by these
  fixtures/exports. Native CI is currently blocked by GitHub account billing.

See the [release runbook](mobile-release.md) for candidate builds and the separate
submission evidence gate. No release gate was marked verified from browser testing.

Server installer PR #1 is merged. Desktop and mobile use the same managed daemon/token
contract, with no mobile-only workspace gateway or capability-discovery dependency.
Publish/deploy the current daemon artifact and verify real phone/desktop access before
claiming production parity. See [the current backend contract](mobile-backend.md).

Managed cloud workspace access, push service and deletion backend remain external release gates.
Store billing-policy review and physical iOS/Android keyboard, gestures, file picker,
clipboard and accessibility checks are required before claiming submission readiness.
The optional local WebKit check could not run because this host lacks WebKit's Linux
runtime libraries; Chromium device emulation is not a physical iPhone/Safari verification.

## Unified agent follow-up (PR #52 integrated into #53)

The shared daemon and client fixes include native compaction, cancellation,
provider-specific modes/efforts/commands, typed tools and questions, native history,
import/fork/rewind/steer where supported, MCP configuration/status, and a durable
daemon queue. Settings → Providers works from phone width and installs on the
connected machine. The mobile composer accepts complete bounded model catalogs
and configured-provider labels, with safe icon fallbacks.

Mobile-specific follow-up preserves this branch's consent/release work and local
navigation. Importing and forking now select the accepted new chat; late responses
from an old pane or connection do not steal the current selection.

Final integrated verification: 455 repository tests passed, one opt-in API test
skipped; workspace type checks, lint, and formatting passed. All nine direct mobile
browser scenarios passed across the main run and focused provider rerun, including
web/native bridge provider switching, return to the original conversation, fork
navigation, and saving provider settings without horizontal overflow. These
fixtures do not establish physical iOS/Android or authenticated ACP coverage.
GitHub native checks remain blocked before startup by billing/spending limits.

See the [support report](unified-chat-provider-support.md) for the native capability
matrix, live CLI evidence, and remaining scope boundaries. No store build/upload
or production daemon restart was performed by this follow-up.

## Sidebar and main merge follow-up (2026-09-11)

Main through `007d27d` is merged, including provider account sign-in (#54), saved
machine selection (#55), and empty Codex thread recovery (#56). Conflict resolution
retains expanded provider catalogs, private configuration, queued/session actions,
and mobile-local navigation. Account sign-in now shares the daemon's provider registry
and selects custom profile adapters by engine; unsupported engines do not get account RPCs.

The sidebar menu and Search now use the same glass surfaces as the chat header:
Expo UI SwiftUI buttons on supported native iOS, backdrop blur on web/Android,
and the existing accessibility fallbacks. Both signed-in and direct-desktop footers
open Account first. It contains the current machine, Add machine setup guidance,
Settings, and Sign out/Disconnect. Direct preview deliberately shows Desktop connection
instead of inventing a cloud identity. Add machine does not provision or purchase
infrastructure; signed-in users can refresh and connect existing machines.

Nested machine-sheet dismissal returns focus to Account; closing setup returns to
the footer. Browser/native-bridge tests cover hiding native surfaces behind drawers,
restoring them afterward, and keeping Search above the open sidebar.

Verification: 476 repository unit tests passed, one opt-in live API test skipped;
six focused mobile UI/native-bridge scenarios passed. Eight direct-daemon scenarios
passed in the full run; the file-conflict scenario then passed in isolation after fixing
its test race with background conflict detection (Save was correctly disabled).
Direct coverage includes the account drawer, simulated provider sign-in, files, terminal
profiles, and web/native-bridge provider navigation. Desktop/daemon/mobile typechecks
and scoped lint passed. Browser bridge tests do not render SwiftUI or replace signed
physical-device acceptance. Release evidence gates remain unchanged.

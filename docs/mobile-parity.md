# Mobile / desktop parity

For the current surface-by-surface audit and stale-preview finding, see
[September mobile parity audit](mobile-parity-audit.md). Dated sections below retain
historical implementation notes; the current onboarding has no AI-sharing gate.

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
- A swipeable Workspaces / Agents / Servers sidebar pushes the workspace to the right.
  Swipe back, press the mobile menu icon, or tap the workspace scrim to close it.
- A compact name/avatar trigger opens an animated Account bottom drawer with the current machine,
  organization chooser, Add machine setup guidance, Manage machines, Settings and Sign out.
  GitHub profile photos use the shared lightweight identity cache; opening the account drawer
  does not fetch repository lists. Direct previews show the verified display profile (or Your profile),
  with Disconnect desktop and no cloud organization controls. Machine management remains in
  Settings; no purchasing or provisioning is exposed. The sidebar has no redundant product title.
- Workspace rows, repository icons and actions are shared with desktop; mobile keeps 44px touch
  targets and does not show desktop hover tooltips. Machine selectors display saved emoji and
  availability. Settings reuses desktop rename controls and the icon editor, presented as drawers;
  successful edits update the host-owned machine list immediately, including both selectors.
- The account drawer and Account settings share an Organization bottom drawer, including personal
  versus team membership and role. Failed switches preserve the current connection. Successful
  switches replace the renderer/session scope and use organization-specific machine requests,
  caches and saved selection. Unsaved files are checked first. No additional AI-sharing
  onboarding prompt is shown. This does not add team creation, invitations or membership management;
  those are not desktop features on the synced main revision either.
- Tabs, Machine, Organization, Search, Settings, Open workspace and New Tab use the shared Radix dialog with animated
  bottom-sheet presentation, focus restoration and reduced-motion support.
  Opening Search or choosing a machine leaves the sidebar visible behind it.
- [Search](search.md) is a shared machine-scoped workspace/agent/tab finder, with exact pane
  destinations, name/path context and secondary commands. It does not search message/file contents.
- Separate glass controls contain the sidebar toggle, sidebar Search, picker and Files button (native SwiftUI
  glass on supported iOS builds; CSS backdrop blur in the web/Android renderer),
  with matching rounded pressed states and opaque fallbacks for reduced transparency.
  The Tabs picker shows a flat list of every pane in the project, with a name and profile per row.
  There are no desktop tab headings, counts or indentation. Split leaves use the shared tab name
  plus display position; the original IDs, split geometry and sessions are preserved.
  Tab and machine selection open bottom drawers with scrollable, touch-sized options.
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
- The flat Tabs drawer has one menu per row (type/profile, close, and rename for single-pane
  desktop tabs) and a New Tab footer. Creation uses the shared new-session drawer and provider
  logos, always creating a new single-pane desktop tab. Close always sends `pane.close`, never
  `tab.close`, so siblings survive. Closing an inactive row preserves the current selection;
  the last pane's confirmation explains that its empty desktop tab is removed too.
  No local-only names or schema migrations are introduced. Desktop split siblings cannot be
  renamed independently, so mobile does not offer a misleading rename action for those rows.
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
- External keyboards use the shared command palette/shortcuts. Next/Previous tab follows
  the flat picker's order across desktop tab boundaries. Legacy pane-focus/close shortcuts
  remain aliases, not extra menu/settings entries. Soft Enter adds a newline; the send button submits.

## Source parity

The flat Tabs follow-up is covered by `apps/mobile/e2e-direct/flat-tabs.spec.ts` using an
isolated real daemon and two protocol clients (deterministic coding-provider fixture).
It checks nested splits across desktop tabs, flat keyboard order, unchanged saved layout
and desktop selection on navigation, live desktop rename/split/close updates, mobile
single-pane tab creation, row-specific profile changes, leaf-only close and draft/session
retention. Browser/native-bridge tests cover repeated dismissal, per-row menus and the
updated native Tabs label. These are not physical-device or real-provider release checks.

| Area              | Shared implementation                                                                | Phone behavior                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Composer          | `agents/composer.tsx`, `draft.ts`, shared submit logic                               | Attachments, queue, retry, model/effort/permissions/plan/speed/context, interrupt; native keyboard dictation         |
| Agent providers   | Shared provider settings, model picker, daemon registry and native control bridge    | Six built-ins, 38 optional ACP presets, own-account configuration; switching/import/fork opens a separate local chat |
| Conversation      | `agents/chat.tsx`, `timeline-item.tsx`, `markdown.tsx`, `plan-progress.tsx`          | Same history, streaming, approvals/questions, thinking, tool/MCP/diff/sub-agent rendering and copy actions           |
| Projects          | `workspace/project-setup-dialog.tsx`, `project-actions.tsx`                          | Open/create/clone/remove; setup continues remotely                                                                   |
| Tabs/panes        | Protocol workspace reducer, `workspace/new-tab-menu.tsx`                             | Flat pane list labeled Tabs; new single-pane tab; safe rename/profile/leaf-only close; no layout migration           |
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
backdrop dismissal without reopening, flat tab creation and leaf-only closing, collapsed/expanded composer
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

This separate follow-up starts from main through `8f494ee`, after #53 (including
#52) merged. It retains main's provider account sign-in (#54), saved machine
selection (#55), empty Codex thread recovery (#56), and unified chat primitives.
The daemon, protocol and shared agent implementations match main; this PR adds no
separate mobile provider backend.

Sidebar Search uses the same glass surface as the chat header:
Expo UI SwiftUI buttons on supported native iOS, backdrop blur on web/Android,
and the existing accessibility fallbacks. Both signed-in and direct-desktop footers
open Account first. It contains the current machine, Add machine setup guidance,
Settings, and Sign out/Disconnect. Add machine does not provision or purchase
infrastructure; signed-in users can refresh and connect existing machines.

Nested machine-sheet dismissal returns focus to Account; closing setup returns to
the footer. Browser/native-bridge tests cover hiding native surfaces behind drawers,
restoring them afterward, and keeping Search above the open sidebar.

Post-merge verification: 483 repository unit tests passed, one opt-in live API test
skipped; all six focused mobile UI/native-bridge scenarios passed. Desktop/daemon/mobile
typechecks, scoped lint and formatting passed.
Both direct-daemon follow-up scenarios also passed on this final merge: shared
chat/terminal/account/reconnect flow and file drafts/saves/conflict protection.

Before the final main merge, eight direct-daemon scenarios passed in the full run;
the file-conflict scenario then passed in isolation after fixing its test race with
background conflict detection (Save was correctly disabled). That coverage includes
the account drawer, simulated provider sign-in, files, terminal profiles, and
web/native-bridge provider navigation. Browser bridge tests do not render SwiftUI or
replace signed physical-device acceptance. Release evidence gates remain unchanged.

### Profile and sidebar corrections

Merged desktop CPU/RAM telemetry is shared with mobile: the compact resource row
is below the sidebar's machine selector, leaving the profile footer and conversation
untouched. The sidebar alone owns its subscription; closing it stops updates, and
changing machines never retains the previous machine's readings. It uses the same
10-second stale cutoff, unavailable/offline states and high-usage warnings as desktop.

The sidebar has Search, without a logo or second menu button. Its controls
are contained in a lower stacking layer; the workspace clips its content and slides
above the sidebar with a 32px rounded edge, independent of control-corner preferences.
The edge has a 3px CSS backdrop-blurred rim, while the conversation remains opaque and
its layout dimensions stay unchanged. This decorative WebView boundary does not replace
the native Expo glass controls. Reduced transparency and motion retain accessible fallbacks.

Files permits rightward swipe-back from directory buttons and preview links, suppressing
the trailing click so navigation never also opens a file. Code editing retains its own
gestures except for a 28px left-edge navigation strip; headers remain drag handles too.
Input fields, horizontal file tabs and popup menus continue to own their gestures.
The file tree, Markdown preview and editor gutter declare vertical touch handling at
their scroll containers, so the browser does not cancel horizontal navigation before
pointer-up (see [touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action)).

The footer is now a real profile entry. Normal signed-in sessions show the Concourse
account as before. Direct previews offer **Your profile → Sign in**, using an optional,
private, profile-only route to the same account API as desktop. Only verified name/email
enter the renderer; passwords and tokens stay in the outer host's isolated memory session.
Profile sign-in/sign-out does not reconnect the workspace, discard drafts, or grant cloud
machine privileges. The proxy is disabled unless its HTTPS API origin is explicitly
configured; it accepts only sign-in, sign-out and `/me`, behind existing private identity
checks. It never copies desktop credentials or substitutes a Tailscale profile.

Initial profile-correction verification: 487 unit tests passed (one opt-in live API test skipped),
desktop/mobile typechecks and scoped lint passed; six sidebar/gesture/native-bridge
scenarios and two direct-daemon scenarios passed. The direct scenario verifies the
profile flow using a deterministic account fixture, no credentials in renderer messages,
no additional workspace socket, unchanged terminal identity and retained drafts.
This does not claim authentication with the user's credentials or physical iOS testing.

CPU/RAM, Files swipe-back and glass-edge follow-up: main through `fd79216` / #57 is
merged. 504 unit tests passed (one opt-in live API test skipped), along with ten
direct-daemon browser tests and six sidebar/glass/native-bridge scenarios. These cover
live machine sampling, subscription cleanup, stale/unavailable/older-daemon states,
file-row/Markdown/editor-edge gestures, draft/save/conflict safety, terminal profiles
and session preservation, unchanged workspace dimensions and accessibility fallbacks.
Desktop/mobile typechecks, scoped lint, formatting and diff checks passed. Physical
iPhone/native SwiftUI acceptance and release evidence gates remain separate.

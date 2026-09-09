# Mobile / desktop parity

The mobile client uses a bundled, offline rendering of the actual Concors React UI,
inside the Expo native host. Chat, composer, markdown, tool calls, plans, terminal,
project setup/actions, and account/appearance/SSH/billing views are source-shared,
not reimplemented approximations. The mobile entry lives beside the desktop UI;
desktop UI does not move into domain packages.

The host owns authentication, SecureStore, machine access, socket reconnect,
foreground lifecycle, push, and external-link policy. An explicitly validated bridge
relays protocol messages and allowlisted account actions; account credentials and
connection tickets never enter the renderer. All UI code/fonts/styles are packaged
with the app. The renderer cannot fetch a remote application or open its own socket.

Direct desktop previews now use the same daemon as desktop without cloud login or a
simulated account. The actual machine ID comes from its snapshot. Direct mode blocks
cloud API actions and only exposes appearance/connection settings; Disconnect detaches
the client without stopping remote work. This mode is preview-only and requires a
restricted private endpoint. The simulated demo remains a separate, mutually exclusive mode.

Phone-specific behavior:

- No bottom navigation. The existing chat composer occupies the bottom of the workspace;
  tapping its textarea opens the platform keyboard.
- A swipeable Projects / Agents / Servers sidebar pushes the workspace to the right.
  Swipe back, press the mobile menu icon, or tap the workspace scrim to close it.
- A compact name/avatar trigger opens an animated Account bottom drawer with Settings and Sign out.
  Machine management is a settings section; the sidebar header has no redundant product title.
- Tabs/panes, Machine, Search, Settings, Add Project and New Tab use the shared Radix dialog with animated
  bottom-sheet presentation, focus restoration and reduced-motion support.
  Opening Search or choosing a machine leaves the sidebar visible behind it.
- Separate backdrop-blurred glass controls contain the sidebar toggle, picker and Files button,
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
  and a sliders popover for Plan/Speed. Owned portaled controls preserve expansion.
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
  Swipe right from chat or the terminal opens it, swipe left returns; the sidebar retains the
  opposite gesture. Horizontal terminal gestures are handled before xterm can consume them;
  vertical gestures and taps retain terminal behavior.
  Tree, CodeMirror, Markdown, file links, create, explicit save and conflict review are desktop code.
  Editors preserve their own gestures and do not automatically summon the keyboard on opening.
  Dirty-close/disconnect dialogs are in-app, since sandboxed web renderers cannot use browser modals.
  The host supplies a browser unload guard. Unsaved documents remain memory-only; force-quit/reload
  can discard them, so save first. File access requires the current daemon's file capabilities.
- Drafts, attachments, queues and uncertain-send retry IDs survive pane/tab navigation
  and foreground socket replacement. They remain memory-only and account scoped;
  a full renderer reload discards unsent input. Changing machines starts a new draft scope.
- External keyboards use the shared command palette/shortcuts. Pane focus follows
  the top picker's order. Soft Enter adds a newline; the send button submits.

## Source parity

| Area          | Shared implementation                                                             | Phone behavior                                                                                               |
| ------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Composer      | `agents/composer.tsx`, `draft.ts`, Paseo submit logic                             | Attachments, queue, retry, model/effort/permissions/plan/speed/context, interrupt; native keyboard dictation |
| Conversation  | `agents/chat.tsx`, `timeline-item.tsx`, `markdown.tsx`, `plan-progress.tsx`       | Same history, streaming, approvals/questions, thinking, tool/MCP/diff/sub-agent rendering and copy actions   |
| Projects      | `workspace/project-setup-dialog.tsx`, `project-actions.tsx`                       | Open/create/clone/remove; setup continues remotely                                                           |
| Tabs/panes    | Protocol workspace reducer, `workspace/new-tab-menu.tsx`                          | Hierarchical picker; new-tab/add-pane drawer; rename/profile/confirmed close; no desktop geometry controls   |
| Project files | `files/tree.tsx`, `file-tab.tsx`, `code-editor.tsx`, `document.ts`, file protocol | Full-page tree/editor, Markdown, links, create, explicit save/conflicts; local file tabs and draft guards    |
| Terminal      | `terminal/terminal-pane.tsx`, `surface.tsx` and xterm                             | Same replay, input ownership, resize/recovery; extra key strip and confirmed stop                            |
| Settings      | `views/settings-view.tsx` and `settings/*`                                        | Drawer: account/orgs, theme/corners, SSH, billing, native-safe diagnostics                                   |
| Notifications | Shared attention engine, provider and sound settings                              | Foreground notices; native opt-in push remains backend gated                                                 |
| Machines      | `machines/machines-view.tsx`                                                      | Shared inventory/provisioning/lifecycle controls inside Settings                                             |
| Servers       | Same empty state as desktop                                                       | No discovered servers until upstream discovery exists                                                        |

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

The latest upstream machine agent adds TLS, machine JWTs and tmux sessions, but not
Concourse workspace/chat messages. The API client now preserves its install/certificate
metadata and validates `/token` responses. A read-only `live:preflight` command checks
account/machine/capability prerequisites; neither that command nor terminal-agent
installation proves a live workspace works. See [the protocol integration gap](mobile-backend.md).

Managed cloud workspace access, push service and deletion backend remain external release gates.
Store billing-policy review and physical iOS/Android keyboard, gestures, file picker,
clipboard and accessibility checks are required before claiming submission readiness.
The optional local WebKit check could not run because this host lacks WebKit's Linux
runtime libraries; Chromium device emulation is not a physical iPhone/Safari verification.

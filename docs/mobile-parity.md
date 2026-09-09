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

Phone-specific behavior:

- No bottom navigation. The existing chat composer occupies the bottom of the workspace;
  tapping its textarea opens the platform keyboard.
- A swipeable Projects / Agents / Servers sidebar pushes the workspace to the right.
  Swipe back, press the mobile menu icon, or tap the workspace scrim to close it.
- A compact name/avatar trigger opens an animated Account bottom drawer with Settings and Sign out.
  Machine management is a settings section; the sidebar header has no redundant product title.
- Search, Settings, Add Project and New Tab use the shared Radix dialog with animated
  bottom-sheet presentation, focus restoration and reduced-motion support.
  Opening Search leaves the sidebar visible behind it.
- Separate backdrop-blurred glass controls contain the sidebar toggle, picker and actions menu,
  with matching rounded pressed states and opaque fallbacks for reduced transparency.
  The picker uses a tab/pane breadcrumb and lightly indented
  pane options under named tab headings with counts, without hierarchy lines or guide text.
  Non-modal popovers toggle on a
  repeated trigger tap and support arrow keys, Home/End, typeahead and Escape.
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
- The top actions menu contains New Tab and Add Pane to This Tab, with no separate plus button.
  Both open the new-session drawer, which distinguishes their destinations and includes
  locally packaged provider logos. Add Pane uses the shared split operation without
  exposing desktop geometry. The actions menu omits tab left/right moves and warns that
  closing the last pane also closes its tab.
- Drafts, attachments, queues and uncertain-send retry IDs survive pane/tab navigation
  and foreground socket replacement. They remain memory-only and account scoped;
  a full renderer reload discards unsent input. Changing machines starts a new draft scope.
- External keyboards use the shared command palette/shortcuts. Pane focus follows
  the top picker's order. Soft Enter adds a newline; the send button submits.

## Source parity

| Area          | Shared implementation                                                       | Phone behavior                                                                                               |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Composer      | `agents/composer.tsx`, `draft.ts`, Paseo submit logic                       | Attachments, queue, retry, model/effort/permissions/plan/speed/context, interrupt; native keyboard dictation |
| Conversation  | `agents/chat.tsx`, `timeline-item.tsx`, `markdown.tsx`, `plan-progress.tsx` | Same history, streaming, approvals/questions, thinking, tool/MCP/diff/sub-agent rendering and copy actions   |
| Projects      | `workspace/project-setup-dialog.tsx`, `project-actions.tsx`                 | Open/create/clone/remove; setup continues remotely                                                           |
| Tabs/panes    | Protocol workspace reducer, `workspace/new-tab-menu.tsx`                    | Hierarchical picker; new-tab/add-pane drawer; rename/profile/confirmed close; no desktop geometry controls   |
| Terminal      | `terminal/terminal-pane.tsx`, `surface.tsx` and xterm                       | Same replay, input ownership, resize/recovery; extra key strip and confirmed stop                            |
| Settings      | `views/settings-view.tsx` and `settings/*`                                  | Drawer: account/orgs, theme/corners, SSH, billing, native-safe diagnostics                                   |
| Notifications | Shared attention engine, provider and sound settings                        | Foreground notices; native opt-in push remains backend gated                                                 |
| Machines      | `machines/machines-view.tsx`                                                | Shared inventory/provisioning/lifecycle controls inside Settings                                             |
| Servers       | Same empty state as desktop                                                 | No discovered servers until upstream discovery exists                                                        |

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

Verification on 2026-09-09: 218 unit tests pass (one opt-in API integration test is
skipped), all 19 phone browser scenarios pass, and all 19 desktop browser scenarios
pass in a single isolated-port run.
The phone suite covers 320/375/390/430px toolbars, contained picker chevrons, repeated
touch toggles, hierarchical tab/pane creation and closing, collapsed/expanded composer
focus and keyboard dismissal, single centered send/stop actions,
drawer focus/animations/reduced motion, sidebar-preserving search, account menus and machine management.
The appearance scenario additionally exercises theme
and corner preferences. A local-WebView test removes the browser UUID helper and
verifies new-tab requests still use secure, valid IDs. The private static preview was opened at iPhone size for
chat/sidebar/settings/terminal screenshots with no page errors. Other Tailscale routes
were unchanged; mobile preview is tailnet-only, not Funnel.

To run desktop acceptance beside an existing checkout, use
`CONCORS_E2E_WEB_PORT=1447 pnpm test:workspace:e2e`. Alternate-origin handling is
confined to test fixtures; it does not relax the production daemon allowlist.

Production gateway, push service and deletion backend remain external release gates.
Store billing-policy review and physical iOS/Android keyboard, gestures, file picker,
clipboard and accessibility checks are required before claiming submission readiness.
The optional local WebKit check could not run because this host lacks WebKit's Linux
runtime libraries; Chromium device emulation is not a physical iPhone/Safari verification.

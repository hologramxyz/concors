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
  Swipe back, press the sidebar icon, or tap the workspace scrim to close it.
- Settings is a modal drawer over the current workspace, preserving the conversation.
- A grouped tab-and-pane select above the active pane replaces a desktop split-grid.
  Navigation is device-local; explicit layout edits still update the shared workspace.
- Project, tab, and pane controls remain available as touch menus.

Implementation/verification checklist (updated as each slice lands):

- [x] Bring current desktop baseline into PR #32 (including corner preferences).
- [ ] Offline UI bundle, validated bridge and native host integration.
- [ ] Sidebar gestures, local selection, top picker and settings drawer.
- [ ] Reused desktop conversation/composer, project controls and terminal.
- [ ] Rich interactive demo and parity-focused browser tests.
- [ ] Native export checks, desktop regression checks and refreshed private preview.

Production gateway, push service and deletion backend remain external release gates.
Store billing-policy review and physical iOS/Android keyboard, gestures, file picker,
clipboard and accessibility checks are required before claiming submission readiness.

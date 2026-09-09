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
| Tabs/panes    | Protocol workspace reducer, `workspace/new-tab-menu.tsx`                    | Local grouped selector; explicit rename/reorder/split/profile/move/resize/confirmed close                    |
| Terminal      | `terminal/terminal-pane.tsx`, `surface.tsx` and xterm                       | Same replay, input ownership, resize/recovery; extra key strip and confirmed stop                            |
| Settings      | `views/settings-view.tsx` and `settings/*`                                  | Drawer: account/orgs, theme/corners, SSH, billing, native-safe diagnostics                                   |
| Notifications | Shared attention engine, provider and sound settings                        | Foreground notices; native opt-in push remains backend gated                                                 |
| Machines      | `machines/machines-view.tsx`                                                | Shared inventory/provisioning/lifecycle controls in a drawer                                                 |
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
- [ ] Final desktop regression run and refreshed private preview.

Production gateway, push service and deletion backend remain external release gates.
Store billing-policy review and physical iOS/Android keyboard, gestures, file picker,
clipboard and accessibility checks are required before claiming submission readiness.

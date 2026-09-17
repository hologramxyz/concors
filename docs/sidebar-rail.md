# Collapsed sidebar

The desktop sidebar collapses from 216 px to a 44 px navigation rail. Controls have
32 × 32 px square footprints and 6 px outer gutters; corner rounding continues to
follow the selected appearance. Settings keeps its dedicated, full-width sidebar,
and mobile keeps its existing swipe sidebar.

- The expanded machine switcher shares the section rows' icon and label insets.
  Its chevron sits beside the name; long names truncate before the chevron, leaving
  Search and Collapse accessible. The header aligns with the page title, and the
  open menu keeps its sidebar-sized width even when the trigger is short.
- Machine switching, expand/collapse, Search and Account remain accessible.
- Project and agent rows show tooltips on hover or keyboard focus in both layouts.
  Other controls (Search, machine switcher, expand/collapse, section menus and
  Account) show tooltips only in the collapsed rail.
  Tooltip surfaces, text and arrows follow the same light/dark and palette colors
  as menus instead of using an inverted, bright foreground-colored background.
- Workspaces use the same icon in both layouts: a local favicon for Git repos,
  otherwise a first-grapheme tile for a repo, or a folder for an ordinary directory.
  See [project icon discovery](project-icons.md) for supported locations and fallback behavior.
  Hover or keyboard focus reveals the full name and directory. The plus menu
  replaces the workspace section heading in the rail.
- Agents show their provider logo in both layouts, with a bottom-right status badge: spinner while
  working, green when done, amber for input, red for failure, or gray when ready.
  Tooltips include the agent name, provider, workspace, status and unread state.
  Agent pane headers also place the working spinner at the logo's bottom right;
  it is hidden while the agent is not running.
  There is no extra Agents header icon; when no agents are present the entire
  section is omitted. Empty workspaces show only the plus menu, with no placeholder.
- The middle list scrolls independently, leaving the machine switcher and Account
  accessible in short windows. Navigation and collapsing do not restart sessions
  or discard chat drafts.
- Previews confirmed by the daemon appear as square external-link controls in the
  rail. Tooltips identify each service and port without exposing access credentials;
  an empty Previews section is omitted while collapsed.

`e2e/sidebar-rail.spec.ts` covers dimensions, tooltips, keyboard navigation, machine
switching, settings round-trips, light/dark themes, reduced motion, narrow windows
and chat drafts. `e2e/terminal-agents.spec.ts` checks live terminal activity in both
the rail and expanded sidebar across clients.

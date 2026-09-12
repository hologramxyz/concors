# Collapsed sidebar

The desktop sidebar collapses from 216 px to a 44 px navigation rail. Controls have
32 × 32 px square footprints and 6 px outer gutters; corner rounding continues to
follow the selected appearance. Settings keeps its dedicated, full-width sidebar,
and mobile keeps its existing swipe sidebar.

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
- The empty Servers section is omitted from the rail, with no header icon or
  placeholder. The expanded sidebar keeps its existing empty state: main does not
  yet implement discovery or preview links. This change does not expose ports or
  invent statuses.

`e2e/sidebar-rail.spec.ts` covers dimensions, tooltips, keyboard navigation, machine
switching, settings round-trips, light/dark themes, reduced motion, narrow windows
and chat drafts. `e2e/terminal-agents.spec.ts` checks live terminal activity in both
the rail and expanded sidebar across clients.

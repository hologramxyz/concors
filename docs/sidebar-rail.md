# Collapsed sidebar

The desktop sidebar collapses from 216 px to a 44 px navigation rail. Controls have
32 × 32 px square footprints and 6 px outer gutters; corner rounding continues to
follow the selected appearance. Settings keeps its dedicated, full-width sidebar,
and mobile keeps its existing swipe sidebar.

- Machine switching, expand/collapse, Search and Account remain accessible.
- Workspaces show the first grapheme of their name. Hover or keyboard focus reveals
  the full name and directory. The plus menu replaces the workspace section heading
  in the rail; there is no redundant folder icon.
- Agents show their provider logo with the existing live status: spinner while
  working, green when done, amber for input, red for failure, or gray when ready.
  Tooltips include the agent name, provider, workspace, status and unread state.
- The middle list scrolls independently, leaving the machine switcher and Account
  accessible in short windows. Navigation and collapsing do not restart sessions
  or discard chat drafts.
- Servers remains the existing empty state: main does not yet implement server
  discovery or preview links. This change does not expose ports or invent statuses.

`e2e/sidebar-rail.spec.ts` covers dimensions, tooltips, keyboard navigation, machine
switching, settings round-trips, light/dark themes, reduced motion, narrow windows
and chat drafts. `e2e/terminal-agents.spec.ts` checks live terminal activity in both
the rail and expanded sidebar across clients.

# First-run tour

The first time the desktop app opens on a device, after sign-in and once the workspace has loaded,
the window dims behind a welcome card: **Take the tour** or **Skip**. Either answer is remembered
in `localStorage` (`concors.tour`), so it is offered once per device and never reported anywhere.
**Take the tour** in the account menu, or in Search as a command, replays it without the welcome.

Someone with no workspace yet gets the default one first, the same terminal in their home folder
that **New workspace** opens, so the tour can show tabs and New tab for real. If that fails or takes
longer than ten seconds, the tour runs without the two workspace steps and its last card offers to
add a folder instead.

Each step dims the window around one area of the app and glides to the next:

1. **Workspaces**: the sidebar section. Workspaces are folders on this computer.
2. **Tabs and panes**: the tab bar. Many tabs per workspace, many panes per tab.
3. **Start agents here**: opens the New tab menu, so Agent is seen beside Terminal, and says why
   to choose Agent.
4. **Schedules and pull requests**.
5. **Search**.
6. **This computer, or the cloud**: opens the machine menu. Agents run locally; a cloud machine is
   the optional extra, so it comes last.

A step that opens a menu shows its card only once the menu is open, and closes the menu when the
step ends. Copy is one or two short sentences and names controls as the app labels them.

Nothing behind the tour can be clicked; a stray click on the dimmed window does nothing, so only
**Skip tour** or Escape end it early. ← and → move between steps. Before each step the app expands
the sidebar and opens the workspace view, so the area is on screen. A step whose area still is not
shows its card centred instead of stalling.

Areas a step points at carry `data-tour="<id>"`; keep it on them when changing those components.
The steps, their order and where each card sits are plain data and a pure function in
`apps/desktop/src/tour/steps.ts`, tested beside it; `tour.tsx` is the overlay and `store.ts` the
stored outcome. `e2e/tour.spec.ts` walks the tour in the browser; every other spec starts with the
tour already skipped (`e2e/support/tour.ts`).

# Workspace shortcuts

Open the user menu at the bottom of the sidebar, choose **Settings**, then **Shortcuts**
under Personal. The dedicated page groups the reference into Workspace, Tabs, and Panes.
Searching for Shortcuts or pressing the default Ctrl+Shift+/ opens the same settings page.
Sidebar [Search](search.md) finds workspaces, agents and tabs on the selected machine, with
commands available as a secondary category. It searches names and paths, not message/file contents.
Use **Back to app** to return to your previous view.

Default shortcuts use physical Control on macOS as well as Linux/Windows. `→` between keys denotes a sequence:
press and release the first chord, then press the next key. A small action picker shows choices
and disabled actions; Escape, clicking outside, or leaving the window cancels. Holding a key
does not repeat a creation or close action; directional focus keys can repeat. An unrecognized
second key cancels the sequence without sending it to the underlying terminal or chat.

## Customize shortcuts

Choose **Edit** beside any app command to replace its bindings. Record a key combination or
choose **Type combinations instead** and enter a value such as `Ctrl+Alt+S`, `Command+K`,
or `F6`. Add a second step for a sequence, and add up to four alternative bindings per command.
The first step needs Control, Command/Win, or Alt, or a function key; the second can be a bare
key. Escape remains reserved for cancellation. An assigned Tab second step takes priority over
navigation in the action picker; otherwise Tab reaches the picker buttons.

Each binding can apply throughout the app, outside terminals, only in the native desktop app,
or while a tab title is focused. Ordinary form fields and open dialogs keep their editing and
navigation behavior. Terminal programs and standard text-editing shortcuts remain owned by
their respective inputs; this page customizes Concors workspace commands.

Conflicting bindings, including a single combination that is also a sequence prefix, require
explicit reassignment. Saving then removes just the conflicting alternatives from the other
commands. Remove all bindings to disable a command's shortcuts. **Use defaults**, followed by
**Save shortcuts**, restores one command; **Restore all defaults** restores every command.
Menu and search hints update as soon as the change is saved. If a browser or operating system
reserves a combination, it may intercept it before Concors receives it.

Preferences are per device, independent of the machine and workspace. Desktop/browser clients
save them locally and update other open windows on the same origin. Mobile saves through its
native preference bridge and exposes the same editor for supported commands and external
keyboards; its browser preview also persists these preferences. Existing installations retain
the defaults until a command is customized. The settings page remains reachable through the
account menu even if its shortcut is changed or disabled.

## Default bindings

| Action                                 | Shortcut                                   |
| -------------------------------------- | ------------------------------------------ |
| New pane to the left/right/above/below | Ctrl+Shift+P, then the corresponding arrow |
| New pane to the right (default)        | Ctrl+Shift+P, then Enter                   |
| Close active pane                      | Ctrl+Shift+P, then Backspace               |
| Focus neighboring pane                 | Ctrl+Shift+Arrow                           |
| Previous/next tab                      | Ctrl+Shift+T, then Left/Right              |
| New tab profile picker                 | Ctrl+Shift+T, then Enter                   |
| Close current tab                      | Ctrl+Shift+T, then Backspace               |
| Search workspaces, agents and tabs     | Ctrl+Shift+K, type, then Enter             |
| Add project                            | Ctrl+Shift+N                               |
| Settings                               | Ctrl+Shift+,                               |
| Shortcut reference                     | Ctrl+Shift+/                               |
| Rename focused tab                     | F2                                         |
| Reorder focused tab                    | Alt+Shift+Left/Right                       |

The desktop app additionally supports Ctrl+Tab and Ctrl+Shift+Tab. Browser clients leave these
to the browser's own tab navigation. Ctrl+Shift+W is not an app shortcut: it can close the browser
window. The former D/E split and W/X close shortcuts have been removed from the app mappings.

Pane navigation follows rendered geometry and does not wrap at outer edges. Directional navigation
focuses the target terminal or Agent input, ready to type; consecutive arrows continue navigating. Tab navigation
follows the visible tab order and wraps. Switching projects restores the last selected tab and
focused pane remembered by this client during the current app session; missing tabs/panes fall
back to the first available item. Active project/tab selection continues to sync through the
workspace; keyboard focus remains local.

Ctrl+Shift+Arrow navigates directly from the Agent composer as well as terminals. It does not
select text in the Agent composer; use Shift+Arrow or the mouse for selection there. Ordinary
form fields retain their native Ctrl+Shift+Arrow editing behavior. Terminals allow workspace shortcuts, and their
recognized keys are consumed before reaching the PTY. Forms and dialogs retain their own keys.
Unsent chat text and attachments survive pane/tab navigation in memory for the current daemon connection.
Outside terminals, Ctrl+K (Command+K on Mac) remains a search alias.

New left/above splits require a daemon advertising `directional-pane-split`; these actions are
disabled with older daemons. New panes inherit the current pane's profile. Closing a pane/tab
leaves its sessions running, as when using the corresponding UI controls.

## Terminal clipboard

Select terminal output, then press Super+C (Command+C on macOS) to copy.
Super+V / Command+V pastes. Ctrl+Shift+C and Ctrl+Shift+V also work, as do
Ctrl+Insert for copy and Shift+Insert for paste.
These shortcuts are consumed locally and never sent as control characters to the shell.
Copying with no selection leaves the clipboard alone; plain Ctrl+C still interrupts the
running command and plain Ctrl+V retains its shell behavior.

The desktop app uses the system clipboard; browser clients use the browser's clipboard
permissions. Paste goes through xterm so multiline text respects bracketed paste mode.
Clipboard failures are shown in the terminal instead of silently dropping the shortcut.

### Omarchy / Hyprland

Omarchy can intercept Super+C/V and send different keys to the application. Concors accepts
Ctrl+Insert/Shift+Insert and Ctrl+Shift+C/V, as well as Super+C/V delivered directly.

If Super+C interrupts a command, inspect the active Hyprland clipboard bindings and the
Concors window class/app ID. A binding that translates Super+C to plain Ctrl+C makes it
indistinguishable from a physical Ctrl+C inside the application. Configure the compositor
to send Ctrl+Insert/Shift+Insert for Concors instead, preserving the existing behavior for
other applications. Do not change plain Ctrl+C to copy globally.

Omarchy releases use different configuration formats and terminal detection rules; use
the installed configuration as the source of truth. Also check that the launcher actually
runs the newly built Concors executable.

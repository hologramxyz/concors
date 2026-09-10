# Workspace keyboard shortcuts

Open the user menu at the bottom of the sidebar, choose **Settings**, then **Keyboard shortcuts**
under Personal. The dedicated page groups the reference into Workspace, Tabs, and Panes.
Searching for Keyboard shortcuts or pressing Ctrl+Shift+/ opens the same settings page.
Use **Back to app** to return to your previous view.

Use physical Control on macOS as well as Linux/Windows. `→` between keys denotes a sequence:
press and release the first chord, then press the next key. A small action picker shows choices
and disabled actions; Escape, clicking outside, or leaving the window cancels. Holding a key
does not repeat a creation or close action; directional focus keys can repeat. Unknown keys cancel the sequence and retain their
ordinary behavior.

| Action                                 | Shortcut                                   |
| -------------------------------------- | ------------------------------------------ |
| New pane to the left/right/above/below | Ctrl+Shift+P, then the corresponding arrow |
| New pane to the right (default)        | Ctrl+Shift+P, then Enter                   |
| Close active pane                      | Ctrl+Shift+P, then Backspace               |
| Focus neighboring pane                 | Ctrl+Shift+Arrow                           |
| Previous/next tab                      | Ctrl+Shift+T, then Left/Right              |
| New tab profile picker                 | Ctrl+Shift+T, then Enter                   |
| Close current tab                      | Ctrl+Shift+T, then Backspace               |
| Find project or command                | Ctrl+Shift+K, type, then Enter             |
| Add project                            | Ctrl+Shift+N                               |
| Settings                               | Ctrl+Shift+,                               |
| Shortcut reference                     | Ctrl+Shift+/                               |

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

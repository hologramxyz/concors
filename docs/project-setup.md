# Workspaces and folders

Choose **New workspace** from the sidebar’s **+** menu to open a terminal in the selected machine user's home directory. There is no setup form. Navigate with `cd`; the workspace name and Files root follow the original terminal's folder. Inside a Git checkout, they use the checkout root, so `cd src` does not rename the workspace. Linked worktrees keep their own identities.

Existing projects, opened folders, and clones keep their selected folder. Closing or changing the original terminal's profile keeps the workspace at its last folder; another split never silently becomes the identity source. Multiple fresh workspaces may start in home without sharing sessions.

The same **+** menu also offers:

- **Open folder…** browses directories on the selected machine, including parent/home navigation, filtering, and an optional hidden-folder toggle. Entering an absolute path or `~/…` is also supported. The canonical folder name becomes the workspace name. Opening an already-open folder focuses its existing workspace and keeps its sessions.
- **Clone repository…** accepts HTTPS, SSH/scp-style URLs, or an absolute local repository path. The destination defaults to `~/repos/<repository-name>` and remains editable. Concors creates `~/repos` when needed and never overwrites an existing destination. Git credentials and known hosts must already be configured on the machine.

A bare path resolves beneath the daemon user's `~/repos`; a tilde refers to the machine, not the client device. The directory browser is bounded to 500 folders / 10,000 scanned entries per response; a direct path remains available for larger directories. It does not traverse symlinks automatically, but an explicitly entered symlink is canonicalized when opened.

## Continuity

New tabs inherit the focused pane's last observed directory. Splits inherit their source pane's directory. New agent sessions use that captured launch folder. Existing agents keep their original folder; existing terminals keep running wherever their shell is located.

File tabs capture their folder when opened, including Markdown links and unsaved drafts. Browsing elsewhere changes the Files tree, not those tabs' read/save targets. Identical relative filenames in different folders are separate tabs. The daemon retains the previously authorized roots with the workspace, validates each file operation against them, and keeps the existing traversal, symlink, file-size, and revision checks. Closing a workspace removes its root authorizations without deleting its files.

Linux observes the shell's `/proc/<pid>/cwd`; macOS uses `lsof` for that shell's cwd. Polling is every 400 ms, with no overlapping scans. Native observations take precedence over OSC 7 reports. Shells emitting local OSC 7 directory URLs provide a fallback. Windows shells without OSC 7 (including the default `cmd.exe`) retain their last known folder: use Open folder to select it explicitly. Concors does not rewrite shell startup files, parse prompts, or inject `cd` commands.

The daemon publishes directory observations to all connected clients, including while the initiating client is disconnected. Observation revisions do not invalidate concurrent layout commands. A shell whose folder becomes unavailable keeps running with its last valid workspace metadata.

## Setup jobs and compatibility

Open/clone/new-workspace jobs survive closing the dialog or disconnecting. Up to four jobs run concurrently. The most recent 64 jobs (including any running jobs) are sent to clients; older retry receipts remain in SQLite, so opening folders is not subject to a lifetime history limit. Retrying the same request and setup IDs returns the same job. A daemon restart marks incomplete jobs interrupted rather than silently restarting clones. Created destination files remain available for inspection after failures or cancellation.

The wire capability is `folder-workspaces`. New fields are optional: older saved projects keep their selected folder, and older clients can still open/create/clone named projects. A new SQLite table retains workspace folder authorizations; it is additive to schema version 4. Session launch directories remain distinct from observed current directories.

Git uses argument arrays, disabled interactive credential prompts, strict SSH host-key checking, and no embedded URL passwords. The create-folder protocol operation remains available for existing clients. The desktop entry points are New workspace, Open folder, and Clone repository.

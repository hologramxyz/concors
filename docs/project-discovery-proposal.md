# Project selection and terminal folders

Recommendation: support explicit projects plus an optional folder-driven scratch workspace. Keep a project's identity stable once the user has named or pinned it. Detect each terminal's current folder independently so new panes can inherit useful context without moving existing tabs between projects.

## What Herdr does

Reviewed Herdr revision `b99002ac99b09e00b4ca692436cb15a6b0d676f1`:

- A session without workspaces opens one automatically. Users can also create, name and close workspaces explicitly.
- An automatically named workspace derives its identity from the first tab's root pane, not whichever pane currently has keyboard focus. Its automatic display name can follow that pane's current directory and Git root. A custom name remains explicit.
- `new_cwd = "follow"` inherits the source pane/workspace folder. Other policies select home, the application directory, or a fixed folder.
- The terminal reports its directory through shell/terminal integration; directory identity is independent of text output and client scrolling. Git/worktree metadata is discovered from that path.

Sources: [workspace identity and regression tests](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/workspace.rs), [directory parsing](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/pane/osc.rs), [working-directory policy](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/configuration.mdx).

## Proposed Concors behavior

1. Keep Open/Create/Clone project. These create a stable project with a terminal as its first tab and pane, as Concors already does.
2. Add a scratch terminal entry point on each machine. It opens in the configured repositories directory, with home as a fallback, without requiring a project form.
3. Track `currentDirectory` per terminal on the machine. Prefer validated OSC 7/shell integration; use an OS process-directory fallback where available. Resolve paths on the machine, never in the remote client, and never infer a directory by parsing an arbitrary prompt or replaying `cd`.
4. When a scratch terminal enters a repository, show its repository name automatically and offer **Use this folder as a project**. For a folder without Git, use its basename and offer the same action. Promote the existing tab/panes in place, retaining their sessions.
5. Offer an optional **Follow folder** setting for scratch workspaces. An explicit name or project selection pins the identity. Existing named projects remain pinned by default.
6. New generic tabs/panes can start a plain terminal in the focused pane's current folder. Choosing Codex, Claude Code, OpenCode or Agent explicitly still opens that profile. Changing folders in a different split never relocates the project or changes another pane's directory.

Example: a scratch terminal starts in `~/repos`. After `cd app`, it displays `app`; promoting it creates the project without restarting the shell. A split can then `cd ../api` while the original project stays `app`. The user can promote that pane into an `api` project explicitly if desired.

## Sync and implementation order

The daemon owns current-directory observations and project promotion, because terminals run on the machine and all clients share layouts. Persist project IDs, tab/pane IDs, a pinned/follow-folder preference and the scratch identity pane. Promote in one workspace transaction; normalize paths and reuse an existing matching project instead of creating duplicates. Git worktree checkout roots stay distinct, even when they share a repository.

First implement and test directory reporting and inherited launch directories. Then add scratch promotion and its empty-state UI. Add automatic follow mode only after promotion is reliable across two clients. Acceptance coverage should include nested folders, symlinks, non-Git folders, worktrees, stale observations, disconnected clients and a background split changing directory.

This PR only contains desktop interaction fixes. Directory discovery and automatic project organization remain a proposal for review; it does not change the cloud-server repository.

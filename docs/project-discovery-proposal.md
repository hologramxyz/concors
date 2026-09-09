# Project selection and terminal folders

Decision: let users start working without registering a project. New workspaces follow the original terminal’s folder; pinning preserves a stable project identity. Track every terminal independently so new panes inherit useful context without moving existing work.

## What Herdr does

Reviewed Herdr revision `b99002ac99b09e00b4ca692436cb15a6b0d676f1`:

- A session without workspaces opens one automatically. Users can also create, name and close workspaces explicitly.
- An automatically named workspace derives its identity from the first tab's root pane, not whichever pane currently has keyboard focus. Its automatic display name can follow that pane's current directory and Git root. A custom name remains explicit.
- `new_cwd = "follow"` inherits the source pane/workspace folder. Other policies select home, the application directory, or a fixed folder.
- The terminal reports its directory through shell/terminal integration; directory identity is independent of text output and client scrolling. Git/worktree metadata is discovered from that path.

Sources: [workspace identity and regression tests](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/workspace.rs), [directory parsing](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/src/pane/osc.rs), [working-directory policy](https://github.com/herdrdev/herdr/blob/b99002ac99b09e00b4ca692436cb15a6b0d676f1/docs/next/website/src/content/docs/configuration.mdx).

## Implemented Concors behavior

The approved flow now ships as **New workspace**, **Open folder…**, and **Clone repository…**. A fresh workspace follows its original terminal automatically until pinned. Existing projects remain pinned. See [workspaces and folders](project-setup.md) for the behavior, protocol, platform support, and file/session continuity guarantees.

Concors uses native shell-process directory observations before OSC 7 fallback. Directory changes update shared metadata without recreating sessions or moving running work. Source panes provide launch folders for new tabs and splits. Open file tabs retain their original roots through navigation and reconnects.

The reference informed the interaction model; no Herdr source was copied. No changes were made to the cloud-server repository.

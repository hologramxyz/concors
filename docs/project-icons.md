# Workspace icons

Expanded and collapsed desktop sidebars and the shared mobile project list use
the same local project icon. Ordinary directories retain a folder icon. Git repos
(including worktrees and folders inside a working tree) use a favicon when one is
found, or a rounded tile with the first grapheme of the project name. Unreadable,
oversized, unsupported or broken images fall back to that tile. Bare repositories
and machines without Git use the folder fallback.

The daemon checks `favicon.svg`, `favicon.png`, `favicon.ico`, then `favicon.webp`
in the project root, `public`, `static`, `assets`, `app`, `src/app`, `src`, and
`src/assets`. App directories also support `icon.svg` and `icon.png`. It then checks
those same locations in direct children of `apps` and `packages`. Discovery is
bounded to 128 directory candidates, scanning at most 128 entries and retaining
32 children per monorepo container. It does not crawl dependencies or build output.
Root candidates take priority; child workspace names are sorted.

Only regular image files up to 256 KiB inside the selected project are returned.
Symlink paths are rejected using the file browser's path checks. Images travel as
data URLs over the existing authenticated machine connection and render as `img`
elements. Repository HTML, remote URLs and GitHub preview cards are not fetched.

The client caches results by connection, workspace epoch, project and directory.
Visible clients check once a minute and on window focus when the cache has expired;
layout changes and collapsing the sidebar reuse cached icons. A failed refresh
retains a previously loaded icon. Changing directories, switching machines or
reconnecting cannot apply a stale result to the new project.

Discovery requires the daemon's `project-icons` capability. Older daemons keep the
folder fallback without receiving unsupported requests; update the session host
to enable local favicon/repository detection. No workspace database migration is
required, and changing an icon never changes tabs, sessions or project selection.

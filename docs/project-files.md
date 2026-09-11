# Project files

The Files button beside project tabs opens a right-hand directory tree on the connected machine.
Opening a file adds a client-local file tab beside the existing agent and terminal tabs. The browser is a full-window-height second sidebar outside the inset workspace surface. Its
left edge supports pointer dragging, arrow-key resizing, Home/End limits, and double-click reset.
Width is remembered on this client. Opening/closing moves the workspace and Files toggle together;
reduced motion disables the transition. Narrow screens use a full-height overlay with room for the
toggle beside it. A separate toolbar below the Files heading provides new file, new folder,
hidden-file visibility, and refresh actions, with the same icon size as the sidebar toggles.
Dotfiles are hidden by default; the visibility preference is remembered on this client. Folders
load on expansion, and the filter searches filenames already loaded. Expanded folders stay open
when the sidebar closes and reopens or refreshes. The drawer omits the absolute project path footer.

The file tree and open-file tabs share colored file-type icons on desktop and mobile. Icons match
extensions and familiar filenames such as `Dockerfile`, `package.json`, and `.gitignore`, with a
neutral fallback for unknown types. They are bundled with the client and adjusted for light and dark
themes; file labels remain the accessible names. Folders and symbolic links keep distinct icons.

New files and folders use paths relative to the project, with existing parent folders. A new file
opens in an editor tab; a new folder expands in the tree. The daemon advertises
`project-file-create` separately, so older machines keep browsing/editing and disable creation.
Creation uses exclusive file opens or non-recursive directory creation, rejects linked/outside
parents, and never replaces existing entries. Duplicate names keep the form open with an error.

## Viewing and editing

Text files open in a themed CodeMirror editor with syntax highlighting, line numbers, search,
word wrap, and optional Vim bindings. Save explicitly with the toolbar, Command/Ctrl+S, or Vim
`:w`. The editor module preloads when approaching or opening the Files button. If a slow
connection delays that module, the file's source is already visible while editing initializes.
Markdown opens as a rendered preview with an Edit source toggle. Raw HTML does not execute;
images are omitted, matching the existing safe chat renderer.

Agent Markdown file links and file paths in tool results open the same file tabs. Project-relative
paths, absolute paths inside the project, local `file://` URLs, and `:line` / `#Lline` suffixes are
supported. Markdown links resolve relative to the document. External web links stay external.

Draft text belongs to the file document, not the mounted editor. Switching tabs, projects, or
machines does not throw it away. File tabs are scoped to the machine, workspace epoch, and project;
opening the same path selects its existing tab. Closing a dirty tab or signing out asks before
discarding changes. Browser reload/close uses the browser's unsaved-changes warning.

## Saving on the machine

`file.request` / `file.result` use the existing subscribed daemon connection. The daemon advertises
`project-files`; older daemons leave the Files button disabled. The service resolves paths from the
registered project directory, checks the workspace epoch, and rejects traversal, symbolic links,
special files, non-UTF-8 data, binary data, and files larger than 1 MiB. Listings stop at 2,000 entries
and say when truncated. There is no additional HTTP filesystem endpoint.

Reads return a SHA-256 revision. Saves compare that revision, serialize Concors writes per path,
write and sync a sibling temporary file, preserve ordinary permission bits, recheck the revision,
and rename into place. An agent or another client's intervening edit produces a conflict instead
of silently replacing their work. The client retains its draft and offers the latest disk text to
review, reload, or explicitly replace. Typing during a save or reload does not disappear when the
response arrives. Repeated identical saves can acknowledge an earlier save whose response was lost.

The active file checks disk on focus and every five seconds. Checks flag changes without replacing
the text being read or edited. This is optimistic conflict detection: unrelated processes do not
participate in the write queue, and the filesystem does not provide a cross-process compare-and-swap
between the final revision check and rename. Project path checks are not an OS security boundary
against another process deliberately changing directories during an operation.

## Deliberate limits

- File tabs and unsaved drafts live in this client session; they are not synchronized or restored
  after an app restart. Save before leaving. Undo/cursor history resets when an editor remounts.
- This is a lightweight file editor, without language servers, rename/delete,
  binary/image previews, or a full-project search index.
- Vim uses CodeMirror keybindings, not an embedded Neovim process.
- Mobile shares this tree, document model, editor and file protocol. Its Files button opens a
  full-page view with a local open-file strip instead of the desktop resizable sidebar. Mobile
  uses in-app discard dialogs and defaults to word wrap; no filesystem access is added to the
  embedded renderer. See the [mobile walkthrough](../apps/mobile/README.md#browse-and-edit-the-projects-real-files).
- Native Tauri close-dialog behavior still needs a packaged-app check; browser behavior is covered.

## References and validation

The file panel uses CodeMirror/Vim, a Markdown preview toggle, and explicit
version-aware saves through the existing tabs and daemon transport. Source
provenance is recorded in [third-party notices](../third-party/source-notices.md).

Unit coverage exercises traversal and symlinks, read limits, UTF-8/BOM/CRLF, executable permissions,
concurrent saves and creation, safe parent paths, duplicate names, agent edits, lost acknowledgements,
draft retention, and link resolution.
`e2e/files.spec.ts` exercises real daemon file reads/writes, Markdown and agent links, switching file
tabs, discard protection, conflict review, Vim `:w`, full-height sidebar resizing, remembered width,
reduced motion, text and icon sizes, file/folder creation, hidden-file visibility, refresh preserving
expanded folders, a delayed editor download, and a narrow viewport. The browser tests mock
control-plane account responses and agent inference, as the existing acceptance suite does; file
operations use real temporary projects on the daemon.

# Color themes

Settings → Appearance has seven bundled palettes: **Concors, Cobalt, Dusk, Forest,
Rose, Sand, and Ocean**. Light / Dark / System controls the mode independently of the
palette. The existing Concors appearance remains the default. Every palette includes
both modes, and the supplied text and primary-button color pairs have contrast tests.

Colors apply to workspace surfaces, sidebars, agent chats, menus, terminals, and file editors.
Each named palette also colors terminal ANSI output and syntax in the editor, Markdown code
blocks, and agent code previews. Desktop and mobile use the same syntax roles. The original
Concors palette retains its existing terminal and syntax colors in both modes.

Changing themes recolors existing content without restarting a terminal or agent. Live editor
updates preserve the document, cursor, and undo history. Built-in themes work offline and with
older daemons. Terminal programs that select extended 256-color indices (16–255), true-color
output, or their own application theme still control those colors; Concors does not rewrite
program output or edit shell/editor configuration files.

The selection belongs to the device. Desktop windows share their selection through local
storage; native mobile persists it in device storage. A selected custom definition is
cached for offline use. Definitions are shared with every client connected to the machine,
but selecting a theme on one device does not change someone else's appearance.

## Ask an agent to create a theme

Appearance → Custom themes shows the **actual directory on the selected machine**.
Click **Copy theme instructions** and paste the result into your agent conversation.
For example, ask it to make a warm dark theme with amber accents. The instructions include
the directory, an editable example, valid fields, and how to save it.

Save one JSON file per theme in the machine's `themes` directory, alongside its workspace
database and `providers` directory. For a default local daemon this is `~/.concors/themes`
(`%USERPROFILE%\.concors\themes` on Windows); a custom `CONCORS_DATA_DIR` or managed host
uses its own data directory. Use the path shown in Appearance rather than assuming a home
folder. Agents on a remote machine write files there; clients never need direct filesystem access.

```json
{
  "version": 1,
  "id": "my-sunset",
  "name": "My sunset",
  "extends": "sand",
  "light": { "accent": "#984522" },
  "dark": {
    "accent": "#ffc092",
    "terminal": { "red": "#f39c8b", "blue": "#a4bbff" }
  }
}
```

Create the directory if necessary. Save to a temporary file, then rename it to `my-sunset.json`.
The app reloads visible clients about every three seconds, and **Refresh themes** loads changes
immediately. Existing selected themes update in place. No daemon restart is required.

Start with [the Sunset example](../examples/themes/sunset.json); editor validation is available
in [the JSON schema](./themes.schema.json). The optional `$schema` metadata is for your editor;
Concors never fetches it. If copying the example outside this repository, update or remove its
relative `$schema` path.

## File format

- `version`: `1`.
- `id`: unique lowercase slug, starting with a letter, at most 64 characters. Built-in IDs
  are reserved, and custom themes cannot extend another custom theme.
- `name`: display name, at most 80 characters. `description` is optional (240 characters).
- `extends`: one of the seven built-in IDs; defaults to `concors`.
- `light`, `dark`: optional overrides. Unspecified colors inherit from the chosen base.
- Color values: `#RRGGBB` or `#RRGGBBAA`. Use opaque text colors for readable contrast.

Each mode accepts `background`, `foreground`, `surface`, `sidebar`, `muted`, `mutedForeground`,
`border`, `accent`, `accentForeground`, and `selection`. `accent` colors primary actions and
focus indicators; `accentForeground` is the text on primary actions. `surface` is used by panes,
popovers, and the terminal background.

Each mode can also contain a `terminal` object with `background`, `foreground`, `cursor`,
`selection`, `black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`, and their
`bright-` variants. Unspecified ANSI colors are derived from the selected palette and mode,
with a restrained accent tint that preserves recognizable red/green/etc. colors. Explicit
terminal overrides always win, including alpha values. Custom ANSI colors also inform syntax
colors; derived syntax colors are adjusted for readability on the editor background. You do
not need a separate editor theme file or daemon update.

Files are limited to 32 KiB. Up to 64 regular, non-hidden `.json` files are loaded in filename
order; directories and symlinks are ignored. Duplicate IDs are reported, with the first valid
file winning. Themes contain only color data: arbitrary CSS, scripts, and resource loading
are not supported.

Malformed edits show a message in Appearance and retain the last valid version while the daemon
is running. After a restart an invalid file stays unavailable until corrected. Deleting the
selected file returns the client to Concors. Invalid files never prevent the daemon from starting.

## Development

Theme schemas and palettes are in `packages/protocol/src/themes.ts` and `theme-presets.ts`.
The machine reads files through `ThemeRegistry`; the authenticated, workspace-scoped
`theme.request` / `theme.result` protocol is available only with the `color-themes` capability.
The mobile protocol relay forwards the same catalog without exposing credentials.

`ColorThemeProvider` applies an explicit allowlist of CSS variables. The original Concors
palette removes UI overrides so existing brand styles remain unchanged. `terminal-palette.ts`
resolves the terminal colors; `syntax-palette.ts` supplies shared `--syntax-*` variables to
CodeMirror and highlighted previews. Tokenization stays cached independently of the palette.
Xterm observes palette changes without reopening its session. OS chrome and native controls keep their platform
appearance, while the mobile workspace and surrounding background follow the chosen palette.

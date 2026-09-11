# Concors client brand

Reference: `concors-web` main, commit `7397675`, specifically `src/styles.css`,
`src/App.tsx`, `src/main.tsx`, and `public/favicon.svg`.

These rules describe the default **Concors** palette. Settings → Appearance also offers
optional color palettes and custom theme files; see [Color themes](themes.md). Selecting
Concors restores the original styles. Palette choices preserve the typography, spacing,
and geometric brand mark.

- Primary actions use ink with white labels in light mode, and light gray with dark labels in dark mode.
- Selected controls, focus rings, resize handles, badges, and links use neutral foreground colors.
- Native form controls inherit the same neutral accent. Text selection uses soft gray in both themes.
- The default application retains its paper surfaces, Geist typography, and geometric brand mark.
  Cobalt is available as an optional palette inspired by the landing page.
- Geist and Geist Mono are bundled locally for offline desktop/mobile use.
- The sign-in wordmark and browser favicon reuse the current geometric brand mark.

The dense workspace keeps its current tabs, pane geometry, and controls. Landing-page
reveal effects, large uppercase marketing headings, and decorative grids aren't applied
inside work panes.

Terminal colors are explicit ANSI palettes for light and dark themes, with ANSI blues,
readable red/green/yellow/cyan/magenta colors, matching pane chrome, and a 12px Geist Mono
font. Normal output uses weight 400; ANSI bold uses weight 600 so prompts and CLI headings retain
emphasis without the heavy default 700. A 1.1 line-height keeps rows compact (17px with the bundled
font in Chromium at 1× scale). Switching the app theme updates the renderer without restarting its session.
Application-specified indexed and true-color values are preserved.

## Desktop text sizes

The root remains 13px to preserve the compact rem-based spacing. Tailwind text-size tokens use
explicit pixel values so `text-xs` actually renders at 12px, rather than 9.75px. Both sidebars, tabs,
and compact navigation use `text-ui` (13px); supporting metadata uses 12px; body controls and code
use 14px; chat prose uses 16px. Terminal text uses 12px with a block cursor; the code editor uses 14px. Inline code may use a
relative size, but fenced code inherits its block's full size.

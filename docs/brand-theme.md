# Concors client brand

Reference: `concors-web` main, commit `7397675`, specifically `src/styles.css`,
`src/App.tsx`, `src/main.tsx`, and `public/favicon.svg`.

- Primary actions use the site's exact cobalt, `#335dce`, with white labels.
- Dark-mode text accents and focus rings use the site's softer cobalt, `#a6bdff`.
- Text selection uses `#c7d5ff`. Light surfaces use paper `#f4f3ef`, ink `#20211f`,
  muted text `#65665f`, and rules `#d3d3cb`.
- Geist and Geist Mono are bundled locally for offline desktop/mobile use.
- The sign-in wordmark and browser favicon reuse the current geometric brand mark.

The dense workspace keeps its current tabs, pane geometry, and controls. Landing-page
reveal effects, large uppercase marketing headings, and decorative grids aren't applied
inside work panes.

Terminal colors are explicit ANSI palettes for light and dark themes, with cobalt blues,
readable red/green/yellow/cyan/magenta colors, matching pane chrome, and a 13px Geist Mono
font. Switching the app theme updates the renderer without restarting its session.
Application-specified indexed and true-color values are preserved.

## Desktop text sizes

The root remains 13px to preserve the compact rem-based spacing. Tailwind text-size tokens use
explicit pixel values so `text-xs` actually renders at 12px, rather than 9.75px. Both sidebars, tabs,
and compact navigation use `text-ui` (13px); supporting metadata uses 12px; body controls and code
use 14px; chat prose uses 16px. Terminal text uses 13px with a block cursor; the code editor uses 14px. Inline code may use a
relative size, but fenced code inherits its block's full size.

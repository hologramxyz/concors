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

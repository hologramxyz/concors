# Logos and app icons

Every logo and app icon the apps use is in this folder, under its real file name. To change one,
replace the file here and run:

```sh
pnpm brand:apply          # put the files in place, regenerating what is made from a source
pnpm brand:apply --check  # only list what differs from the apps; exits 1 if anything does
```

Replacing a file in `sources/` regenerates the files made from it, and the copies here are updated
to match. A file you replace in any other folder is copied as it is and wins over the generated one:
a hand-tuned 32×32 icon, say. [`manifest.json`](manifest.json) says where each file goes, and the
desktop tests fail if this folder and the apps differ.

## Files

| File                             | Size                       | Transparent      | Where it shows up                                                                                                                  |
| -------------------------------- | -------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sources/app-icon.svg`           | 1024×1024 SVG, full bleed  | No               | Source of the phone icons (below); the desktop icons and favicon are hand-made from the same artwork                               |
| `sources/logo-mark.svg`          | SVG (`0 0 100 72`)         | Yes, one colour  | Sign-in, startup screen, phone Settings → About. Read by the build directly; the app colours it, so one file serves light and dark |
| `sources/wordmark.svg`           | 234×74 SVG, charcoal       | Yes              | Master copy; nothing reads it directly. The disk image uses the kit's horizontal lockup: this wordmark beside the mark             |
| `desktop/icon.icns`              | 16–1024 px, 10 sizes       | Corners          | Mac: Dock, Finder, app switcher (hand-made, on Apple's grid)                                                                       |
| `desktop/icon.ico`               | Up to 256 px               | Corners          | Windows: taskbar, Start menu, title bar (hand-made, on Apple's grid)                                                               |
| `desktop/32x32.png`              | 32×32                      | Corners          | Linux app menus and windows (hand-made, on Apple's grid)                                                                           |
| `desktop/128x128.png`            | 128×128                    | Corners          | Linux app menus and windows (hand-made, on Apple's grid)                                                                           |
| `desktop/128x128@2x.png`         | 256×256                    | Corners          | Linux app menus and windows (hand-made, on Apple's grid)                                                                           |
| `desktop/icon.png`               | 512×512                    | Corners          | Linux packages (tarball, AUR) (hand-made, on Apple's grid)                                                                         |
| `mobile/icon.png`                | 1024×1024                  | No, on `#f4f3ef` | iPhone home screen and App Store, mobile web favicon, phone welcome screen, Play Store icon (generated)                            |
| `mobile/adaptive-icon.png`       | 1024×1024, mark in the 640 | Yes              | Android launcher, on a `#f4f3ef` background (generated)                                                                            |
| `mobile/notification-icon.png`   | 96×96, white               | Yes              | Android notifications and themed launcher icon (generated)                                                                         |
| `mobile/splash.png`              | 512×512, ink               | Yes              | Phone launch screen, light (generated)                                                                                             |
| `mobile/splash-dark.png`         | 512×512, light grey        | Yes              | Phone launch screen, dark (generated)                                                                                              |
| `web/favicon.svg`                | 32×32 SVG                  | No               | Browser tab of the web build, light or dark with the browser; logo on the store images (hand-made)                                 |
| `disk-image/dmg-background.svg`  | 660×440                    | No               | Mac disk image window: the lockup and the arrow. Source of the `.tiff`                                                             |
| `disk-image/dmg-background.tiff` | 660×440 and 1320×880       | No               | What the disk image actually shows; made by hand from the `.svg` (below)                                                           |

"Generated" files are made from `sources/app-icon.svg` by `apps/mobile/scripts/app-icons.mjs`. The
source would also make the desktop icons (`tauri icon`) and the favicon (a copy without the fixed
size), but the files here are hand-made and win: the desktop icons put the full-bleed artwork on
Apple's grid (below), and the favicon is the brand kit's 32×32 browser icon. When `app-icon.svg`
changes, make those again, or `brand:apply` replaces them with the plain generated ones. When the
icon or the favicon changes, `brand:apply` also re-renders the store images in
`apps/mobile/release/*/exports/`.

**Favicon, light and dark:** `favicon.svg` is the kit's "Browser Light" icon with a
`prefers-color-scheme: dark` style inside that swaps the tile and mark colours, which is the kit's
"Browser Dark" (the two share one shape). Chrome, Edge and Firefox follow the browser's theme;
browsers that ignore the style show the light one. Keep the tile as the one `<rect>` with class
`concors-favicon-tile` and the mark in `currentColor`. The store images use the favicon without
its `<style>`, so they always get the light version.

## Drawing a new app icon

- **Structure:** one plain background shape (`<rect …/>`), then the mark in one colour, drawn with
  `fill="currentColor"` and `color="#20211f"` on the root `<svg>`. The phone's launch screen,
  Android launcher and notification icon are made by deleting that first `<rect/>` and changing the
  colour, so an icon built differently (gradients, several colours, no plain background) needs those
  files hand-made in `mobile/`.
- **Apple's grid:** the Mac app supports macOS 13.5 and up. macOS 26 clips a full-bleed square into
  its rounded square, but earlier versions show it as a plain square. So the desktop icons use a
  1024 canvas with an 824×824 tile at (100, 100), a corner radius of 185 px, and the artwork scaled
  by 824/1024 onto it, rendered with `pnpm --filter @concors/desktop tauri icon <file> -o <folder>`
  and copied into `desktop/`.
- It must still read at 16×16; if it doesn't, drop a hand-made `desktop/32x32.png` (and replace
  the 16 and 32 px entries in `icon.icns` and `icon.ico`). The small sizes today are the large
  artwork scaled down: the kit's "Browser 32×32" files are that same artwork at 32 px, not drawn
  separately, and there is no 16 px version, so they would not be any sharper.

## Still by hand afterwards

- **Native phone projects:** `apps/mobile/ios/` and `android/` are not checked in. Rebuild them with
  `pnpm --filter @concors/mobile exec expo prebuild --clean`; store builds do this themselves.
- **Disk image background:** after changing `dmg-background.svg` (or the mark or wordmark in it),
  render it at 660×440 and 1320×880 with Geist installed (the lockup is outlines), saved as
  `dmg-background.png` and `dmg-background@2x.png` (the `@2x` name is what gives the larger one
  144 dpi), then run
  `tiffutil -cathidpicheck dmg-background.png dmg-background@2x.png -out disk-image/dmg-background.tiff`
  and `pnpm brand:apply`.
- **Store screenshots:** the four store screenshots show the app itself, so retake them if the logo
  appears in a captured screen.
- **Docs:** screenshots in `docs/mobile-polish/` and `docs/images/` show the old logo.
- **Website:** `concors-web` has its own favicon and logo.

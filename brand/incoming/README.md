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

| File                             | Size                       | Transparent              | Where it shows up                                                                                                                  |
| -------------------------------- | -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sources/app-icon.svg`           | Square SVG, drawn at 1024  | Corners outside the tile | Source of the desktop and phone icons and the favicon (below)                                                                      |
| `sources/logo-mark.svg`          | Square SVG (`0 0 96 96`)   | Yes, one colour          | Sign-in, startup screen, phone Settings → About. Read by the build directly; the app colours it, so one file serves light and dark |
| `sources/wordmark.svg`           | SVG, 27 px tall            | Yes                      | Nothing reads it yet: the disk image sets "Concors" as text. Kept as the master for the next wordmark                              |
| `desktop/icon.icns`              | 16–1024 px, 10 sizes       | Corners                  | Mac: Dock, Finder, app switcher (generated)                                                                                        |
| `desktop/icon.ico`               | Up to 256 px               | Corners                  | Windows: taskbar, Start menu, title bar (generated)                                                                                |
| `desktop/32x32.png`              | 32×32                      | Corners                  | Linux app menus and windows (generated)                                                                                            |
| `desktop/128x128.png`            | 128×128                    | Corners                  | Linux app menus and windows (generated)                                                                                            |
| `desktop/128x128@2x.png`         | 256×256                    | Corners                  | Linux app menus and windows (generated)                                                                                            |
| `desktop/icon.png`               | 512×512                    | Corners                  | Linux packages (tarball, AUR) (generated)                                                                                          |
| `mobile/icon.png`                | 1024×1024                  | No, on `#f4f3ef`         | iPhone home screen and App Store, mobile web favicon, phone welcome screen, Play Store icon (generated)                            |
| `mobile/adaptive-icon.png`       | 1024×1024, mark in the 640 | Yes                      | Android launcher, on a `#f4f3ef` background (generated)                                                                            |
| `mobile/notification-icon.png`   | 96×96, white               | Yes                      | Android notifications and themed launcher icon (generated)                                                                         |
| `mobile/splash.png`              | 512×512, ink               | Yes                      | Phone launch screen, light (generated)                                                                                             |
| `mobile/splash-dark.png`         | 512×512, light grey        | Yes                      | Phone launch screen, dark (generated)                                                                                              |
| `web/favicon.svg`                | Square SVG                 | Corners                  | Browser tab of the web build; logo on the store images (generated)                                                                 |
| `disk-image/dmg-background.svg`  | 660×440                    | No                       | Mac disk image window: the mark, "Concors" and the arrow. Source of the `.tiff`                                                    |
| `disk-image/dmg-background.tiff` | 660×440 and 1320×880       | No                       | What the disk image actually shows; made by hand from the `.svg` (below)                                                           |

"Generated" files are made from `sources/app-icon.svg`: the desktop ones by `tauri icon`, the phone
ones by `apps/mobile/scripts/app-icons.mjs`, and the favicon is a copy without the fixed size. When
the icon or the favicon changes, `brand:apply` also re-renders the store images in
`apps/mobile/release/*/exports/`.

## Drawing a new app icon

- **Structure:** one plain background shape (`<rect …/>`), then the mark in one colour, drawn with
  `fill="currentColor"` and `color="#20211f"` on the root `<svg>`. The phone's launch screen,
  Android launcher and notification icon are made by deleting that first `<rect/>` and changing the
  colour, so an icon built differently (gradients, several colours, no plain background) needs those
  files hand-made in `mobile/`.
- **Apple's grid:** macOS 26 puts icons that ignore its grid inside its own rounded square. Draw on
  a 1024 canvas with an 824×824 body and a corner radius of about 185 px. Today's icon is a
  full-bleed tile with a 12/96 radius, which is why macOS frames it.
- It must still read at 16×16; if it doesn't, drop a hand-made `desktop/32x32.png` (and replace
  the small sizes in `icon.icns`).

## Still by hand afterwards

- **Native phone projects:** `apps/mobile/ios/` and `android/` are not checked in. Rebuild them with
  `pnpm --filter @concors/mobile exec expo prebuild --clean`; store builds do this themselves.
- **Disk image background:** after changing `dmg-background.svg` (or the mark or wordmark in it),
  render it at 660×440 and 1320×880 with Marcellus and Geist installed, then run
  `tiffutil -cathidpicheck small.png large.png -out disk-image/dmg-background.tiff` and
  `pnpm brand:apply`. The mark inside the `.svg` is a copy of `sources/logo-mark.svg`.
- **Store screenshots:** the four store screenshots show the app itself, so retake them if the logo
  appears in a captured screen.
- **Docs:** screenshots in `docs/mobile-polish/` and `docs/images/` show the old logo.
- **Website:** `concors-web` has its own favicon and logo.

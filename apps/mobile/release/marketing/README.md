# Concors App Store marketing campaign

Four English iPhone screenshot creatives, exported at **1206 × 2622 pixels**, RGB PNG without
alpha. The sequence explains the mobile app through agent progress, approval requests, workspace
switching, and remote terminal access. `exports/campaign-overview.png` is the contact sheet, not an
App Store upload.

The app screens are actual iPhone simulator captures. The isolated `store-capture` Expo profile
populates them with fictional Orbit, Atlas API, and Studio projects. The native layout, controls,
messages, and terminal renderer are the app's own. No live account details, private repositories,
API keys, or invented app controls are inserted. The marketing copy makes no subscription,
unlimited-use, or cloud-hosting offer. Connecting machines from desktop is stated on the terminal
frame and in the store description.

`source/campaign-background.png` is background artwork made with the built-in image-generation
tool. Its exact prompt and mode are recorded in `source/art-direction.json`. It contains no app
interface. The geometric mark comes from the repository's existing Concors SVG. Geist is the
app's existing font; the accompanying SIL Open Font License is retained in `source/`.

To reproduce the exports from the repository root after installing dependencies:

```sh
node apps/mobile/release/marketing/render.mjs
```

The renderer lays out the headline text and original screen images in HTML/CSS using Playwright.
It creates four upload images, the overview, and a generated self-contained `campaign.html` for
local viewing. Edit `campaign.json` for copy and `render.mjs` for composition. The generated HTML
is ignored by Git; the source artwork, native screen PNGs, and final exports are tracked.

To recapture the native screens, build the Expo `store-capture` profile, then run the **Mobile iOS
native** workflow with that simulator artifact and `marketing_captures=true`. The ordinary demo
and production account flows do not use these sample projects. The captured screens should be
visually inspected before re-rendering and staging the upload set.

Apple permits text and image overlays while requiring the app in use to remain visible:
[guideline 2.3.3](https://developer.apple.com/help/app-review/guideline-reference/2-3-3-screenshots/).
Export dimensions follow the
[screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { build } from "../../desktop/node_modules/vite/dist/node/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = path.join(root, "assets");
await mkdir(assets, { recursive: true });
const source = await readFile(
  new URL("../../desktop/src-tauri/icons/source.svg", import.meta.url),
  "utf8",
);
const mark = source.replace(/<rect[^>]*\/>/, "");
await sharp(Buffer.from(source))
  .resize(1024, 1024)
  .flatten({ background: "#f4f3ef" })
  .png()
  .toFile(path.join(assets, "icon.png"));
await sharp(Buffer.from(mark))
  .resize(640, 640)
  .extend({ top: 192, bottom: 192, left: 192, right: 192, background: "#00000000" })
  .png()
  .toFile(path.join(assets, "adaptive-icon.png"));
await sharp(Buffer.from(mark.replace('color="#20211f"', 'color="#ffffff"')))
  .resize(96, 96)
  .png()
  .toFile(path.join(assets, "notification-icon.png"));
await sharp(Buffer.from(mark)).resize(512, 512).png().toFile(path.join(assets, "splash.png"));

// Compile the actual desktop UI into a self-contained offline mobile renderer.
// No remote URLs, runtime chunk fetches, Tauri APIs or credentials enter this document.
const desktop = fileURLToPath(new URL("../../desktop/", import.meta.url));
await build({ root: desktop, configFile: path.join(desktop, "vite.mobile.config.ts") });
const workspaceJs = await readFile(path.join(desktop, "dist/mobile-ui/workspace.js"), "utf8");
const workspaceCss = await readFile(path.join(desktop, "dist/mobile-ui/workspace.css"), "utf8");
const workspaceHtml = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'"><style>${workspaceCss.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${workspaceJs.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile(
  path.join(assets, "workspace-html.ts"),
  `// Generated from the desktop UI by scripts/assets.mjs.\nexport const workspaceHtml = ${JSON.stringify(workspaceHtml)};\n`,
);

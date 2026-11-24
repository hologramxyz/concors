import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

/**
 * The phone's icons and launch marks, all made from the desktop app icon. The mark is that icon
 * without its first `<rect/>` (the tile), recoloured through its root `color` attribute.
 * Run by `pnpm brand:apply` when brand/incoming/sources/app-icon.svg changes; builds use the
 * checked-in results, so a hand-tuned file from brand/incoming/mobile/ is what ships.
 */
export async function writeAppIcons(assets = fileURLToPath(new URL("../assets", import.meta.url))) {
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
  await sharp(Buffer.from(mark.replace('color="#20211f"', 'color="#ededed"')))
    .resize(512, 512)
    .png()
    .toFile(path.join(assets, "splash-dark.png"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await writeAppIcons();

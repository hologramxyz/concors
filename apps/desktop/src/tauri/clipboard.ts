import { isTauri } from "@tauri-apps/api/core";
import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyText, readText as readBrowserText } from "@/lib/clipboard";

export async function readClipboardText(): Promise<string> {
  return isTauri() ? readText() : readBrowserText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) await writeText(text);
  else await copyText(text);
}

/**
 * The image on the system clipboard, or null when there is none. WebKitGTK hands the page an
 * empty paste event for an image-only clipboard and refuses the async Clipboard API, so on Linux
 * the image can only be read natively.
 */
export async function readClipboardImage(): Promise<ImageData | null> {
  if (!isTauri()) return null;
  let image;
  try {
    image = await readImage();
  } catch {
    // The plugin reports "no image" as an error; that is the ordinary text-only case.
    return null;
  }
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()]);
    return new ImageData(new Uint8ClampedArray(rgba), width, height);
  } finally {
    void image.close();
  }
}

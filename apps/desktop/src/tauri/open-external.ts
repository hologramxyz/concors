import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ProcessPreview } from "@concors/protocol";

/**
 * Opens a URL in the user's default browser. Inside Tauri this goes through the opener plugin
 * (the webview must not navigate to third-party pages such as Stripe Checkout); in a plain browser
 * it is a new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export async function openPreview(_preview: ProcessPreview, url: string): Promise<void> {
  await openExternal(url);
}

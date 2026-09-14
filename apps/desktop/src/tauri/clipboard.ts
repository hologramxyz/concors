import { isTauri } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyText, readText as readBrowserText } from "@/lib/clipboard";

export async function readClipboardText(): Promise<string> {
  return isTauri() ? readText() : readBrowserText();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isTauri()) await writeText(text);
  else await copyText(text);
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import { z } from "zod";

/** A file the UI hands to the person, with its contents as base64 (how attachments travel). */
export interface FileToSave {
  name: string;
  mime: string;
  data: string;
}

/** Whether this host can put a file on the person's device; the mobile bundle cannot yet. */
export const canSaveFiles = true;

/**
 * Saves a file to the person's computer and resolves with where it went, when that is known. The
 * desktop app writes it to Downloads natively and shows it in the file manager, because its
 * webview cancels downloads (`src-tauri/src/downloads.rs`); a browser downloads it as usual.
 */
export async function saveFile(file: FileToSave): Promise<string | null> {
  const bytes = Uint8Array.from(atob(file.data), (c) => c.charCodeAt(0));
  if (isTauri())
    return z.string().parse(
      await invoke("save_download", bytes, {
        headers: { "x-file-name": encodeURIComponent(file.name) },
      }),
    );
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  // The browser has started the download by the time the click returns; free the copy later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return null;
}

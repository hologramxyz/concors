import { hostAction } from "./bridge";
export { openExternal } from "./external";
// The mobile bundle never imports Tauri. Expo owns operating-system notifications.
export function isTauri() {
  return false;
}
export async function showNativeNotification() {
  throw new Error("Use native mobile push settings");
}
export async function dismissNativeNotification() {
  /* Expo owns delivered notifications. */
}
export async function onNativeNotificationClick() {
  return () => undefined;
}
export async function playNativeSound() {
  /* isTauri() is false, so mobile plays through Web Audio. */
}
export type NativeNotificationAccess = "allowed" | "quiet" | "blocked" | "not_asked" | "unknown";
export async function nativeNotificationAccess(): Promise<NativeNotificationAccess> {
  return "unknown";
}
export async function requestNativeNotificationAccess(): Promise<NativeNotificationAccess> {
  return "unknown";
}
export async function openNativeNotificationSettings() {
  throw new Error("Use native mobile push settings");
}

export { readText as readClipboardText, copyText as writeClipboardText } from "@/lib/clipboard";
/**
 * The web view's paste carries no image on iOS or Android, and iOS does not even offer Paste in a
 * text field when the clipboard holds only an image, so the app reads it and the composer offers
 * Paste image itself.
 */
export async function clipboardHasImage(): Promise<boolean> {
  return (await hostAction({ kind: "clipboard-has-image" })) === true;
}
export async function readClipboardImage(): Promise<ImageBitmap | null> {
  const data = await hostAction({ kind: "clipboard-image" });
  if (typeof data !== "string" || !data.startsWith("data:image/")) return null;
  const [header, base64 = ""] = data.split(",", 2);
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return createImageBitmap(
    new Blob([bytes], { type: header?.slice(5).split(";")[0] ?? "image/png" }),
  );
}

// Saving needs the app's own share sheet, which the web view cannot reach yet; the shared UI hides
// its Download buttons here.
export const canSaveFiles = false;
export interface FileToSave {
  name: string;
  mime: string;
  data: string | Uint8Array;
}
export async function saveFile(): Promise<never> {
  throw new Error("Save files from the Concors desktop app.");
}

// A phone cannot keep an SSH private key for the person's own terminal. With no device key the
// shared machine UI shows the plain command once a key exists, or points to Settings.
export const deviceSshKey = {
  find: async () => null,
  create: async (): Promise<never> => {
    throw new Error("Set up SSH from the Concors desktop app.");
  },
} as const;

// The app store updates the mobile app; nothing in the shared UI should offer to do it here.
export const appUpdate = {
  installation: async () => ({
    kind: "unknown" as const,
    formats: [],
    platform: "unknown",
    arch: "unknown",
  }),
  install: async (): Promise<never> => {
    throw new Error("The mobile app updates through the app store.");
  },
} as const;

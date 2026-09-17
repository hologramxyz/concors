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

export { readText as readClipboardText, copyText as writeClipboardText } from "@/lib/clipboard";

// A phone cannot keep an SSH private key for the person's own terminal. With no device key the
// shared machine UI shows the plain command once a key exists, or points to Settings.
export const deviceSshKey = {
  find: async () => null,
  create: async (): Promise<never> => {
    throw new Error("Set up SSH from the Concors desktop app.");
  },
} as const;

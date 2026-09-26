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

export { readText as readClipboardText, copyText as writeClipboardText } from "@/lib/clipboard";
// Mobile paste events carry images as files, so there is nothing to read natively.
export async function readClipboardImage(): Promise<ImageData | null> {
  return null;
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

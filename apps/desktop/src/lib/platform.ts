export type Platform = "macos" | "windows" | "linux" | "unknown";

/** Best-effort host OS detection from the webview user agent (no Tauri API needed). */
export function detectPlatform(): Platform {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac/i.test(ua)) return "macos";
  if (/Win/i.test(ua)) return "windows";
  if (/Linux/i.test(ua)) return "linux";
  return "unknown";
}

export const PLATFORM: Platform = detectPlatform();

/** Display label for the primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export const MOD_KEY = PLATFORM === "macos" ? "⌘" : "Ctrl";

/** Joins the modifier with a key for display, e.g. "⌘K" or "Ctrl+K". */
export function modShortcut(key: string): string {
  return PLATFORM === "macos" ? `${MOD_KEY}${key}` : `${MOD_KEY}+${key}`;
}

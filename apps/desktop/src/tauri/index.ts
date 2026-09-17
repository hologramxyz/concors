/**
 * The only place in the desktop frontend allowed to import `@tauri-apps/*` (enforced by ESLint).
 *
 * Everything the UI needs from the native shell is exposed through this module with plain
 * TypeScript types, so the rest of the app can run unchanged in a browser or be ported to another
 * host.
 */
import { isTauri as tauriIsTauri } from "@tauri-apps/api/core";

export { localDaemon, type DaemonIdentity, type LocalDaemonStatus } from "./local-daemon.ts";
export { openExternal } from "./open-external.ts";
export { deviceSshKey, type DeviceSshKey } from "./device-ssh-key.ts";
export {
  startSignInListener,
  type SignInCallback,
  type SignInListener,
} from "./sign-in-listener.ts";

/** `true` when running inside the Tauri webview, `false` in a plain browser (`pnpm desktop:web:dev`). */
export function isTauri(): boolean {
  return tauriIsTauri();
}
export {
  showNativeNotification,
  dismissNativeNotification,
  onNativeNotificationClick,
} from "./notifications";

export { nativeWindow, type WindowChromeState, type ResizeDirection } from "./window";

export { readClipboardText, writeClipboardText } from "./clipboard";

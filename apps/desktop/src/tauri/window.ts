import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PLATFORM } from "@/lib/platform";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];

export interface WindowChromeState {
  enabled: boolean;
  /** macOS draws its traffic lights over the top of the page (titleBarStyle "Overlay"). */
  inset: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

export const nativeWindow = {
  async state(): Promise<WindowChromeState> {
    if (!isTauri()) return { enabled: false, inset: false, maximized: false, fullscreen: false };
    const window = getCurrentWindow();
    const [decorated, maximized, fullscreen] = await Promise.all([
      window.isDecorated(),
      window.isMaximized(),
      window.isFullscreen(),
    ]);
    return { enabled: !decorated, inset: decorated && PLATFORM === "macos", maximized, fullscreen };
  },
  async subscribe(changed: () => void): Promise<() => void> {
    const window = getCurrentWindow();
    return window.onResized(changed);
  },
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  /** Does what macOS is set to do when a title bar is double-clicked. */
  titleBarDoubleClick: () => invoke("title_bar_double_click"),
  resize: (direction: ResizeDirection) => getCurrentWindow().startResizeDragging(direction),
  /**
   * Gives the native frame the app's appearance. Otherwise a dark app under a light system theme
   * keeps a light frame, whose bright top rim shows above the unified title bar.
   */
  setTheme: (theme: "light" | "dark") =>
    isTauri() && PLATFORM === "macos" ? getCurrentWindow().setTheme(theme) : Promise.resolve(),
};
export type { ResizeDirection };

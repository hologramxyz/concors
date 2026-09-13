import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>["startResizeDragging"]>[0];

export interface WindowChromeState {
  enabled: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

export const nativeWindow = {
  async state(): Promise<WindowChromeState> {
    if (!isTauri()) return { enabled: false, maximized: false, fullscreen: false };
    const window = getCurrentWindow();
    const [decorated, maximized, fullscreen] = await Promise.all([
      window.isDecorated(),
      window.isMaximized(),
      window.isFullscreen(),
    ]);
    return { enabled: !decorated, maximized, fullscreen };
  },
  async subscribe(changed: () => void): Promise<() => void> {
    const window = getCurrentWindow();
    return window.onResized(changed);
  },
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  resize: (direction: ResizeDirection) => getCurrentWindow().startResizeDragging(direction),
};
export type { ResizeDirection };

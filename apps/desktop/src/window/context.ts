import { createContext, useContext } from "react";
import type { WindowChromeState, nativeWindow } from "@/tauri";

export const WindowChromeContext = createContext<
  WindowChromeState & {
    actions?: Pick<typeof nativeWindow, "minimize" | "toggleMaximize" | "close">;
  }
>({
  enabled: false,
  maximized: false,
  fullscreen: false,
});
export const useWindowChrome = () => useContext(WindowChromeContext);

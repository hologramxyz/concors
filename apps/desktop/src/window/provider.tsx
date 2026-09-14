import { useEffect, useState, type ReactNode } from "react";
import { nativeWindow, type WindowChromeState, type ResizeDirection } from "@/tauri";
import { WindowChromeContext } from "./context";

const edges: [ResizeDirection, string][] = [
  ["North", "inset-x-2 top-0 h-1 cursor-n-resize"],
  ["South", "inset-x-2 bottom-0 h-1 cursor-s-resize"],
  ["West", "inset-y-2 left-0 w-1 cursor-w-resize"],
  ["East", "inset-y-2 right-0 w-1 cursor-e-resize"],
  ["NorthWest", "left-0 top-0 size-2 cursor-nw-resize"],
  ["NorthEast", "right-0 top-0 size-2 cursor-ne-resize"],
  ["SouthWest", "left-0 bottom-0 size-2 cursor-sw-resize"],
  ["SouthEast", "right-0 bottom-0 size-2 cursor-se-resize"],
];

export function WindowChromeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WindowChromeState>({
    enabled: false,
    maximized: false,
    fullscreen: false,
  });
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const refresh = async () => {
      const next = await nativeWindow.state();
      if (!cancelled) setState(next);
      return next;
    };
    void (async () => {
      const initial = await refresh();
      if (cancelled || !initial.enabled) return;
      const stop = await nativeWindow.subscribe(() => {
        void refresh().catch(console.error);
      });
      if (cancelled) stop();
      else {
        unsubscribe = stop;
        await refresh();
      }
    })().catch(console.error);
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
  return (
    <WindowChromeContext value={{ ...state, actions: nativeWindow }}>
      {children}
      {state.enabled &&
        !state.maximized &&
        !state.fullscreen &&
        edges.map(([direction, className]) => (
          <div
            key={direction}
            aria-hidden="true"
            data-window-resize={direction}
            className={`fixed z-[60] touch-none ${className}`}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              void nativeWindow.resize(direction).catch(console.error);
            }}
          />
        ))}
    </WindowChromeContext>
  );
}

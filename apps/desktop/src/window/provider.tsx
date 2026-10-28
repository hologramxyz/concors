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
    inset: false,
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
      if (cancelled || !(initial.enabled || initial.inset)) return;
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
  const trafficLights = state.inset && !state.fullscreen;
  useEffect(() => {
    if (!state.inset) return;
    const doubleClick = (event: MouseEvent) => {
      if (event.button === 0 && isDragRegion(event.composedPath()))
        void nativeWindow.titleBarDoubleClick().catch(console.error);
    };
    document.addEventListener("dblclick", doubleClick);
    return () => document.removeEventListener("dblclick", doubleClick);
  }, [state.inset]);
  // Lets styles.css make room for the traffic lights where React does not know the layout.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-traffic-lights", trafficLights);
  }, [trafficLights]);
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

/** The same rule Tauri's drag script uses to decide whether a press lands on a drag region. */
function isDragRegion(path: EventTarget[]) {
  for (const element of path) {
    if (!(element instanceof HTMLElement)) continue;
    const region = element.getAttribute("data-tauri-drag-region");
    const clickable =
      /^(A|BUTTON|INPUT|SELECT|TEXTAREA|LABEL|SUMMARY)$/.test(element.tagName) ||
      element.isContentEditable ||
      (element.hasAttribute("tabindex") && element.getAttribute("tabindex") !== "-1") ||
      /^(button|link|menuitem|tab|checkbox|radio|switch|option)$/.test(
        element.getAttribute("role") ?? "",
      );
    if (clickable && region === null) return false;
    if (region === null) continue;
    if (region === "false") return false;
    if (region === "deep") return true;
    if (region === "" || region === "true") return element === path[0];
  }
  return false;
}

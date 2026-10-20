import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

/** 1 is the preview's fit: a PDF's pages at the tab's width, an image whole in the tab. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;
const STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** The next step up or down from any zoom, including one a pinch left between steps. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next =
    direction > 0
      ? STEPS.find((step) => step > zoom + 0.001)
      : STEPS.findLast((step) => step < zoom - 0.001);
  return next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM);
}

/** ⌘/Ctrl with + or =, − and 0, as a browser zooms a page: the zoom it asks for, or null. */
export function zoomKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
  zoom: number,
): number | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  if (event.key === "+" || event.key === "=") return stepZoom(zoom, 1);
  if (event.key === "-" || event.key === "_") return stepZoom(zoom, -1);
  if (event.key === "0") return 1;
  return null;
}

/**
 * Pinching a trackpad, or Ctrl with the scroll wheel, zooms the preview instead of the page.
 * Chromium and WebKitGTK report a pinch as a wheel event with Ctrl held; macOS's WebKit reports
 * gesture events instead. Both listeners are non-passive so the webview does not also zoom.
 */
export function useZoomGestures(
  target: RefObject<HTMLElement | null>,
  zoom: number,
  setZoom: (zoom: number) => void,
) {
  const latest = useRef({ zoom, setZoom });
  useEffect(() => {
    latest.current = { zoom, setZoom };
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    let start = 1;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const { zoom, setZoom } = latest.current;
      setZoom(clampZoom(zoom * Math.exp(-event.deltaY * 0.01)));
    };
    const gestureStart = (event: Event) => {
      event.preventDefault();
      start = latest.current.zoom;
    };
    const gestureChange = (event: Event) => {
      event.preventDefault();
      const scale = (event as Event & { scale?: number }).scale ?? 1;
      latest.current.setZoom(clampZoom(start * scale));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("gesturestart", gestureStart);
    element.addEventListener("gesturechange", gestureChange);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("gesturestart", gestureStart);
      element.removeEventListener("gesturechange", gestureChange);
    };
  }, [target]);
}

/**
 * Keeps the point at the middle of a scrolled preview there as its content grows or shrinks with
 * the zoom, so zooming does not jump back to the first page.
 */
export function useZoomAnchor(target: RefObject<HTMLElement | null>, zoom: number) {
  const anchor = useRef({ x: 0.5, y: 0 });
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const record = () => {
      anchor.current = {
        x: (element.scrollLeft + element.clientWidth / 2) / Math.max(1, element.scrollWidth),
        y: (element.scrollTop + element.clientHeight / 2) / Math.max(1, element.scrollHeight),
      };
    };
    element.addEventListener("scroll", record, { passive: true });
    return () => element.removeEventListener("scroll", record);
  }, [target]);
  const first = useRef(true);
  // Before paint, so the preview never shows a frame scrolled to the wrong place.
  useLayoutEffect(() => {
    const element = target.current;
    if (first.current || !element) {
      first.current = false;
      return;
    }
    const { x, y } = anchor.current;
    element.scrollTo({
      left: x * element.scrollWidth - element.clientWidth / 2,
      top: y * element.scrollHeight - element.clientHeight / 2,
    });
  }, [target, zoom]);
}

import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  clampView,
  doubleTap,
  FIT,
  pinch,
  type Point,
  type ZoomBounds,
  type ZoomView,
} from "./pinch-zoom";

const DOUBLE_TAP_MS = 300;
/** Further than this and a touch is a drag, not a tap. */
const TAP_SLOP = 10;

/**
 * An image filling the space it is given, for a phone: pinch to zoom, drag to pan once zoomed,
 * double tap to zoom in on a point and back out. The page itself never scrolls or zooms with it.
 */
export function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const space = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [room, setRoom] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<ZoomView>(FIT);
  /** Eased only for taps; a finger's own movement must follow it exactly. */
  const [easing, setEasing] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{
    view: ZoomView;
    mid: Point;
    distance: number;
    moved: boolean;
    pointers: number;
  } | null>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);

  useEffect(() => {
    const element = space.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRoom({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fit =
    natural && room ? Math.min(1, room.width / natural.width, room.height / natural.height) : null;
  const bounds: ZoomBounds | null =
    natural && room && fit !== null
      ? {
          width: room.width,
          height: room.height,
          fitWidth: natural.width * fit,
          fitHeight: natural.height * fit,
        }
      : null;

  /** A pointer's position from the centre of the space. */
  const local = (event: PointerEvent<HTMLDivElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - box.left - box.width / 2,
      y: event.clientY - box.top - box.height / 2,
    };
  };
  const spread = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a) return { mid: { x: 0, y: 0 }, distance: 0 };
    if (!b) return { mid: a, distance: 0 };
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };
  /** Every change in the number of fingers starts the gesture again from where the image is. */
  const restart = (current: ZoomView, moved: boolean) => {
    gesture.current = pointers.current.size
      ? { view: current, ...spread(), moved, pointers: pointers.current.size }
      : null;
  };

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!bounds) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    setEasing(false);
    restart(view, (gesture.current?.moved ?? false) || pointers.current.size > 1);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!bounds || !pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, local(event));
    const start = gesture.current;
    const now = spread();
    if (Math.hypot(now.mid.x - start.mid.x, now.mid.y - start.mid.y) > TAP_SLOP) start.moved = true;
    if (pointers.current.size >= 2) setView(pinch(start.view, start, now, bounds));
    // One finger pans only a zoomed image; at the fit there is nowhere to go.
    else if (start.view.scale > 1)
      setView(
        clampView(
          {
            ...start.view,
            x: start.view.x + now.mid.x - start.mid.x,
            y: start.view.y + now.mid.y - start.mid.y,
          },
          bounds,
        ),
      );
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = local(event);
    pointers.current.delete(event.pointerId);
    const ended = gesture.current;
    restart(view, true);
    if (!bounds || pointers.current.size || !ended || ended.moved || ended.pointers > 1) {
      if (!pointers.current.size) lastTap.current = null;
      return;
    }
    const previous = lastTap.current;
    if (
      previous &&
      event.timeStamp - previous.at < DOUBLE_TAP_MS &&
      Math.hypot(point.x - previous.point.x, point.y - previous.point.y) < TAP_SLOP * 3
    ) {
      lastTap.current = null;
      setEasing(true);
      setView(doubleTap(view, point, bounds));
    } else lastTap.current = { at: event.timeStamp, point };
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    restart(view, true);
  };

  return (
    <div
      ref={space}
      data-zoomable-image
      data-zoomed={view.scale > 1 || undefined}
      className="relative flex size-full touch-none items-center justify-center overflow-hidden select-none"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(event) =>
          setNatural({
            width: event.currentTarget.naturalWidth || 1,
            height: event.currentTarget.naturalHeight || 1,
          })
        }
        className={`block max-w-none shrink-0 will-change-transform ${easing ? "transition-transform duration-200 ease-out" : ""}`}
        style={
          bounds
            ? {
                width: bounds.fitWidth,
                height: bounds.fitHeight,
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              }
            : { maxWidth: "100%", maxHeight: "100%" }
        }
      />
    </div>
  );
}

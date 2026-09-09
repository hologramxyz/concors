import { useRef, useState, type PointerEvent } from "react";

export function useSidebarGesture(open: boolean, onChange: (open: boolean) => void, width: number) {
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    start: number;
    moved: boolean;
  } | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const suppressClickUntil = useRef(0);
  const finish = (event: PointerEvent, cancelled = false) => {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    if (!cancelled && current.moved) {
      suppressClickUntil.current = performance.now() + 400;
      const delta = event.clientX - current.x;
      onChange(open ? delta > -width * 0.25 : delta > width * 0.25);
    }
    gesture.current = null;
    setOffset(null);
  };
  return {
    offset: offset ?? (open ? width : 0),
    dragging: offset !== null,
    handlers: {
      onPointerDown(event: PointerEvent) {
        if (event.pointerType === "mouse" || event.button !== 0) return;
        const target = event.target as HTMLElement;
        // React portals bubble through this shell, but their popups own their gestures.
        if (!event.currentTarget.contains(target)) return;
        if (
          !open &&
          target.closest(
            "input, textarea, select, button, a, pre, .concors-terminal, [role=dialog], [role=menu]",
          )
        )
          return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          start: open ? width : 0,
          moved: false,
        };
      },
      onPointerMove(event: PointerEvent) {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const x = event.clientX - current.x,
          y = event.clientY - current.y;
        if (!current.moved && Math.abs(y) > Math.abs(x) && Math.abs(y) > 8) {
          gesture.current = null;
          return;
        }
        if (Math.abs(x) < 12 && !current.moved) return;
        current.moved = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setOffset(Math.min(width, Math.max(0, current.start + x)));
      },
      onPointerUp: finish,
      onPointerCancel: (event: PointerEvent) => finish(event, true),
      onClickCapture(event: React.MouseEvent) {
        if (offset !== null || performance.now() < suppressClickUntil.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}

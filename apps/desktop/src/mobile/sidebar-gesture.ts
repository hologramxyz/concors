import { useRef, useState, type PointerEvent } from "react";

export function useSidebarGesture(
  open: boolean,
  onChange: (open: boolean) => void,
  width: number,
  {
    direction = 1,
    enabled = true,
    protectInputs = false,
  }: { direction?: 1 | -1; enabled?: boolean; protectInputs?: boolean } = {},
) {
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
      const delta = (event.clientX - current.x) * direction;
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
        // A new deliberate tap is not the synthetic click following the last drag.
        if (event.isPrimary) suppressClickUntil.current = 0;
        if (!enabled || event.pointerType === "mouse" || event.button !== 0) return;
        if (!event.isPrimary) {
          gesture.current = null;
          setOffset(null);
          return;
        }
        const target = event.target as HTMLElement;
        // React portals bubble through this shell, but their popups own their gestures.
        if (!event.currentTarget.contains(target)) return;
        // Popup triggers can open on pointer-down, before a drag is recognized.
        // They must keep the entire gesture instead of leaving a menu behind a closed sidebar.
        if (target.closest('[aria-haspopup]:not([aria-haspopup="false"])')) return;
        // xterm's hidden textarea is part of its surface, not a composer/editor.
        // Navigation can start there too; only claim a clear horizontal gesture.
        const terminal = target.closest(".concors-terminal");
        // The Files title/back controls also act as a drag handle. A tap still
        // reaches the button; an intentional swipe suppresses its trailing click.
        const fileHeader = target.closest(".mobile-files-header");
        if (
          (!open || protectInputs) &&
          (target.closest(".cm-editor, [role=dialog], [role=menu]") ||
            (!fileHeader && target.closest("button, a")) ||
            (!terminal && target.closest("input, textarea, select, pre, [contenteditable]")))
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
        const x = (event.clientX - current.x) * direction,
          y = event.clientY - current.y;
        if (!current.moved && !open && x < -8) {
          gesture.current = null;
          return;
        }
        if (!current.moved && Math.abs(y) > Math.abs(x) && Math.abs(y) > 8) {
          gesture.current = null;
          return;
        }
        if (Math.abs(x) < 12 && !current.moved) return;
        if (!current.moved && Math.abs(x) < Math.abs(y) * 1.5) return;
        current.moved = true;
        // Run in the shell's capture phase, before terminal handlers can consume
        // the gesture. Vertical scrolling, taps and input are left untouched.
        event.preventDefault();
        event.stopPropagation();
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

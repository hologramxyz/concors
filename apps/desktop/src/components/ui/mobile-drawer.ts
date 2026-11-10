import { useLayoutEffect, useRef, type RefObject } from "react";

/** One pan implementation for every compact DialogContent, including nested sheets.
 * A scrolled list keeps its gesture; a fresh downward pull at its top moves the sheet.
 * Native touch listeners let WKWebView yield before starting rubber-band scrolling.
 */
export function useMobileDrawerGesture(
  sheet: HTMLDivElement | null,
  overlay: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  open: boolean,
  onDismiss: () => void,
) {
  const dismiss = useRef(onDismiss);
  useLayoutEffect(() => {
    dismiss.current = onDismiss;
  });
  useLayoutEffect(() => {
    if (!enabled || !open || !sheet) return;
    let gesture: { id: number; x: number; y: number; time: number; offset: number } | null = null;
    let suppressClick = false;
    const backdrop = overlay.current;
    const move = (offset: number, dragging: boolean) => {
      sheet.dataset.mobileDrawerDragged = "true";
      sheet.dataset.dragging = String(dragging);
      sheet.style.setProperty("--mobile-drawer-offset", `${offset}px`);
      if (backdrop) {
        backdrop.dataset.mobileDrawerDragged = "true";
        backdrop.dataset.dragging = String(dragging);
        backdrop.style.setProperty(
          "--mobile-drawer-progress",
          String(Math.min(1, offset / sheet.getBoundingClientRect().height)),
        );
      }
    };
    const cancel = () => {
      if (gesture?.offset) move(0, false);
      gesture = null;
    };
    const start = (event: TouchEvent) => {
      suppressClick = false;
      cancel();
      const target = event.target;
      if (
        event.touches.length !== 1 ||
        !(target instanceof Element) ||
        target.closest('[data-slot="dialog-content"]') !== sheet ||
        target.closest('input, textarea, select, [contenteditable="true"], [role="slider"]')
      )
        return;
      // A drag on the handle/header always works. Elsewhere, preserve the innermost scroller.
      if (!target.closest('.mobile-drawer-handle, [data-slot="dialog-header"]')) {
        for (let node: Element | null = target; node; node = node.parentElement) {
          if (node.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(node).overflowY)) return;
          if (node === sheet) break;
        }
      }
      const touch = event.touches[0]!;
      gesture = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
        offset: 0,
      };
    };
    const pan = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = [...event.touches].find((touch) => touch.identifier === gesture?.id);
      if (!touch || event.touches.length !== 1) return cancel();
      const x = Math.abs(touch.clientX - gesture.x);
      const y = touch.clientY - gesture.y;
      if (!gesture.offset) {
        if (y < -8 || (x > 8 && x > y)) return cancel();
        if (y < 8 || y < x * 1.2) return;
        if (!event.cancelable) return cancel();
      }
      event.preventDefault();
      gesture.offset = Math.max(0, y);
      suppressClick = true;
      move(gesture.offset, true);
    };
    const end = () => {
      if (!gesture) return;
      const { offset, time } = gesture;
      const threshold = Math.min(120, Math.max(64, sheet.getBoundingClientRect().height * 0.22));
      const velocity = offset / Math.max(1, performance.now() - time);
      if (offset > threshold || (offset > 40 && velocity > 0.6)) {
        move(offset, false);
        gesture = null;
        dismiss.current();
        // A form may veto closing while it saves. It must still return to its resting position.
        requestAnimationFrame(() => {
          if (sheet.dataset.state === "open") move(0, false);
        });
      } else cancel();
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
      suppressClick = false;
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", pan, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", cancel);
    sheet.addEventListener("click", click, true);
    window.addEventListener("blur", cancel);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", pan);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", cancel);
      sheet.removeEventListener("click", click, true);
      window.removeEventListener("blur", cancel);
    };
  }, [sheet, overlay, enabled, open]);
}

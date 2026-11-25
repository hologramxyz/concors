import { useEffect, useRef, type ReactNode, type RefObject } from "react";

/**
 * Hides a scroller's own scrollbar. WebKit (the Mac and Linux webviews) and Chromium (Windows)
 * give a styled scrollbar layout width, so a centred chat moved sideways whenever it started or
 * stopped being able to scroll. `OverlayScrollbar` draws the thumb over the content instead.
 */
export const HIDE_NATIVE_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

/** The shared scrollbar's thumb (styles.css): its shortest length and its inset in the track. */
const MIN_THUMB = 24;
const INSET = 2;
/** How long the thumb stays after the last scroll before it fades. */
const LINGER = 1000;
/** How close to the scroller's edge the pointer brings the thumb out. */
const EDGE = 12;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

/**
 * A thin thumb over a scroller's right edge, out of sight at rest. It shows while the reader
 * scrolls (wheel, touch, keys, dragging it) or points near the edge, and fades shortly after,
 * with the shared scrollbar's colours and the app's 200ms ease; reduced motion shows and hides
 * it at once. Scrolling the content itself (following a stream) moves it without showing it.
 *
 * Rendered beside the scroller, in a positioned parent that the scroller fills.
 */
export function OverlayScrollbar({ target }: { target: RefObject<HTMLElement | null> }) {
  const thumb = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = target.current;
    const bar = thumb.current;
    if (!scroller || !bar) return;
    let frame = 0;
    let linger = 0;
    let near = false;
    let drag: { y: number; top: number; ratio: number } | null = null;
    const place = () => {
      frame = 0;
      const { scrollTop, scrollHeight, clientHeight, offsetHeight, offsetTop } = scroller;
      const range = scrollHeight - clientHeight;
      if (range <= 1) {
        bar.hidden = true;
        return;
      }
      bar.hidden = false;
      const track = offsetHeight - INSET * 2;
      const height = Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight);
      bar.style.height = `${height}px`;
      bar.style.transform = `translateY(${offsetTop + INSET + (scrollTop / range) * (track - height)}px)`;
    };
    const update = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const show = () => {
      update();
      bar.dataset.visible = "";
      clearTimeout(linger);
      if (!drag && !near)
        linger = window.setTimeout(() => {
          delete bar.dataset.visible;
        }, LINGER);
    };
    const key = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) show();
    };
    const move = (event: MouseEvent) => {
      const edge = event.clientX >= scroller.getBoundingClientRect().right - EDGE;
      if (edge === near) return;
      near = edge;
      show();
    };
    const leave = () => {
      if (!near) return;
      near = false;
      show();
    };
    const grab = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      bar.setPointerCapture(event.pointerId);
      const track = scroller.offsetHeight - INSET * 2;
      const range = scroller.scrollHeight - scroller.clientHeight;
      drag = {
        y: event.clientY,
        top: scroller.scrollTop,
        ratio: range / (track - bar.offsetHeight),
      };
      // The chat's follow logic counts a press in the timeline as the reader taking over, as
      // dragging its own scrollbar did; tell it the same, so it does not pull back to the bottom.
      scroller.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "mouse" }));
      show();
    };
    const pull = (event: PointerEvent) => {
      if (drag) scroller.scrollTop = drag.top + (event.clientY - drag.y) * drag.ratio;
    };
    const drop = () => {
      drag = null;
      show();
    };
    const resize = new ResizeObserver(update);
    resize.observe(scroller);
    if (scroller.firstElementChild) resize.observe(scroller.firstElementChild);
    scroller.addEventListener("scroll", update, { passive: true });
    scroller.addEventListener("wheel", show, { passive: true });
    scroller.addEventListener("touchmove", show, { passive: true });
    scroller.addEventListener("keydown", key);
    scroller.addEventListener("mousemove", move, { passive: true });
    scroller.addEventListener("mouseleave", leave);
    bar.addEventListener("pointerdown", grab);
    bar.addEventListener("pointermove", pull);
    bar.addEventListener("pointerup", drop);
    bar.addEventListener("pointercancel", drop);
    update();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(linger);
      resize.disconnect();
      scroller.removeEventListener("scroll", update);
      scroller.removeEventListener("wheel", show);
      scroller.removeEventListener("touchmove", show);
      scroller.removeEventListener("keydown", key);
      scroller.removeEventListener("mousemove", move);
      scroller.removeEventListener("mouseleave", leave);
      bar.removeEventListener("pointerdown", grab);
      bar.removeEventListener("pointermove", pull);
      bar.removeEventListener("pointerup", drop);
      bar.removeEventListener("pointercancel", drop);
    };
  }, [target]);
  return (
    <div
      ref={thumb}
      hidden
      aria-hidden
      data-overlay-scrollbar
      className="pointer-events-none absolute top-0 right-0.5 z-10 w-1 rounded-full bg-[color-mix(in_srgb,var(--muted-foreground)_35%,transparent)] opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-[color-mix(in_srgb,var(--muted-foreground)_55%,transparent)] active:bg-[color-mix(in_srgb,var(--muted-foreground)_70%,transparent)] data-[visible]:pointer-events-auto data-[visible]:opacity-100 motion-reduce:transition-none"
    />
  );
}

/**
 * A scroll box whose scrollbar takes no width: `className` styles the box that scrolls, and the
 * thumb sits over its edge.
 */
export function OverlayScroll({ className, children }: { className: string; children: ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="relative flex min-h-0 flex-col">
      <div ref={scroller} className={`${className} ${HIDE_NATIVE_SCROLLBAR}`}>
        {children}
      </div>
      <OverlayScrollbar target={scroller} />
    </div>
  );
}

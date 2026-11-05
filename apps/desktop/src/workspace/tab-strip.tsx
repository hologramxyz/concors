import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  isTabReorder,
  overlapsStrip,
  revealedScrollLeft,
  tabStripFades,
  wheelScrollDelta,
} from "./tab-strip-scroll";

function activeRange(content: HTMLElement) {
  // Layout offsets, not rects: an opening or sliding tab's transform says nothing about where it
  // comes to rest.
  const active = content.querySelector<HTMLElement>("[data-active-tab]");
  return active && { left: active.offsetLeft, right: active.offsetLeft + active.offsetWidth };
}

/** Nudges an active tab cut by the edge back in. One scrolled wholly away is left there. */
function revealIfClipped(list: HTMLElement, content: HTMLElement) {
  // Not a tab on its way out: the one that replaces it gets its own scroll, once it is gone.
  if (content.querySelector("[data-active-tab].tab-closing")) return;
  const range = activeRange(content);
  if (range && overlapsStrip(list, range)) list.scrollLeft = revealedScrollLeft(list, range);
}

/**
 * The part of the tab bar that scrolls, without a scrollbar: fades mark the edges with more tabs
 * past them, and it keeps the active tab in view, clear of the fades. Scrolled there by hand, the
 * active tab goes under a fade like any other. What sits around the strip, such as the new-tab
 * button, is the caller's. Fade state lives here so scrolling repaints the fades and not the
 * workspace.
 */
export function TabStrip({
  listRef,
  scopeId,
  activeId,
  order,
  dragSlot,
  dragRegion,
  children,
}: {
  listRef: RefObject<HTMLDivElement | null>;
  /** Moving to another workspace jumps straight to its active tab. */
  scopeId: string;
  activeId: string | undefined;
  /** Every tab's ID in strip order, comma-separated. */
  order: string;
  /** Where the active tab will land while it is being dragged. */
  dragSlot: { left: number; right: number } | null;
  dragRegion: boolean;
  children: ReactNode;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [fades, setFades] = useState({ start: false, end: false });

  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content) return;
    const syncFades = () => {
      const next = tabStripFades(list);
      setFades((shown) => (shown.start === next.start && shown.end === next.end ? shown : next));
    };
    const onResize = () => {
      syncFades();
      revealIfClipped(list, content);
    };
    // Not React's onWheel, which is passive and could not stop the page taking the same event.
    const onWheel = (event: WheelEvent) => {
      const delta = wheelScrollDelta(event, list.clientWidth);
      if (!delta || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += delta;
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(list);
    observer.observe(content);
    list.addEventListener("scroll", syncFades, { passive: true });
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      list.removeEventListener("scroll", syncFades);
      list.removeEventListener("wheel", onWheel);
    };
  }, [listRef]);

  // A chat that titles itself or a rename can push the active tab's own close button out.
  useEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    const active = content?.querySelector("[data-active-tab]");
    if (!list || !content || !active) return;
    let first = true;
    const observer = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      revealIfClipped(list, content);
    });
    observer.observe(active);
    return () => observer.disconnect();
  }, [activeId, listRef]);

  const shown = useRef<{ scopeId: string; activeId: string | undefined; order: string } | null>(
    null,
  );
  useLayoutEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    const before = shown.current;
    shown.current = { scopeId, activeId, order };
    if (!list || !content) return;
    const range = activeRange(content);
    if (!range) return;
    if (!before || before.scopeId !== scopeId) {
      list.scrollLeft = revealedScrollLeft(list, range);
    } else if (before.activeId !== activeId || isTabReorder(before.order, order)) {
      list.scrollTo({
        left: revealedScrollLeft(list, range),
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    } else {
      // Tabs came or went. Someone closing tabs at the far end stays there.
      revealIfClipped(list, content);
    }
  }, [listRef, scopeId, activeId, order]);

  const dragLeft = dragSlot?.left;
  const dragRight = dragSlot?.right;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || dragLeft === undefined || dragRight === undefined) return;
    list.scrollLeft = revealedScrollLeft(list, { left: dragLeft, right: dragRight });
  }, [listRef, dragLeft, dragRight]);

  const region = dragRegion ? "true" : undefined;
  return (
    <div className="relative flex min-w-0" data-tauri-drag-region={region}>
      <div
        ref={listRef}
        className="tab-strip min-w-0 flex-auto overflow-x-auto"
        data-tauri-drag-region={region}
      >
        <div
          ref={contentRef}
          className="relative flex w-max items-center gap-1"
          data-tauri-drag-region={region}
        >
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        data-tab-fade="start"
        data-visible={fades.start}
        className="tab-strip-fade left-0 bg-linear-to-r from-background to-transparent"
      />
      <div
        aria-hidden="true"
        data-tab-fade="end"
        data-visible={fades.end}
        className="tab-strip-fade right-0 bg-linear-to-l from-background to-transparent"
      />
    </div>
  );
}

/** How wide each edge fade is; matches `.tab-strip-fade` in styles.css. */
export const TAB_FADE_PX = 28;

/** How far the strip moves per dragover while a dragged tab is held at one of its edges. */
const DRAG_SCROLL_PX = 12;

const WHEEL_LINE_PX = 16;

interface StripView {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

interface StripRange {
  left: number;
  right: number;
}

/** Which edges have tabs past them. A pixel of slack absorbs fractional scrolling on Retina. */
export function tabStripFades({ scrollLeft, clientWidth, scrollWidth }: StripView) {
  return { start: scrollLeft > 1, end: scrollLeft + clientWidth < scrollWidth - 1 };
}

/**
 * Where the strip must scroll for `range` to clear the fades. A fade is only drawn where there is
 * more to scroll, so clamping leaves the first and last tabs flush with the edge. A tab too wide
 * for the strip keeps its right end in view, where its close button is.
 */
export function revealedScrollLeft(view: StripView, { left, right }: StripRange) {
  let target = view.scrollLeft;
  if (left - TAB_FADE_PX < target) target = left - TAB_FADE_PX;
  if (right + TAB_FADE_PX > target + view.clientWidth)
    target = right + TAB_FADE_PX - view.clientWidth;
  return Math.max(0, Math.min(target, view.scrollWidth - view.clientWidth));
}

/** A tab scrolled wholly away was the person's choice; a tab cut by the edge is an accident. */
export function overlapsStrip(view: StripView, { left, right }: StripRange) {
  return right > view.scrollLeft && left < view.scrollLeft + view.clientWidth;
}

/**
 * How far a wheel event moves the strip by hand. Mostly-horizontal input gets 0: trackpad swipes,
 * and Shift+wheel where the system already turned it sideways, scroll natively with their momentum.
 */
export function wheelScrollDelta(
  { deltaX, deltaY, deltaMode }: { deltaX: number; deltaY: number; deltaMode: number },
  pageWidth: number,
) {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return 0;
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === 2) return deltaY * pageWidth;
  return deltaY;
}

/** Holding a dragged tab at an edge, or past the right one over "+", brings more tabs in. */
export function tabDragEdgeScroll(clientX: number, strip: StripRange) {
  if (clientX < strip.left + TAB_FADE_PX) return -DRAG_SCROLL_PX;
  if (clientX > strip.right - TAB_FADE_PX) return DRAG_SCROLL_PX;
  return 0;
}

/** The same tabs in another order, as opposed to tabs opening or closing. */
export function isTabReorder(previous: string, next: string) {
  return previous !== next && previous.split(",").sort().join() === next.split(",").sort().join();
}

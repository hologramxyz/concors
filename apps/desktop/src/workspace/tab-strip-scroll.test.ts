import { expect, it } from "vitest";
import {
  TAB_FADE_PX,
  isTabReorder,
  overlapsStrip,
  revealedScrollLeft,
  tabDragEdgeScroll,
  tabStripFades,
  wheelScrollDelta,
} from "./tab-strip-scroll";

const view = (scrollLeft: number) => ({ scrollLeft, clientWidth: 500, scrollWidth: 1500 });

it("fades only the edges with tabs past them", () => {
  expect(tabStripFades(view(0))).toEqual({ start: false, end: true });
  expect(tabStripFades(view(400))).toEqual({ start: true, end: true });
  expect(tabStripFades(view(1000))).toEqual({ start: true, end: false });
  expect(tabStripFades({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 })).toEqual({
    start: false,
    end: false,
  });
  // Retina scroll positions stop just short of the end.
  expect(tabStripFades(view(999.5)).end).toBe(false);
});

it("reveals a tab clear of the fades, and leaves one already clear where it is", () => {
  expect(revealedScrollLeft(view(400), { left: 500, right: 600 })).toBe(400);
  expect(revealedScrollLeft(view(400), { left: 410, right: 510 })).toBe(410 - TAB_FADE_PX);
  expect(revealedScrollLeft(view(400), { left: 800, right: 890 })).toBe(890 + TAB_FADE_PX - 500);
});

it("lets the first and last tabs sit flush with the edge", () => {
  expect(revealedScrollLeft(view(400), { left: 0, right: 100 })).toBe(0);
  expect(revealedScrollLeft(view(400), { left: 1400, right: 1500 })).toBe(1000);
});

it("keeps the close button of a tab wider than the strip", () => {
  const narrow = { scrollLeft: 0, clientWidth: 100, scrollWidth: 1000 };
  expect(revealedScrollLeft(narrow, { left: 300, right: 500 })).toBe(500 + TAB_FADE_PX - 100);
});

it("tells a clipped tab from one scrolled away", () => {
  expect(overlapsStrip(view(400), { left: 380, right: 480 })).toBe(true);
  expect(overlapsStrip(view(400), { left: 500, right: 600 })).toBe(true);
  expect(overlapsStrip(view(400), { left: 100, right: 200 })).toBe(false);
  expect(overlapsStrip(view(400), { left: 1000, right: 1100 })).toBe(false);
});

it("turns a vertical wheel sideways and leaves horizontal input to the browser", () => {
  expect(wheelScrollDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 500)).toBe(100);
  expect(wheelScrollDelta({ deltaX: 0, deltaY: -3, deltaMode: 1 }, 500)).toBe(-48);
  expect(wheelScrollDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 500)).toBe(500);
  expect(wheelScrollDelta({ deltaX: 40, deltaY: 2, deltaMode: 0 }, 500)).toBe(0);
  expect(wheelScrollDelta({ deltaX: 0, deltaY: 0, deltaMode: 0 }, 500)).toBe(0);
});

it("scrolls under a dragged tab only at the edges, including past the right one", () => {
  const strip = { left: 100, right: 600 };
  expect(tabDragEdgeScroll(110, strip)).toBeLessThan(0);
  expect(tabDragEdgeScroll(350, strip)).toBe(0);
  expect(tabDragEdgeScroll(590, strip)).toBeGreaterThan(0);
  expect(tabDragEdgeScroll(700, strip)).toBeGreaterThan(0);
});

it("recognises a reorder as the same tabs in another order", () => {
  expect(isTabReorder("a,b,c", "b,a,c")).toBe(true);
  expect(isTabReorder("a,b,c", "a,b,c")).toBe(false);
  expect(isTabReorder("a,b,c", "a,c")).toBe(false);
  expect(isTabReorder("a,b", "a,b,c")).toBe(false);
});

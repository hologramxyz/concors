import { expect, it } from "vitest";
import { clampView, doubleTap, FIT, MAX_SCALE, pinch, zoomAt, type ZoomBounds } from "./pinch-zoom";

// A phone-sized space showing a wide screenshot fitted to its width.
const bounds: ZoomBounds = { width: 400, height: 800, fitWidth: 400, fitHeight: 250 };

it("keeps the image at least at its fit and its edges on screen", () => {
  expect(clampView({ scale: 0.5, x: 50, y: 50 }, bounds)).toEqual(FIT);
  expect(clampView({ scale: 20, x: 0, y: 0 }, bounds).scale).toBe(MAX_SCALE);
  // At 2x the image is 800 wide: 200px spare on each side, and still shorter than the space.
  expect(clampView({ scale: 2, x: 500, y: 300 }, bounds)).toEqual({ scale: 2, x: 200, y: 0 });
});

it("zooms about the point under the finger", () => {
  // The image's right edge, 200px right of centre, stays put while doubling.
  const view = zoomAt(FIT, 2, { x: 200, y: 0 }, bounds);
  expect(view).toEqual({ scale: 2, x: -200, y: 0 });
  expect(view.x + 2 * 200).toBe(200);
});

it("follows two fingers: their spread scales, their midpoint pans", () => {
  const start = { scale: 2, x: 0, y: 0 };
  const from = { mid: { x: 0, y: 0 }, distance: 100 };
  expect(pinch(start, from, { mid: { x: 0, y: 0 }, distance: 150 }, bounds)).toEqual({
    scale: 3,
    x: 0,
    y: 0,
  });
  expect(pinch(start, from, { mid: { x: 60, y: 0 }, distance: 100 }, bounds)).toEqual({
    scale: 2,
    x: 60,
    y: 0,
  });
  // Pinching in past the fit settles at the fit.
  expect(pinch(start, from, { mid: { x: 0, y: 0 }, distance: 10 }, bounds)).toEqual(FIT);
});

it("double tap zooms in on the tap, and out again", () => {
  const zoomed = doubleTap(FIT, { x: 100, y: 0 }, bounds);
  expect(zoomed.scale).toBe(2.5);
  expect(zoomed.x).toBe(100 - 100 * 2.5);
  expect(doubleTap(zoomed, { x: 0, y: 0 }, bounds)).toEqual(FIT);
});

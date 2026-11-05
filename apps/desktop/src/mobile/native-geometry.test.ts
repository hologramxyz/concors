import { expect, it } from "vitest";
import { clipNativeSurface, pinComposerToViewport } from "./native-geometry";

const viewport = { width: 390, height: 844 };
const main = { x: 0, y: 0, ...viewport };
const offscreenFiles = { ...main, x: 390 };
const button = { x: 12, y: 70, width: 44, height: 44 };

it("never paints sidebar search over a closing workspace", () => {
  const search = { ...button, x: 264 };
  expect(clipNativeSurface(search, "sidebar", viewport, main, offscreenFiles)).toBeNull();
  expect(
    clipNativeSurface(search, "sidebar", viewport, { ...main, x: 280 }, offscreenFiles),
  ).toEqual({ ...search, width: 16 });
});
it("keeps the translated workspace button visible beside sidebar search", () => {
  expect(
    clipNativeSurface(
      { ...button, x: 332 },
      "workspace",
      viewport,
      { ...main, x: 320 },
      offscreenFiles,
    ),
  ).toEqual({ ...button, x: 332 });
});
it("clips workspace controls as files slide over them", () => {
  const files = { ...main, x: 30 };
  expect(clipNativeSurface(button, "workspace", viewport, main, files)).toEqual({
    ...button,
    width: 18,
  });
  expect(clipNativeSurface(button, "workspace", viewport, main, main)).toBeNull();
});
it("shows incoming file controls before the gesture commits, and clips at the screen edge", () => {
  const files = { ...main, x: 350 };
  expect(clipNativeSurface({ ...button, x: 362 }, "files", viewport, main, files)).toEqual({
    ...button,
    x: 362,
    width: 28,
  });
  expect(
    clipNativeSurface({ ...button, x: 402 }, "files", viewport, main, offscreenFiles),
  ).toBeNull();
});
it("clips to the keyboard-reduced viewport without stretching the control", () => {
  expect(
    clipNativeSurface(
      { x: 12, y: 430, width: 366, height: 90 },
      "workspace",
      { width: 390, height: 480 },
      main,
      offscreenFiles,
    ),
  ).toEqual({ x: 12, y: 430, width: 366, height: 50 });
});

it("keeps the composer on screen when the viewport shrinks a frame ahead of layout", () => {
  const composer = { x: 0, y: 700, width: 390, height: 123 };
  const pinned = pinComposerToViewport(composer, 637);
  expect(pinned).toEqual({ ...composer, y: 514 });
  expect(
    clipNativeSurface(pinned, "workspace", { width: 390, height: 637 }, main, offscreenFiles),
  ).not.toBeNull();
  // Where it already fits, it stays exactly where layout put it.
  expect(pinComposerToViewport(composer, 844)).toEqual(composer);
});

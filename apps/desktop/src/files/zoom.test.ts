import { expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, stepZoom, zoomKey } from "./zoom";

it("steps to the next zoom either way, from a step or from between two after a pinch", () => {
  expect(stepZoom(1, 1)).toBe(1.1);
  expect(stepZoom(1, -1)).toBe(0.9);
  expect(stepZoom(1.18, 1)).toBe(1.25);
  expect(stepZoom(1.18, -1)).toBe(1.1);
  expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
  expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
});

it("reads ⌘/Ctrl with +, = , − and 0 as zoom keys, and nothing else", () => {
  const key = (k: string, mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }) =>
    zoomKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods }, 1.5);
  expect(key("=", { metaKey: true })).toBe(1.75);
  expect(key("+", { ctrlKey: true })).toBe(1.75);
  expect(key("-", { metaKey: true })).toBe(1.25);
  expect(key("0", { ctrlKey: true })).toBe(1);
  expect(key("=", {})).toBeNull();
  expect(key("=", { metaKey: true, altKey: true })).toBeNull();
  expect(key("a", { metaKey: true })).toBeNull();
});

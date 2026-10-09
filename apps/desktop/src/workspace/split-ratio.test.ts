import { expect, it } from "vitest";
import { splitRatio } from "./split-ratio";

it("keeps the handle under the pointer, wherever on the handle the drag started", () => {
  // A 1008px split with an 8px handle: at 0.5 each side is 500px and the handle's centre is 504.
  const split = { start: 100, size: 1008, handle: 8 };
  expect(splitRatio({ ...split, pointer: 604, grab: 0 })).toBe(0.5);
  // Grabbed 3px right of centre: pressing without moving leaves the ratio where it was.
  expect(splitRatio({ ...split, pointer: 607, grab: 3 })).toBe(0.5);
  // Moving 100px moves the handle 100px, so the first side grows by exactly that much.
  expect(splitRatio({ ...split, pointer: 704, grab: 0 }) * 1000).toBeCloseTo(600);
});

it("keeps both sides at least a tenth of the split", () => {
  const split = { start: 0, size: 1008, handle: 8, grab: 0 };
  expect(splitRatio({ ...split, pointer: -50 })).toBe(0.1);
  expect(splitRatio({ ...split, pointer: 5000 })).toBe(0.9);
  expect(splitRatio({ ...split, size: 8, pointer: 4 })).toBe(0.5);
});

import { expect, it } from "vitest";
import { encodeAttempts } from "./image-attachment";

it("tries lossless PNG first, then JPEG at full size, then smaller JPEGs", () => {
  const attempts = encodeAttempts(3840, 2160);
  expect(attempts[0]).toEqual({ type: "image/png", width: 3840, height: 2160 });
  expect(attempts[1]).toEqual({ type: "image/jpeg", quality: 0.9, width: 3840, height: 2160 });
  expect(attempts[2]).toMatchObject({ type: "image/jpeg", width: 2880, height: 1620 });
  const widths = attempts.slice(1).map((attempt) => attempt.width);
  expect(widths).toEqual([...widths].sort((a, b) => b - a));
  expect(Math.max(attempts.at(-1)!.width, attempts.at(-1)!.height)).toBeGreaterThanOrEqual(480);
});

it("stops shrinking around 480px on the long edge", () => {
  expect(encodeAttempts(64, 48)).toEqual([{ type: "image/png", width: 64, height: 48 }]);
  expect(encodeAttempts(600, 400).map((attempt) => attempt.type)).toEqual([
    "image/png",
    "image/jpeg",
  ]);
});

import { expect, it } from "vitest";
import { LineBuffer } from "./line-buffer.ts";

const buffer = (max = 64) => new LineBuffer(max, () => new Error("too large"));

it("joins lines split across chunks and drops CRLF endings", () => {
  const lines = buffer();
  expect(lines.push("al")).toEqual([]);
  expect(lines.push("pha\r\nbe")).toEqual(["alpha"]);
  expect(lines.push("ta\n\ngam")).toEqual(["beta", ""]);
  expect(lines.push("ma 🌍\n")).toEqual(["gamma 🌍"]);
});

it("refuses a line over the limit, counted in bytes, whether or not it has ended", () => {
  expect(() => buffer(8).push("🌍🌍🌍\n")).toThrow("too large");
  const unfinished = buffer(8);
  unfinished.push("12345");
  expect(() => unfinished.push("6789")).toThrow("too large");
  expect(buffer(8).push("12345678\n")).toEqual(["12345678"]);
});

it("reads a multi-megabyte line in time proportional to its size", () => {
  const lines = buffer(64 * 1024 * 1024);
  const chunk = "x".repeat(16 * 1024);
  const started = performance.now();
  for (let i = 0; i < 2048; i++) lines.push(chunk);
  const [line] = lines.push("\n");
  expect(line).toHaveLength(32 * 1024 * 1024);
  // Re-scanning the whole line per chunk took tens of seconds at this size.
  expect(performance.now() - started).toBeLessThan(3000);
});

import { expect, it } from "vitest";
import { contrastRatio, mixColor, opaqueColor, readableColor } from "./color-math";

it("mixes hex colors and composites optional alpha", () => {
  expect(mixColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(opaqueColor("#ff000080", "#ffffff")).toBe("#ff7f7f");
  expect(opaqueColor("#12345600", "#abcdef")).toBe("#abcdef");
  expect(opaqueColor("#123456", "#ffffff")).toBe("#123456");
});

it("keeps readable colors and adjusts low-contrast derived text on either mode", () => {
  expect(contrastRatio("#000000", "#ffffff")).toBe(21);
  expect(readableColor("#123456", "#ffffff")).toBe("#123456");
  for (const background of ["#ffffff", "#171f32", "#808080", "#000000"])
    for (const color of [background, "#ef8899", "#ffffff20", "#00000020"])
      expect(contrastRatio(readableColor(color, background), background)).toBeGreaterThanOrEqual(
        4.5,
      );
});

import { expect, it } from "vitest";
import { MachineIconSchema } from "./machine-icon.ts";

it.each([null, "🚀", "🛠️", "👩🏽‍💻", "👨‍👩‍👧‍👦", "🇮🇹", "1️⃣"])("accepts the icon %s", (icon) => {
  expect(MachineIconSchema.parse(icon)).toBe(icon);
});
it.each(["", "hello", "https://example.com/icon.svg", "🚀🚀", "<img>", "🚀\n", "x".repeat(33)])(
  "rejects invalid icon %s",
  (icon) => {
    expect(MachineIconSchema.safeParse(icon).success).toBe(false);
  },
);

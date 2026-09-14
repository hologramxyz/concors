import { expect, it } from "vitest";
import { MobilePreferencesSchema } from "./mobile-bridge.ts";
it("round-trips device shortcuts through mobile preferences without losing existing appearance choices", () => {
  const shortcuts = {
    search: [],
    "new-tab": [
      {
        keys: [
          { key: "k", modifiers: ["Control", "Alt"] },
          { key: "t", modifiers: [] },
        ],
        context: "app",
      },
    ],
  };
  const preferences = { theme: "dark", corners: "rounded", sound: true, shortcuts };
  expect(MobilePreferencesSchema.parse(preferences)).toEqual(preferences);
  expect(
    MobilePreferencesSchema.parse({ theme: "system", corners: "subtle" }).shortcuts,
  ).toBeUndefined();
  expect(
    MobilePreferencesSchema.safeParse({
      ...preferences,
      shortcuts: { search: [{ keys: [], context: "app" }] },
    }).success,
  ).toBe(false);
});

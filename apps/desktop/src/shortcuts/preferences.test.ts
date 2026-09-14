import { expect, it } from "vitest";
import { readShortcutPreferences, SHORTCUT_STORAGE_KEY } from "./preferences-context";
it("loads overrides including disabled commands and ignores damaged storage", () => {
  const saved = {
    search: [],
    settings: [{ keys: [{ key: "s", modifiers: ["Alt", "Control"] }], context: "app" }],
  };
  expect(
    readShortcutPreferences({
      getItem: (key) => (key === SHORTCUT_STORAGE_KEY ? JSON.stringify(saved) : null),
    }),
  ).toEqual(saved);
  expect(readShortcutPreferences({ getItem: () => "{broken" })).toEqual({});
  expect(
    readShortcutPreferences({
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    }),
  ).toEqual({});
});

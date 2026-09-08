import { describe, expect, it } from "vitest";
import { BINDINGS, matchShortcut, shortcutLabel } from "./bindings";
const key = {
  key: "t",
  code: "KeyT",
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  isComposing: false,
};
describe("workspace key mappings", () => {
  it("uses the platform modifier and ignores browser tab and shell control shortcuts", () => {
    expect(matchShortcut(key, false, true)).toBe("new-tab");
    expect(matchShortcut(key, true, true)).toBe("new-tab");
    expect(matchShortcut({ ...key, ctrlKey: false, metaKey: true }, true, true)).toBeUndefined();
    expect(matchShortcut({ ...key, shiftKey: false }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, key: "k", shiftKey: false }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, key: "k", shiftKey: false }, false, false)).toBe("search");
  });
  it("never advertises or accepts Command-based workspace shortcuts on Mac", () => {
    for (const binding of BINDINGS) {
      expect(shortcutLabel(binding.id, true)).toMatch(/^Control\+Shift\+/);
      expect(
        matchShortcut({ ...key, key: binding.key, ctrlKey: false, metaKey: true }, true, true),
      ).toBeUndefined();
      expect(matchShortcut({ ...key, key: binding.key }, true, true)).toBe(binding.id);
    }
    expect(
      matchShortcut(
        { ...key, key: "k", shiftKey: false, ctrlKey: false, metaKey: true },
        true,
        false,
      ),
    ).toBe("search");
    expect(
      matchShortcut(
        { ...key, key: "w", shiftKey: false, ctrlKey: false, metaKey: true },
        true,
        false,
      ),
    ).toBeUndefined();
  });
  it("rejects composition and extra modifiers and recognizes shifted punctuation", () => {
    expect(matchShortcut({ ...key, isComposing: true }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, altKey: true }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, metaKey: true }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, key: "?", code: "Slash" }, false, false)).toBe("shortcuts");
    expect(matchShortcut({ ...key, key: "<", code: "Comma" }, false, false)).toBe("settings");
    expect(shortcutLabel("close-pane", true)).toBe("Control+Shift+W");
    expect(shortcutLabel("close-pane", false)).toBe("Ctrl+Shift+W");
  });
});

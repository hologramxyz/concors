import { describe, expect, it } from "vitest";
import { BINDINGS, matchShortcut, matchSequence, shortcutLabel } from "./bindings";
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
  it("uses P/T prefixes on both platforms and keeps shell Ctrl+K", () => {
    for (const mac of [false, true]) {
      expect(matchShortcut(key, mac, true)).toBe("t");
      expect(matchShortcut({ ...key, key: "p" }, mac, true)).toBe("p");
      expect(matchShortcut({ ...key, key: "k", shiftKey: false }, mac, true)).toBeUndefined();
      expect(matchShortcut({ ...key, key: "ArrowLeft" }, mac, true)).toBe("focus-left");
    }
    expect(matchShortcut({ ...key, key: "k", shiftKey: false }, false, false)).toBe("search");
  });
  it("uses directional sequences and no browser-window close mapping", () => {
    for (const binding of BINDINGS) {
      expect(shortcutLabel(binding.id, true)).toMatch(/^Control\+Shift\+/);
      if ("then" in binding) expect(matchSequence(binding.key, binding.then)).toBe(binding.id);
      else expect(matchShortcut({ ...key, key: binding.key }, true, true)).toBe(binding.id);
    }
    expect(matchSequence("p", "Backspace")).toBe("close-pane");
    expect(matchSequence("t", "Backspace")).toBe("close-tab");
    expect(matchSequence("t", "ArrowUp")).toBeUndefined();
    for (const value of ["w", "x", "d", "e"])
      expect(matchShortcut({ ...key, key: value }, false, true)).toBeUndefined();
  });
  it("reserves Ctrl+Tab aliases for the native app", () => {
    expect(matchShortcut({ ...key, key: "Tab", shiftKey: false }, false, true, true)).toBe(
      "next-tab",
    );
    expect(matchShortcut({ ...key, key: "Tab" }, true, true, true)).toBe("previous-tab");
    expect(matchShortcut({ ...key, key: "Tab" }, true, true, false)).toBeUndefined();
  });
  it("rejects composition and extra modifiers and recognizes shifted punctuation", () => {
    expect(matchShortcut({ ...key, isComposing: true }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, altKey: true }, false, true)).toBeUndefined();
    expect(matchShortcut({ ...key, metaKey: true }, true, true)).toBeUndefined();
    expect(matchShortcut({ ...key, ctrlKey: false, metaKey: true }, true, true)).toBeUndefined();
    expect(matchShortcut({ ...key, key: "?", code: "Slash" }, false, false)).toBe("shortcuts");
    expect(matchShortcut({ ...key, key: "<", code: "Comma" }, false, false)).toBe("settings");
    expect(shortcutLabel("close-pane", false)).toBe("Ctrl+Shift+P → Backspace");
  });
});

import { describe, expect, it } from "vitest";
import { BINDINGS, shortcutLabel } from "./bindings";
import {
  bindingLabel,
  defaultKeymap,
  matchContinuation,
  matchKeymap,
  type ShortcutEvent,
} from "./keymap";
const key = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: "k",
  code: "KeyK",
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  isComposing: false,
  ...overrides,
});

describe("default workspace shortcuts", () => {
  it.each([false, true])("preserves every default command on mac=%s", (mac) => {
    const map = defaultKeymap(mac);
    for (const command of BINDINGS) {
      const binding = map[command.id][0]!;
      const stroke = binding.keys[0]!;
      const event = key({
        key: stroke.key,
        code: "",
        ctrlKey: stroke.modifiers.includes("Control"),
        altKey: stroke.modifiers.includes("Alt"),
        shiftKey: stroke.modifiers.includes("Shift"),
      });
      const entries = matchKeymap(event, map, false, true, true);
      if (binding.keys[1])
        expect(matchContinuation(key({ key: binding.keys[1].key, code: "" }), entries)?.id).toBe(
          command.id,
        );
      else expect(entries[0]?.id).toBe(command.id);
      expect(bindingLabel(binding, mac)).toBe(shortcutLabel(command.id, mac));
    }
  });
  it("opens a tab with Command+T in the Mac app only", () => {
    const commandT = key({ key: "t", shiftKey: false, ctrlKey: false, metaKey: true });
    expect(matchKeymap(commandT, defaultKeymap(true), false, true)[0]?.id).toBe("new-tab");
    expect(matchKeymap(commandT, defaultKeymap(true), false, false)).toEqual([]);
    expect(matchKeymap(commandT, defaultKeymap(false), false, true)).toEqual([]);
  });
  it("leaves shell Ctrl+K alone while keeping the outside-terminal search alias", () => {
    expect(matchKeymap(key({ shiftKey: false }), defaultKeymap(), true, false)).toEqual([]);
    expect(matchKeymap(key({ shiftKey: false }), defaultKeymap(), false, false)[0]?.id).toBe(
      "search",
    );
    expect(
      matchKeymap(
        key({ shiftKey: false, ctrlKey: false, metaKey: true }),
        defaultKeymap(true),
        false,
        false,
      )[0]?.id,
    ).toBe("search");
  });
  it("reserves Ctrl+Tab for the native app and F2 for a focused tab", () => {
    expect(matchKeymap(key({ key: "Tab", shiftKey: false }), defaultKeymap(), true, false)).toEqual(
      [],
    );
    expect(
      matchKeymap(key({ key: "Tab", shiftKey: false }), defaultKeymap(), true, true)[0]?.id,
    ).toBe("next-tab");
    expect(matchKeymap(key({ key: "Tab" }), defaultKeymap(), false, true)[0]?.id).toBe(
      "previous-tab",
    );
    expect(matchKeymap(key({ key: "Tab" }), defaultKeymap(), false, false)).toEqual([]);
    expect(
      matchKeymap(
        key({ key: "F2", ctrlKey: false, shiftKey: false }),
        defaultKeymap(),
        false,
        false,
      ),
    ).toEqual([]);
    expect(
      matchKeymap(
        key({ key: "F2", ctrlKey: false, shiftKey: false }),
        defaultKeymap(),
        false,
        false,
        true,
      )[0]?.id,
    ).toBe("rename-tab");
  });
  it("starts dictation with physical Ctrl+D in chat while leaving terminal EOF alone", () => {
    const dictation = key({ key: "d", code: "KeyD", shiftKey: false });
    for (const mac of [false, true]) {
      expect(matchKeymap(dictation, defaultKeymap(mac), false, true)[0]?.id).toBe(
        "start-dictation",
      );
      expect(matchKeymap(dictation, defaultKeymap(mac), true, true)).toEqual([]);
    }
  });
  it("recognizes shifted punctuation without claiming browser window close", () => {
    expect(
      matchKeymap(key({ key: "?", code: "Slash" }), defaultKeymap(), false, false)[0]?.id,
    ).toBe("shortcuts");
    expect(
      matchKeymap(key({ key: "<", code: "Comma" }), defaultKeymap(), false, false)[0]?.id,
    ).toBe("settings");
    expect(matchKeymap(key({ key: "w" }), defaultKeymap(), false, false)).toEqual([]);
  });
});

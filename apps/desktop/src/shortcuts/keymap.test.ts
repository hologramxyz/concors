import { describe, expect, it } from "vitest";
import type { Shortcut, ShortcutOverrides } from "@concors/client-core";
import {
  bindingError,
  bindingLabel,
  browserWarning,
  conflictsFor,
  defaultKeymap,
  eventStroke,
  isTextNavigation,
  mainBinding,
  matchContinuation,
  matchKeymap,
  parseOverrides,
  parseStroke,
  resolveKeymap,
  strokeId,
  shortcutsConflict,
  strokeSymbols,
  updateBindings,
  usableBindings,
  type ShortcutEvent,
  parseShortcutText,
} from "./keymap";
const shortcut = (...keys: string[]): Shortcut => ({
  keys: keys.map((key) => parseStroke(key)!),
  context: "app",
});
const event = (overrides: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: "s",
  code: "KeyS",
  ctrlKey: true,
  altKey: true,
  shiftKey: false,
  metaKey: false,
  isComposing: false,
  ...overrides,
});

describe("custom keymaps", () => {
  it("replaces all aliases and can explicitly disable a command", () => {
    const overrides = { search: [shortcut("Ctrl+Alt+S")], "close-pane": [] };
    const map = resolveKeymap(overrides);
    expect(matchKeymap(event(), map, true, false)[0]?.id).toBe("search");
    expect(
      matchKeymap(event({ key: "k", altKey: false, shiftKey: true }), map, true, false),
    ).toEqual([]);
    expect(matchKeymap(event({ key: "k", altKey: false }), map, false, false)).toEqual([]);
    expect(map["close-pane"]).toEqual([]);
    expect(map["new-project"]).toEqual(defaultKeymap()["new-project"]);
  });
  it("supports arbitrary shared prefixes and exact modified second strokes", () => {
    const map = resolveKeymap({
      "new-pane": [shortcut("Ctrl+Alt+S", "Enter")],
      "new-tab": [shortcut("Ctrl+Alt+S", "Meta+T")],
    });
    const entries = matchKeymap(event(), map, true, false);
    expect(entries).toHaveLength(2);
    expect(
      matchContinuation(event({ key: "Enter", code: "", ctrlKey: false, altKey: false }), entries)
        ?.id,
    ).toBe("new-pane");
    expect(
      matchContinuation(
        event({ key: "t", code: "KeyT", ctrlKey: false, altKey: false, metaKey: true }),
        entries,
      )?.id,
    ).toBe("new-tab");
    expect(
      matchContinuation(event({ key: "t", code: "KeyT", ctrlKey: false, altKey: false }), entries),
    ).toBeUndefined();
  });
  it("detects prefix and held-modifier ambiguities, while allowing distinct second keys", () => {
    expect(shortcutsConflict(shortcut("Ctrl+K"), shortcut("Ctrl+K", "Enter"))).toBe(true);
    expect(shortcutsConflict(shortcut("Ctrl+K", "Enter"), shortcut("Ctrl+K", "Ctrl+Enter"))).toBe(
      true,
    );
    expect(shortcutsConflict(shortcut("Ctrl+K", "Enter"), shortcut("Ctrl+K", "ArrowDown"))).toBe(
      false,
    );
  });
  it("requires deliberate reassignment and preserves unrelated alternatives", () => {
    const original: ShortcutOverrides = {};
    const chosen = [shortcut("Ctrl+Shift+K")];
    expect(
      conflictsFor("settings", chosen, defaultKeymap()).map((conflict) => conflict.id),
    ).toEqual(["search"]);
    expect(() => updateBindings(original, "settings", chosen, false)).toThrow("Already used");
    const next = updateBindings(original, "settings", chosen, false, true);
    expect(resolveKeymap(next).search).toEqual(defaultKeymap().search.slice(1));
    expect(next.settings).toEqual(chosen);
    expect(original).toEqual({});
  });
  it("handles restoring a default that another command has claimed", () => {
    const original = { search: [shortcut("Ctrl+Alt+S")], settings: [shortcut("Ctrl+Shift+K")] };
    expect(() => updateBindings(original, "search", undefined, false)).toThrow("Already used");
    const restored = updateBindings(original, "search", undefined, false, true);
    expect(restored.search).toBeUndefined();
    expect(restored.settings).toEqual([]);
  });
  it("drops corrupt, unknown, or typing-only stored entries but preserves disabled bindings", () => {
    expect(parseOverrides("broken")).toEqual({});
    expect(parseOverrides({ search: "bad" })).toEqual({});
    expect(
      parseOverrides({ search: [shortcut("S")], missing: [shortcut("Ctrl+Q")], settings: [] }),
    ).toEqual({ settings: [] });
    expect(parseOverrides({ search: Array.from({ length: 5 }, () => shortcut("Ctrl+S")) })).toEqual(
      {},
    );
    expect(bindingError(shortcut("Shift+A"))).toMatch(/Start with/);
    expect(bindingError(shortcut("Ctrl+S", "Escape"))).toMatch(/Escape/);
    expect(bindingError(shortcut("F6"))).toBeNull();
  });
  it("normalizes recorded punctuation, digit symbols, and modifier order", () => {
    expect(bindingLabel(shortcut("shift+ctrl+k"))).toBe("Ctrl+Shift+K");
    expect(eventStroke(event({ key: "?", code: "Slash", shiftKey: true }))?.key).toBe("/");
    expect(eventStroke(event({ key: "!", code: "Digit1", shiftKey: true }))?.key).toBe("1");
    expect(eventStroke(event({ isComposing: true }))).toBeNull();
    expect(eventStroke(event({ key: "Dead", code: "" }))).toBeNull();
    expect(parseStroke("Control+Control+K")).toBeNull();
    expect(parseStroke("nonsense+K")).toBeNull();
    expect(parseStroke("cmd+Space")).toEqual({ key: " ", modifiers: ["Meta"] });
    expect(parseStroke("Ctrl+←")).toEqual({ key: "ArrowLeft", modifiers: ["Control"] });
    expect(parseStroke("Ctrl+ArrowLeft")).toEqual(parseStroke("Ctrl+←"));
  });
  it("writes strokes as macOS symbols in the menus' modifier order", () => {
    expect(strokeSymbols(parseStroke("shift+ctrl+n")!)).toBe("⌃⇧N");
    expect(strokeSymbols(parseStroke("cmd+alt+Enter")!)).toBe("⌥⌘↩");
    expect(strokeSymbols(parseStroke("→")!)).toBe("→");
  });
  it("makes browser interception visible without rejecting native bindings", () => {
    expect(browserWarning(shortcut("Ctrl+Shift+W"), false)).toMatch(/reserve/);
    expect(browserWarning({ ...shortcut("Ctrl+Tab"), context: "native" }, false)).toBeNull();
    expect(browserWarning(shortcut("Ctrl+Alt+S"), false)).toBeNull();
  });
  it("recognizes the platform's caret and selection arrow chords", () => {
    const arrow = (overrides: Partial<ShortcutEvent>) =>
      event({ key: "ArrowLeft", code: "ArrowLeft", altKey: false, ...overrides });
    expect(isTextNavigation(arrow({ shiftKey: true }), false)).toBe(true);
    expect(isTextNavigation(arrow({ altKey: true, shiftKey: true }), false)).toBe(false);
    expect(isTextNavigation(arrow({ ctrlKey: false, metaKey: true }), false)).toBe(false);
    expect(isTextNavigation(arrow({ ctrlKey: false, metaKey: true, shiftKey: true }), true)).toBe(
      true,
    );
    expect(isTextNavigation(arrow({ shiftKey: true }), true)).toBe(false);
    expect(isTextNavigation(event({ key: "Home", code: "Home" }), false)).toBe(false);
  });
});

describe("the main shortcut", () => {
  const keys = (id: "new-tab" | "next-tab" | "previous-tab" | "search", mac: boolean) =>
    defaultKeymap(mac)[id];
  const stroke = (binding: Shortcut | undefined) => binding?.keys.map(strokeId);

  it("is the single-press binding in the desktop app, wherever focus is", () => {
    expect(stroke(mainBinding(keys("new-tab", true), true))).toEqual(["Meta+t"]);
    expect(stroke(mainBinding(keys("next-tab", true), true))).toEqual(["Control+tab"]);
    expect(stroke(mainBinding(keys("previous-tab", true), true))).toEqual(["Control+Shift+tab"]);
  });

  it("stays the chord in a browser, which keeps the desktop bindings for itself", () => {
    expect(stroke(mainBinding(keys("new-tab", true), false))).toEqual(["Control+Shift+t", "enter"]);
    expect(stroke(mainBinding(keys("next-tab", true), false))).toEqual([
      "Control+Shift+t",
      "arrowright",
    ]);
    expect(usableBindings(keys("new-tab", true), false)).toHaveLength(1);
  });

  it("does not pick a shorter binding that stops working in a terminal", () => {
    for (const native of [true, false])
      expect(stroke(mainBinding(keys("search", true), native))).toEqual(["Control+Shift+k"]);
  });

  it("keeps the listed order between equals and is empty with no usable binding", () => {
    const first: Shortcut = { keys: [{ key: "a", modifiers: ["Alt"] }], context: "app" };
    const second: Shortcut = { keys: [{ key: "b", modifiers: ["Alt"] }], context: "app" };
    expect(mainBinding([first, second], false)).toBe(first);
    expect(mainBinding([], true)).toBeUndefined();
    expect(mainBinding([{ ...first, context: "native" }], false)).toBeUndefined();
  });
});

it("reads shortcuts written for display", () => {
  const stroke = (key: string, ...modifiers: string[]) => ({ key, modifiers });
  expect(parseShortcutText("Esc")).toEqual([stroke("Escape")]);
  expect(parseShortcutText("Shift+Tab")).toEqual([stroke("Tab", "Shift")]);
  expect(parseShortcutText("⌘+Enter")).toEqual([stroke("Enter", "Meta")]);
  expect(parseShortcutText("Control+Shift+P → →")).toEqual([
    stroke("p", "Control", "Shift"),
    stroke("ArrowRight"),
  ]);
  expect(parseShortcutText("Not a shortcut")).toBeNull();
});

import { expect, it, vi } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, customColorTheme } from "@concors/protocol";
import { applyColorTheme, colorThemeTokens } from "./color-theme";

it("preserves desktop theme surfaces", () => {
  const original = colorThemeTokens(DEFAULT_COLOR_THEME, "light");
  expect(original["background"]).toBeUndefined();
  expect(original["primary"]).toBeUndefined();
  expect(original["terminal-background"]).toBe(DEFAULT_COLOR_THEME.light.surface);
  expect(original["terminal-selection"]).toBe("#00000020");
  expect(original["syntax-keyword"]).toBe("#cf222e");
  for (const theme of COLOR_THEMES.filter((theme) => theme.id !== "concors")) {
    const tokens = colorThemeTokens(theme, "dark");
    expect(tokens["background"]).toBe(theme.dark.background);
    expect(tokens["terminal-background"]).toBe(theme.dark.surface);
  }
});

it("cleans up all palette overrides before restoring Concors", () => {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset: {} as Record<string, string>,
  };
  vi.stubGlobal("document", { documentElement: root });
  try {
    const cleanup = applyColorTheme(COLOR_THEMES[1]!, "dark");
    expect(root.dataset["colorTheme"]).toBe("cobalt");
    expect(properties.has("--terminal-bright-red")).toBe(true);
    expect(properties.has("--syntax-string")).toBe(true);
    cleanup();
    expect(properties.size).toBe(0);
    const cleanupDefault = applyColorTheme(DEFAULT_COLOR_THEME, "light");
    expect(properties.get("--terminal-red")).toBe("#b42332");
    expect(properties.get("--syntax-keyword")).toBe("#cf222e");
    expect(properties.has("--primary")).toBe(false);
    cleanupDefault();
    expect(properties.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps the original phone canvas in both modes", () => {
  for (const [mode, background] of [
    ["light", "#f4f3ef"],
    ["dark", "#141414"],
  ] as const) {
    const tokens = colorThemeTokens(DEFAULT_COLOR_THEME, mode, true);
    expect(tokens["background"]).toBe(background);
    expect(tokens["terminal-background"]).toBe(background);
  }
});

it("uses one mobile canvas for named palettes unless terminal colors are customized", () => {
  for (const theme of COLOR_THEMES.filter((theme) => theme.id !== "concors"))
    for (const mode of ["light", "dark"] as const) {
      const tokens = colorThemeTokens(theme, mode, true);
      expect(tokens["background"]).toBe(theme[mode].background);
      expect(tokens["terminal-background"]).toBe(theme[mode].background);
    }
  const custom = customColorTheme({
    version: 1,
    id: "custom-terminal",
    name: "Custom terminal",
    extends: "cobalt",
    dark: { background: "#203040", terminal: { background: "#102030", red: "#ef8899" } },
  });
  const tokens = colorThemeTokens(custom, "dark", true);
  expect(tokens["background"]).toBe("#203040");
  expect(tokens["terminal-background"]).toBe("#102030");
  expect(tokens["terminal-red"]).toBe("#ef8899");
});

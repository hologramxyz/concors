import { expect, it } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, customColorTheme } from "@concors/protocol";
import { colorThemeTokens } from "./color-theme";

it("preserves desktop theme surfaces", () => {
  expect(colorThemeTokens(DEFAULT_COLOR_THEME, "light")).toEqual({});
  for (const theme of COLOR_THEMES.filter((theme) => theme.id !== "concors")) {
    const tokens = colorThemeTokens(theme, "dark");
    expect(tokens["background"]).toBe(theme.dark.background);
    expect(tokens["terminal-background"]).toBe(theme.dark.surface);
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

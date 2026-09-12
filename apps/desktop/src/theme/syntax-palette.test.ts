import { expect, it } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, customColorTheme } from "@concors/protocol";
import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";
import { contrastRatio } from "./color-math";
import { SYNTAX_COLORS, syntaxPalette } from "./syntax-palette";

it("preserves Concors syntax and covers every highlighter role with a CSS variable", () => {
  expect(syntaxPalette(DEFAULT_COLOR_THEME, "light")).toEqual(lightHighlightColors);
  expect(syntaxPalette(DEFAULT_COLOR_THEME, "dark")).toEqual(darkHighlightColors);
  expect(Object.keys(SYNTAX_COLORS)).toEqual(Object.keys(lightHighlightColors));
  for (const [role, value] of Object.entries(SYNTAX_COLORS))
    expect(value).toBe(`var(--syntax-${role})`);
});

it("provides readable syntax for every named palette and mode", () => {
  for (const theme of COLOR_THEMES.filter((theme) => theme.id !== "concors"))
    for (const mode of ["light", "dark"] as const) {
      const colors = syntaxPalette(theme, mode);
      expect(colors).not.toEqual(mode === "dark" ? darkHighlightColors : lightHighlightColors);
      for (const color of Object.values(colors))
        expect(contrastRatio(color, theme[mode].background)).toBeGreaterThanOrEqual(4.5);
    }
});

it("uses custom ANSI colors while keeping code readable on its own background", () => {
  const theme = customColorTheme({
    version: 1,
    id: "syntax",
    name: "Syntax",
    extends: "cobalt",
    dark: { terminal: { background: "#ffffff", magenta: "#eeaaff", green: "#ffffff00" } },
  });
  const colors = syntaxPalette(theme, "dark");
  expect(colors.keyword).toBe("#eeaaff");
  expect(contrastRatio(colors.string, theme.dark.background)).toBeGreaterThanOrEqual(4.5);
  expect(syntaxPalette(theme, "light").keyword).not.toBe(colors.keyword);
});

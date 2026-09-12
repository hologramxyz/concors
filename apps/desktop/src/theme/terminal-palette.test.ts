import { expect, it } from "vitest";
import { COLOR_THEMES, DEFAULT_COLOR_THEME, customColorTheme } from "@concors/protocol";
import { contrastRatio } from "./color-math";
import { ANSI_COLORS, terminalPalette } from "./terminal-palette";

it("preserves every original Concors ANSI color in both modes", () => {
  for (const mode of ["light", "dark"] as const)
    expect(terminalPalette(DEFAULT_COLOR_THEME, mode)).toMatchObject(ANSI_COLORS[mode]);
});

it("gives every named palette readable, distinct ANSI colors on desktop and mobile", () => {
  for (const theme of COLOR_THEMES.filter((theme) => theme.id !== "concors"))
    for (const mode of ["light", "dark"] as const)
      for (const compact of [false, true]) {
        const colors = terminalPalette(theme, mode, compact);
        expect(Object.keys(colors)).toHaveLength(20);
        for (const name of ["red", "green", "yellow", "blue", "magenta", "cyan"] as const) {
          expect(colors[name]).not.toBe(ANSI_COLORS[mode][name]);
          expect(contrastRatio(colors[name], colors.background)).toBeGreaterThanOrEqual(4.5);
          expect(contrastRatio(colors[`bright-${name}`], colors.background)).toBeGreaterThanOrEqual(
            4.5,
          );
        }
      }
});

it("honors custom terminal colors without changing their alpha or contrast", () => {
  const terminal = {
    background: "#eeeeee",
    foreground: "#88888880",
    red: "#eeeeee",
    "bright-blue": "#12345678",
  };
  const theme = customColorTheme({
    version: 1,
    id: "test",
    name: "Test",
    extends: "cobalt",
    dark: { terminal },
  });
  const colors = terminalPalette(theme, "dark");
  expect(colors).toMatchObject(terminal);
  expect(contrastRatio(colors.green, colors.background)).toBeGreaterThanOrEqual(4.5);
  expect(terminalPalette(theme, "light").red).not.toBe(terminal.red);
});

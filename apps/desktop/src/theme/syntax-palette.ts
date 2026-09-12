import type { ColorTheme } from "@concors/protocol";
import {
  darkHighlightColors,
  lightHighlightColors,
  type HighlightStyle,
} from "@getpaseo/highlight";
import { opaqueColor, readableColor } from "./color-math";
import { terminalPalette } from "./terminal-palette";

/** Both CodeMirror and cached preview tokens resolve these variables live in CSS. */
export const SYNTAX_COLORS = Object.fromEntries(
  Object.keys(lightHighlightColors).map((role) => [role, `var(--syntax-${role})`]),
) as Record<HighlightStyle, string>;

export function syntaxPalette(
  theme: ColorTheme,
  mode: "light" | "dark",
): Record<HighlightStyle, string> {
  if (theme.id === "concors") return mode === "dark" ? darkHighlightColors : lightHighlightColors;
  const palette = theme[mode];
  const ansi = terminalPalette(theme, mode);
  const colors: Record<HighlightStyle, string> = {
    keyword: ansi.magenta,
    comment: palette.mutedForeground,
    string: ansi.green,
    number: ansi.yellow,
    literal: ansi.yellow,
    function: ansi.blue,
    definition: ansi.blue,
    class: ansi.yellow,
    type: ansi.cyan,
    tag: ansi.red,
    attribute: ansi.cyan,
    property: ansi.cyan,
    variable: palette.foreground,
    operator: ansi.magenta,
    punctuation: palette.foreground,
    regexp: ansi.red,
    escape: ansi.yellow,
    meta: palette.mutedForeground,
    heading: palette.accent,
    link: palette.accent,
  };
  const background = opaqueColor(palette.background, mode === "light" ? "#ffffff" : "#000000");
  for (const role of Object.keys(colors) as HighlightStyle[])
    colors[role] = readableColor(colors[role], background);
  return colors;
}

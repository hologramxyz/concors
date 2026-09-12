import type { ColorTheme } from "@concors/protocol";
import type { HighlightStyle } from "@getpaseo/highlight";
import { opaqueColor, readableColor } from "./color-math";
import { terminalPalette } from "./terminal-palette";

// Original Paseo colors (Apache-2.0; see third-party/paseo-LICENSE).
// Keep this small data copy instead of eagerly importing the highlighter barrel:
// that also initializes every language parser, defeating the editor's lazy loading.
// Unit tests verify parity with @getpaseo/highlight when the dependency is updated.
const DEFAULT_SYNTAX_COLORS: Record<"light" | "dark", Record<HighlightStyle, string>> = {
  light: {
    keyword: "#cf222e",
    comment: "#6e7781",
    string: "#0a3069",
    number: "#0550ae",
    literal: "#0550ae",
    function: "#8250df",
    definition: "#8250df",
    class: "#953800",
    type: "#cf222e",
    tag: "#116329",
    attribute: "#0550ae",
    property: "#0550ae",
    variable: "#24292f",
    operator: "#0550ae",
    punctuation: "#24292f",
    regexp: "#0a3069",
    escape: "#0550ae",
    meta: "#6e7781",
    heading: "#0550ae",
    link: "#0a3069",
  },
  dark: {
    keyword: "#ff7b72",
    comment: "#8b949e",
    string: "#a5d6ff",
    number: "#79c0ff",
    literal: "#79c0ff",
    function: "#d2a8ff",
    definition: "#d2a8ff",
    class: "#ffa657",
    type: "#ff7b72",
    tag: "#7ee787",
    attribute: "#79c0ff",
    property: "#79c0ff",
    variable: "#c9d1d9",
    operator: "#79c0ff",
    punctuation: "#c9d1d9",
    regexp: "#a5d6ff",
    escape: "#79c0ff",
    meta: "#8b949e",
    heading: "#79c0ff",
    link: "#a5d6ff",
  },
};

/** Both CodeMirror and cached preview tokens resolve these variables live in CSS. */
export const SYNTAX_COLORS = Object.fromEntries(
  Object.keys(DEFAULT_SYNTAX_COLORS.light).map((role) => [role, `var(--syntax-${role})`]),
) as Record<HighlightStyle, string>;

export function syntaxPalette(
  theme: ColorTheme,
  mode: "light" | "dark",
): Record<HighlightStyle, string> {
  if (theme.id === "concors") return DEFAULT_SYNTAX_COLORS[mode];
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

import { mobileThemeBackground, type ColorTheme } from "@concors/protocol";
import { mixColor, opaqueColor, readableColor } from "./color-math";

// Match the original Concors stylesheet fallbacks, including conventional ANSI neutrals.
export const ANSI_COLORS = {
  light: {
    black: "#20211f",
    red: "#b42332",
    green: "#247343",
    yellow: "#876009",
    blue: "#335dce",
    magenta: "#8643a5",
    cyan: "#067681",
    white: "#c6c7c1",
    "bright-black": "#65665f",
    "bright-red": "#ce3046",
    "bright-green": "#238147",
    "bright-yellow": "#986c0d",
    "bright-blue": "#416ee4",
    "bright-magenta": "#9b4fba",
    "bright-cyan": "#008491",
    "bright-white": "#ffffff",
  },
  dark: {
    black: "#303030",
    red: "#ef7c8b",
    green: "#84c99b",
    yellow: "#e3c078",
    blue: "#769bff",
    magenta: "#c39bea",
    cyan: "#79c7d4",
    white: "#d4d4d4",
    "bright-black": "#808080",
    "bright-red": "#ffa0ad",
    "bright-green": "#a6e2b8",
    "bright-yellow": "#f6daa1",
    "bright-blue": "#a6bdff",
    "bright-magenta": "#dfbaff",
    "bright-cyan": "#a0e1eb",
    "bright-white": "#f5f5f5",
  },
} as const;

export type AnsiColor = keyof (typeof ANSI_COLORS)["light"];
type TerminalPalette = Record<
  AnsiColor | "background" | "foreground" | "cursor" | "selection",
  string
>;

export function terminalPalette(
  theme: ColorTheme,
  mode: "light" | "dark",
  compact = false,
): TerminalPalette {
  const palette = theme[mode];
  const custom = theme.custom?.[mode]?.terminal;
  const background =
    custom?.background ?? (compact ? mobileThemeBackground(theme, mode) : palette.surface);
  const colors: TerminalPalette = {
    ...ANSI_COLORS[mode],
    background,
    foreground: palette.foreground,
    cursor: palette.accent,
    selection:
      theme.id === "concors" ? (mode === "light" ? "#00000020" : "#ffffff30") : palette.selection,
  };
  if (theme.id !== "concors") {
    const canvas = opaqueColor(background, mode === "light" ? "#ffffff" : "#000000");
    const accent = opaqueColor(palette.accent, canvas);
    for (const name of Object.keys(ANSI_COLORS[mode]) as AnsiColor[]) {
      // A restrained accent tint keeps red/green/etc. recognizable to terminal applications.
      const tinted = mixColor(ANSI_COLORS[mode][name], accent, 0.15);
      colors[name] =
        name.includes("black") || name.includes("white") ? tinted : readableColor(tinted, canvas);
    }
  }
  // Explicit colors (including alpha and all bright variants) always win.
  return { ...colors, ...custom };
}

import type { ITheme } from "@xterm/xterm";

/** Hex tokens are shared with pane chrome; xterm receives explicit ANSI colors for both themes. */
export function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--terminal-${name}`).trim();
  return {
    background: color("background"),
    foreground: color("foreground"),
    cursor: color("cursor"),
    cursorAccent: color("background"),
    selectionBackground: color("selection"),
    black: color("black"),
    red: color("red"),
    green: color("green"),
    yellow: color("yellow"),
    blue: color("blue"),
    magenta: color("magenta"),
    cyan: color("cyan"),
    white: color("white"),
    brightBlack: color("bright-black"),
    brightRed: color("bright-red"),
    brightGreen: color("bright-green"),
    brightYellow: color("bright-yellow"),
    brightBlue: color("bright-blue"),
    brightMagenta: color("bright-magenta"),
    brightCyan: color("bright-cyan"),
    brightWhite: color("bright-white"),
    scrollbarSliderBackground: "#7c879a60",
    scrollbarSliderHoverBackground: "#7c879a90",
    scrollbarSliderActiveBackground: "#7c879ab0",
  };
}

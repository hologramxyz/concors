import { mobileThemeBackground, type ColorTheme } from "@concors/protocol";
import { syntaxPalette } from "./syntax-palette";
import { terminalPalette } from "./terminal-palette";

/** Explicit token mapping prevents custom files from changing layout or loading external CSS. */
export function colorThemeTokens(
  theme: ColorTheme,
  mode: "light" | "dark",
  compact = false,
): Record<string, string> {
  const codeTokens: Record<string, string> = {};
  for (const [name, color] of Object.entries(terminalPalette(theme, mode, compact)))
    codeTokens[`terminal-${name}`] = color;
  for (const [name, color] of Object.entries(syntaxPalette(theme, mode)))
    codeTokens[`syntax-${name}`] = color;
  if (theme.id === "concors")
    return compact
      ? {
          ...codeTokens,
          background: mobileThemeBackground(theme, mode),
        }
      : codeTokens;
  const c = theme[mode];
  const tokens: Record<string, string> = {
    background: c.background,
    foreground: c.foreground,
    card: c.surface,
    "card-foreground": c.foreground,
    popover: c.surface,
    "popover-foreground": c.foreground,
    primary: c.accent,
    "primary-foreground": c.accentForeground,
    secondary: c.muted,
    "secondary-foreground": c.foreground,
    muted: c.muted,
    "muted-foreground": c.mutedForeground,
    accent: c.muted,
    "accent-foreground": c.foreground,
    border: c.border,
    input: c.border,
    ring: c.accent,
    sidebar: c.sidebar,
    "sidebar-foreground": c.foreground,
    "sidebar-primary": c.accent,
    "sidebar-primary-foreground": c.accentForeground,
    "sidebar-accent": c.muted,
    "sidebar-accent-foreground": c.foreground,
    "sidebar-border": c.border,
    "sidebar-ring": c.accent,
    selection: c.selection,
    ...codeTokens,
  };
  return tokens;
}
export function applyColorTheme(theme: ColorTheme, mode: "light" | "dark", compact = false) {
  const root = document.documentElement;
  const tokens = colorThemeTokens(theme, mode, compact);
  for (const [key, color] of Object.entries(tokens)) root.style.setProperty(`--${key}`, color);
  root.dataset["colorTheme"] = theme.id;
  if (!compact) {
    const background = tokens["background"] ?? (mode === "dark" ? "#111111" : "#eeede8");
    const foreground = tokens["foreground"] ?? (mode === "dark" ? "#ededed" : "#20211f");
    root.style.setProperty("--startup-background", background);
    root.style.setProperty("--startup-foreground", foreground);
    try {
      localStorage.setItem(
        "concors.startup-appearance.v1",
        JSON.stringify({ id: theme.id, mode, background, foreground }),
      );
    } catch {
      /* The current window still uses its selected appearance. */
    }
  }
  return () => {
    for (const key of Object.keys(tokens)) root.style.removeProperty(`--${key}`);
    delete root.dataset["colorTheme"];
    if (!compact) {
      root.style.removeProperty("--startup-background");
      root.style.removeProperty("--startup-foreground");
    }
  };
}

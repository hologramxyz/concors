import { mobileThemeBackground, type ColorTheme } from "@concors/protocol";

/** Explicit token mapping prevents custom files from changing layout or loading external CSS. */
export function colorThemeTokens(
  theme: ColorTheme,
  mode: "light" | "dark",
  compact = false,
): Record<string, string> {
  if (theme.id === "concors")
    return compact
      ? {
          background: mobileThemeBackground(theme, mode),
          "terminal-background": mobileThemeBackground(theme, mode),
        }
      : {};
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
    "terminal-background": compact ? mobileThemeBackground(theme, mode) : c.surface,
    "terminal-foreground": c.foreground,
    "terminal-cursor": c.accent,
    "terminal-selection": c.selection,
  };
  for (const [name, color] of Object.entries(theme.custom?.[mode]?.terminal ?? {}))
    if (color) tokens[`terminal-${name}`] = color;
  return tokens;
}
export function applyColorTheme(theme: ColorTheme, mode: "light" | "dark", compact = false) {
  const root = document.documentElement;
  const tokens = colorThemeTokens(theme, mode, compact);
  for (const [key, color] of Object.entries(tokens)) root.style.setProperty(`--${key}`, color);
  root.dataset["colorTheme"] = theme.id;
  return () => {
    for (const key of Object.keys(tokens)) root.style.removeProperty(`--${key}`);
    delete root.dataset["colorTheme"];
  };
}

import type { ThemeDefinition, ThemePalette } from "./themes.ts";
import { BUILTIN_THEME_IDS, ThemePaletteSchema } from "./themes.ts";
export interface ColorTheme {
  id: string;
  name: string;
  description: string;
  light: ThemePalette;
  dark: ThemePalette;
  custom?: ThemeDefinition;
}
// Original Concors palettes. Named presets are original variations, bundled for offline use.
function palette(values: readonly string[]): ThemePalette {
  const [
    background,
    foreground,
    surface,
    sidebar,
    muted,
    mutedForeground,
    border,
    accent,
    accentForeground,
    selection,
  ] = values;
  if (
    !background ||
    !foreground ||
    !surface ||
    !sidebar ||
    !muted ||
    !mutedForeground ||
    !border ||
    !accent ||
    !accentForeground ||
    !selection
  )
    throw new Error("Incomplete theme palette");
  return {
    background,
    foreground,
    surface,
    sidebar,
    muted,
    mutedForeground,
    border,
    accent,
    accentForeground,
    selection,
  };
}
const samples = [
  [
    "Concors",
    "Paper and ink. The original workspace.",
    [
      "#eeede8",
      "#20211f",
      "#ffffff",
      "#e2e1db",
      "#f3f3f3",
      "#65665f",
      "#d3d3cb",
      "#20211f",
      "#ffffff",
      "#deded9",
    ],
    [
      "#111111",
      "#ededed",
      "#1b1b1b",
      "#0b0b0b",
      "#242424",
      "#a0a0a0",
      "#ffffff14",
      "#ededed",
      "#111111",
      "#3b3b3b",
    ],
  ],
  [
    "Cobalt",
    "Crisp blue accents and cool surfaces.",
    [
      "#f1f4fb",
      "#1b2540",
      "#ffffff",
      "#e5ebf7",
      "#e6ecf8",
      "#526079",
      "#cbd5e9",
      "#244ad8",
      "#ffffff",
      "#d7e0ff",
    ],
    [
      "#101625",
      "#e4ebfa",
      "#171f32",
      "#0b1020",
      "#222e46",
      "#a3b3d0",
      "#33435f",
      "#91acff",
      "#101625",
      "#304570",
    ],
  ],
  [
    "Dusk",
    "Soft violet for late-night focus.",
    [
      "#f4f1fa",
      "#2d2440",
      "#ffffff",
      "#e9e2f3",
      "#ebe5f4",
      "#6b5c7d",
      "#d6cbe5",
      "#7040a5",
      "#ffffff",
      "#e4d5f5",
    ],
    [
      "#1a1525",
      "#eee6f6",
      "#241d32",
      "#140f1e",
      "#342a44",
      "#b4a3c5",
      "#493b5d",
      "#c4a0ee",
      "#1a1525",
      "#504065",
    ],
  ],
  [
    "Forest",
    "Quiet greens and natural contrast.",
    [
      "#f0f4ef",
      "#20342a",
      "#fcfefb",
      "#e0e9df",
      "#e6ede3",
      "#536b5b",
      "#c8d6c6",
      "#286747",
      "#ffffff",
      "#d3e6d4",
    ],
    [
      "#111c17",
      "#e1eee4",
      "#192820",
      "#0c1510",
      "#263b2e",
      "#a0bba7",
      "#375340",
      "#91c9a0",
      "#111c17",
      "#385442",
    ],
  ],
  [
    "Rose",
    "Warm blush with berry accents.",
    [
      "#faf1f3",
      "#40262f",
      "#fffbfc",
      "#f0e0e5",
      "#f3e5e9",
      "#7d5965",
      "#e5cbd4",
      "#a03058",
      "#ffffff",
      "#f1d2dd",
    ],
    [
      "#24151c",
      "#f6e5ed",
      "#311e28",
      "#1b1015",
      "#462b38",
      "#c2a1b0",
      "#60404f",
      "#eba0bc",
      "#24151c",
      "#624052",
    ],
  ],
  [
    "Sand",
    "Warm parchment and amber details.",
    [
      "#f7f1e5",
      "#3b3023",
      "#fffbf3",
      "#eae0cd",
      "#efe5d3",
      "#76634b",
      "#dbccb2",
      "#86521f",
      "#ffffff",
      "#ead7b6",
    ],
    [
      "#211b14",
      "#f1e6d3",
      "#2c251c",
      "#18140e",
      "#3e3427",
      "#bcac91",
      "#564834",
      "#e1b875",
      "#211b14",
      "#584832",
    ],
  ],
  [
    "Ocean",
    "Airy teal and deep marine blues.",
    [
      "#eef6f7",
      "#1e353d",
      "#fbfeff",
      "#dcebef",
      "#e1eef1",
      "#526d77",
      "#c1d9e0",
      "#176c80",
      "#ffffff",
      "#c7e4ec",
    ],
    [
      "#101d24",
      "#dfedf4",
      "#182a34",
      "#0a151c",
      "#233b46",
      "#9fbac7",
      "#365461",
      "#7ec8d7",
      "#101d24",
      "#30515e",
    ],
  ],
] as const;
export const COLOR_THEMES: readonly ColorTheme[] = samples.map(
  ([name, description, light, dark], index) => ({
    id: BUILTIN_THEME_IDS[index] ?? "concors",
    name,
    description,
    light: palette(light),
    dark: palette(dark),
  }),
);
export const DEFAULT_COLOR_THEME = COLOR_THEMES[0] as ColorTheme;

/** Shared by the native host and renderer so the phone canvas meets its safe area. */
export function mobileThemeBackground(theme: ColorTheme, mode: "light" | "dark"): string {
  if (theme.id === "concors") return mode === "dark" ? "#141414" : "#f4f3ef";
  return theme[mode].background;
}
export function customColorTheme(definition: ThemeDefinition): ColorTheme {
  const base = COLOR_THEMES.find((theme) => theme.id === definition.extends) ?? DEFAULT_COLOR_THEME;
  const variant = (mode: "light" | "dark") =>
    ThemePaletteSchema.parse(
      Object.fromEntries(
        Object.entries(base[mode]).map(([key, value]) => [
          key,
          definition[mode]?.[key as keyof ThemePalette] ?? value,
        ]),
      ),
    );
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description ?? "Custom theme",
    light: variant("light"),
    dark: variant("dark"),
    custom: definition,
  };
}

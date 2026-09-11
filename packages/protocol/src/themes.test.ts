import { expect, it } from "vitest";
import { ThemeDefinitionSchema, ThemeSelectionSchema } from "./themes.ts";
import { COLOR_THEMES, customColorTheme } from "./theme-presets.ts";

it("inherits both modes while restricting custom themes to color data", () => {
  const custom = ThemeDefinitionSchema.parse({
    version: 1,
    id: "sunset",
    name: "Sunset",
    extends: "sand",
    dark: { accent: "#ffc092", terminal: { red: "#ef8899" } },
  });
  const theme = customColorTheme(custom);
  expect(theme.light).toEqual(COLOR_THEMES.find((item) => item.id === "sand")?.light);
  expect(theme.dark.accent).toBe("#ffc092");
  for (const dark of [
    { accent: "url(https://example.test)" },
    { accent: "red; display:none" },
    { backgroundImage: "https://example.test" },
    { terminal: { command: "echo nope" } },
  ])
    expect(ThemeDefinitionSchema.safeParse({ ...custom, dark }).success).toBe(false);
  expect(ThemeDefinitionSchema.safeParse({ ...custom, extends: "other-custom" }).success).toBe(
    false,
  );
  expect(ThemeSelectionSchema.safeParse({ id: "other", custom }).success).toBe(false);
});

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (rgb[0] ?? 0) * 0.2126 + (rgb[1] ?? 0) * 0.7152 + (rgb[2] ?? 0) * 0.0722;
}
it("ships readable text and primary buttons in every preset and mode", () => {
  for (const theme of COLOR_THEMES)
    for (const mode of ["light", "dark"] as const) {
      const colors = theme[mode];
      for (const [text, background] of [
        [colors.foreground, colors.background],
        [colors.foreground, colors.surface],
        [colors.mutedForeground, colors.surface],
        [colors.accentForeground, colors.accent],
      ]) {
        const values = [luminance(text as string), luminance(background as string)].sort(
          (a, b) => a - b,
        );
        expect(
          ((values[1] ?? 0) + 0.05) / ((values[0] ?? 0) + 0.05),
          `${theme.id} ${mode}: ${text} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
});

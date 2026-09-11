import { z } from "zod";

export const BUILTIN_THEME_IDS = [
  "concors",
  "cobalt",
  "dusk",
  "forest",
  "rose",
  "sand",
  "ocean",
] as const;
export const ThemeIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ThemeColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Use a six- or eight-digit hex color");
export const ThemePaletteSchema = z.strictObject({
  background: ThemeColorSchema,
  foreground: ThemeColorSchema,
  surface: ThemeColorSchema,
  sidebar: ThemeColorSchema,
  muted: ThemeColorSchema,
  mutedForeground: ThemeColorSchema,
  border: ThemeColorSchema,
  accent: ThemeColorSchema,
  accentForeground: ThemeColorSchema,
  selection: ThemeColorSchema,
});
export type ThemePalette = z.infer<typeof ThemePaletteSchema>;
export const TERMINAL_COLOR_NAMES = [
  "background",
  "foreground",
  "cursor",
  "selection",
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright-black",
  "bright-red",
  "bright-green",
  "bright-yellow",
  "bright-blue",
  "bright-magenta",
  "bright-cyan",
  "bright-white",
] as const;
export const ThemeVariantSchema = ThemePaletteSchema.partial().extend({
  terminal: z.partialRecord(z.enum(TERMINAL_COLOR_NAMES), ThemeColorSchema).optional(),
});
/** Data only: no CSS, scripts, file references, or remote resources. */
export const ThemeDefinitionSchema = z.strictObject({
  $schema: z.string().max(2048).optional(),
  version: z.literal(1),
  id: ThemeIdSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
  extends: z.enum(BUILTIN_THEME_IDS).default("concors"),
  light: ThemeVariantSchema.optional(),
  dark: ThemeVariantSchema.optional(),
});
export type ThemeDefinition = z.infer<typeof ThemeDefinitionSchema>;
export const ThemeSelectionSchema = z
  .strictObject({
    id: ThemeIdSchema,
    custom: ThemeDefinitionSchema.optional(),
  })
  .refine((value) => !value.custom || value.custom.id === value.id, "Theme IDs must match");
export type ThemeSelection = z.infer<typeof ThemeSelectionSchema>;
export const ThemeCatalogSchema = z.object({
  directory: z.string().max(4096),
  themes: z.array(ThemeDefinitionSchema).max(64),
  issues: z.array(z.object({ file: z.string().max(255), message: z.string().max(500) })).max(65),
});
export type ThemeCatalog = z.infer<typeof ThemeCatalogSchema>;
export const ThemeRequestSchema = z.object({
  type: z.literal("theme.request"),
  requestId: z.uuid(),
});
export const ThemeResultSchema = z.object({
  type: z.literal("theme.result"),
  requestId: z.uuid(),
  catalog: ThemeCatalogSchema,
});
export type ThemeResult = z.infer<typeof ThemeResultSchema>;

import { z } from "zod";

export const ShortcutStrokeSchema = z.object({
  key: z.string().min(1).max(32),
  modifiers: z.array(z.enum(["Control", "Alt", "Shift", "Meta"])).max(4),
});
export const ShortcutSchema = z.object({
  keys: z.array(ShortcutStrokeSchema).min(1).max(2),
  context: z.enum(["app", "outside-terminal", "native", "tab"]).default("app"),
});
/** Missing commands inherit defaults; an empty list explicitly disables a command. */
export const ShortcutOverridesSchema = z.record(
  z.string().regex(/^[a-z][a-z-]{0,63}$/),
  z.array(ShortcutSchema).max(4),
);
export type ShortcutStroke = z.infer<typeof ShortcutStrokeSchema>;
export type Shortcut = z.infer<typeof ShortcutSchema>;
export type ShortcutOverrides = z.infer<typeof ShortcutOverridesSchema>;

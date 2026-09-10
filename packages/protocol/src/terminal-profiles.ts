import { z } from "zod";

export const TerminalProfileIdSchema = z.union([
  z.enum(["codex", "claude", "opencode"]),
  z.string().uuid(),
]);
const Argument = z
  .string()
  .max(4096)
  .refine((value) => !/[\0\r\n]/.test(value), "Use one argument per line");
export const TerminalProfileInputSchema = z.object({
  id: TerminalProfileIdSchema,
  name: z.string().trim().min(1).max(120),
  command: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !/[\0\r\n]/.test(value), "Use a single executable name or path"),
  args: z.array(Argument).max(64),
});
export const SavedTerminalProfileSchema = TerminalProfileInputSchema.extend({
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export type TerminalProfileInput = z.infer<typeof TerminalProfileInputSchema>;
export type SavedTerminalProfile = z.infer<typeof SavedTerminalProfileSchema>;

export const DEFAULT_TERMINAL_PROFILES: readonly SavedTerminalProfile[] = [
  { id: "codex", name: "Codex", command: "codex", args: [], version: 0 },
  { id: "claude", name: "Claude Code", command: "claude", args: [], version: 0 },
  { id: "opencode", name: "OpenCode", command: "opencode", args: [], version: 0 },
];

export function terminalProfileKind(command: string): "shell" | "codex" | "claude" | "opencode" {
  const executable = command
    .split(/[\\/]/)
    .at(-1)
    ?.replace(/\.(exe|com|cmd|bat)$/i, "")
    .toLowerCase();
  return executable === "codex" || executable === "claude" || executable === "opencode"
    ? executable
    : "shell";
}

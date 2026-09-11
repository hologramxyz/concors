import { z } from "zod";

export const AgentCommandSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(4000),
  argumentHint: z.string().max(1000).optional(),
  kind: z.enum(["command", "skill"]).default("command"),
});
export const AgentModeSchema = z.object({
  id: z.string().min(1).max(512),
  label: z.string().max(200),
  description: z.string().max(2000).optional(),
});
export const AgentFeatureValueSchema = z.union([z.boolean(), z.string().max(1024)]);
export const AgentFeatureSchema = z.object({
  id: z.string().min(1).max(128),
  label: z.string().max(200),
  description: z.string().max(2000).optional(),
  value: AgentFeatureValueSchema,
  options: z
    .array(z.object({ id: z.string().max(1024), label: z.string().max(200) }))
    .max(128)
    .optional(),
});

/** Provider-owned controls. Absence means unsupported, not an instruction to guess. */
export const AgentControlsSchema = z.object({
  modes: z.array(AgentModeSchema).max(128).default([]),
  currentMode: z.string().nullable().default(null),
  commands: z.array(AgentCommandSchema).max(1024).default([]),
  features: z.array(AgentFeatureSchema).max(64).default([]),
  compact: z.boolean().default(false),
  contextUsage: z.boolean().default(false),
  steer: z.boolean().default(false),
  rewind: z.array(z.enum(["conversation", "files", "both"])).default([]),
  fork: z.boolean().default(false),
  childHistory: z.boolean().default(false),
  importSessions: z.boolean().default(false),
  history: z.boolean().default(false),
  mcpStatus: z.boolean().default(false),
  mcp: z.boolean().default(false),
});
export type AgentControls = z.infer<typeof AgentControlsSchema>;
export type AgentCommand = z.infer<typeof AgentCommandSchema>;
export type AgentMode = z.infer<typeof AgentModeSchema>;
export type AgentFeature = z.infer<typeof AgentFeatureSchema>;

export function parseAgentCommand(text: string): { name: string; args: string } | null {
  const match = /^\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return match?.[1] ? { name: match[1], args: match[2]?.trim() ?? "" } : null;
}

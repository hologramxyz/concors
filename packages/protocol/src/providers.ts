import { z } from "zod";
import { NativeSessionPageSchema } from "./native-sessions.ts";

export const ProviderIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*$/);
export const ProviderEngineSchema = z.enum(["codex", "claude", "opencode", "pi", "omp", "acp"]);
export const McpServerSchema = z.discriminatedUnion("type", [
  z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    type: z.literal("stdio"),
    command: z.string().min(1).max(4096),
    args: z.array(z.string().max(4096)).max(64).default([]),
    env: z.record(z.string(), z.string().max(16000)).optional(),
  }),
  z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_-]+$/),
    type: z.enum(["http", "sse"]),
    url: z.string().url().max(4096),
    headers: z.record(z.string(), z.string().max(16000)).optional(),
  }),
]);
export type McpServer = z.infer<typeof McpServerSchema>;
export const ProviderConfigSchema = z.object({
  id: ProviderIdSchema,
  label: z.string().trim().min(1).max(100),
  engine: ProviderEngineSchema,
  command: z.array(z.string().min(1).max(4096)).min(1).max(64),
  enabled: z.boolean(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(16000)).optional(),
  models: z.array(z.string().min(1).max(1024)).max(4096).optional(),
  params: z
    .object({
      supportsMcpServers: z.boolean().optional(),
      mcpServers: z.array(McpServerSchema).max(32).optional(),
    })
    .optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderPreset = ProviderConfig & {
  install?: { kind: "npm" | "npx"; package: string; bin?: string };
  installLink: string;
};
export const ProviderStatusSchema = ProviderConfigSchema.omit({ env: true, params: true }).extend({
  envKeys: z.array(z.string()),
  params: z.object({ supportsMcpServers: z.boolean().optional() }).optional(),
  mcpServerNames: z.array(z.string()).optional(),
  installed: z.boolean(),
  customized: z.boolean(),
  canInstall: z.boolean(),
  installLink: z.string().optional(),
  installStatus: z.enum(["idle", "installing", "installed", "failed"]),
  error: z.string().optional(),
});
export type ProviderStatus = z.infer<typeof ProviderStatusSchema>;
export const ProviderRequestSchema = z.object({
  type: z.literal("provider.request"),
  requestId: z.string().uuid(),
  operation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("sessions-list"),
      projectId: z.string().uuid(),
      directory: z.string().min(1).max(4096),
      provider: ProviderIdSchema,
      cursor: z.string().min(1).max(4096).optional(),
      query: z.string().max(200).optional(),
      refresh: z.boolean().optional(),
    }),
    z.object({ kind: z.literal("list") }),
    z.object({
      kind: z.literal("save"),
      config: ProviderConfigSchema,
      expectedRevision: z.number().int().nonnegative(),
      removeEnv: z.array(z.string()).max(64).optional(),
    }),
    z.object({
      kind: z.literal("remove"),
      id: ProviderIdSchema,
      expectedRevision: z.number().int().nonnegative(),
    }),
    z.object({ kind: z.literal("install"), id: ProviderIdSchema }),
  ]),
});
export type ProviderRequest = z.infer<typeof ProviderRequestSchema>;
export type ProviderOperation = ProviderRequest["operation"];
export const ProviderResultSchema = z.object({
  type: z.literal("provider.result"),
  requestId: z.string().uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      revision: z.number().int().nonnegative(),
      providers: z.array(ProviderStatusSchema).max(128),
      sessions: NativeSessionPageSchema.optional(),
    }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type ProviderResult = z.infer<typeof ProviderResultSchema>;

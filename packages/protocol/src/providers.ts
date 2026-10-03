import { z } from "zod";
import { AgentPlanUsageSchema } from "./agent-usage.ts";
import { NativeSessionPageSchema } from "./native-sessions.ts";
import { AgentAccountActionSchema, AgentAccountSchema } from "./agent-accounts.ts";

/** Daemons that manage per-subscription credential homes and provider-level account flows. */
export const PROVIDER_SUBSCRIPTIONS_CAPABILITY = "provider-subscriptions";
/** Daemons that can read plan limits for a provider configuration without an open chat. */
export const PROVIDER_USAGE_CAPABILITY = "provider-plan-usage";
/** Engines whose CLIs support an isolated credential home per provider configuration. */
export const SUBSCRIPTION_ENGINES = ["claude", "codex"] as const;

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
  /** A user-chosen name for the account. Without one, clients show the signed-in identity. */
  accountNickname: z.string().trim().min(1).max(100).optional(),
  params: z
    .object({
      supportsMcpServers: z.boolean().optional(),
      mcpServers: z.array(McpServerSchema).max(32).optional(),
    })
    .optional(),
  /**
   * Marks this configuration as one signed-in subscription of its engine ("Work", "Personal").
   * The daemon gives it an isolated credential home so several subscriptions of the same
   * engine stay signed in side by side; credentials themselves never leave the machine.
   */
  subscription: z.object({ nickname: z.string().trim().min(1).max(100) }).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ProviderPreset = ProviderConfig & {
  /**
   * How Install puts the CLI in the daemon's private provider directory. An `npm` agent CLI names
   * its bare package and is installed at its newest release: vendors gate new models on the CLI
   * version, and the daemon offers updates for it anyway. An `npx` ACP adapter names the exact
   * version its `command` was audited with, because nothing updates it afterwards.
   */
  install?: { kind: "npm" | "npx"; package: string; bin?: string };
  installLink: string;
};
/**
 * The installed CLI's version against its newest published release. `updateCommand` is what
 * "Update" runs on the machine; without one the CLI was installed in a way the daemon cannot
 * update safely, and the user updates it themselves.
 */
export const ProviderVersionSchema = z.object({
  installed: z.string().max(100).optional(),
  latest: z.string().max(100).optional(),
  updateAvailable: z.boolean(),
  updateCommand: z.string().max(1000).optional(),
  updating: z.boolean().optional(),
  updateError: z.string().max(2000).optional(),
});
export type ProviderVersion = z.infer<typeof ProviderVersionSchema>;
export const ProviderStatusSchema = ProviderConfigSchema.omit({ env: true, params: true }).extend({
  /** Whether this account is the one every chat on the machine uses for its engine. */
  active: z.boolean().optional(),
  envKeys: z.array(z.string()),
  params: z.object({ supportsMcpServers: z.boolean().optional() }).optional(),
  mcpServerNames: z.array(z.string()).optional(),
  installed: z.boolean(),
  customized: z.boolean(),
  canInstall: z.boolean(),
  installLink: z.string().optional(),
  installStatus: z.enum(["idle", "installing", "installed", "failed"]),
  error: z.string().optional(),
  version: ProviderVersionSchema.optional(),
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
    /** `checkVersions` also re-reads installed CLI versions and their latest releases now. */
    z.object({ kind: z.literal("list"), checkVersions: z.boolean().optional() }),
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
    /** Updates an installed CLI to its latest release with the version's `updateCommand`. */
    z.object({ kind: z.literal("update"), id: ProviderIdSchema }),
    /** Plan limits for the account behind a provider configuration, without an open session. */
    z.object({ kind: z.literal("usage"), id: ProviderIdSchema }),
    /** Sign-in state of the account behind a provider configuration, without an open session. */
    z.object({
      kind: z.literal("account"),
      id: ProviderIdSchema,
      action: AgentAccountActionSchema,
    }),
    /** Which subscription every chat on this machine uses for an engine; null = default account. */
    z.object({
      kind: z.literal("activate"),
      engine: z.enum(SUBSCRIPTION_ENGINES),
      id: ProviderIdSchema.nullable(),
      expectedRevision: z.number().int().nonnegative(),
    }),
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
      account: AgentAccountSchema.optional(),
      usage: AgentPlanUsageSchema.optional(),
    }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type ProviderResult = z.infer<typeof ProviderResultSchema>;

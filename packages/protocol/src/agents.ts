import { AgentAccountActionSchema, AgentAccountSchema } from "./agent-accounts.ts";
import { z } from "zod";
const Id = z.string().uuid();
export const AgentProviderIdSchema = z.enum(["codex", "claude", "opencode", "pi"]);
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;
export const agentProviderNames: Record<AgentProviderId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
};
export const AgentModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  efforts: z.array(z.string()),
  defaultEffort: z.string().nullable(),
  serviceTiers: z
    .array(z.object({ id: z.string(), label: z.string(), description: z.string() }))
    .max(20)
    .optional(),
});
export const AgentProviderCatalogSchema = z.object({
  id: AgentProviderIdSchema,
  models: z.array(AgentModelSchema).max(100),
  error: z.string().optional(),
});
export type AgentProviderCatalog = z.infer<typeof AgentProviderCatalogSchema>;
export const AgentQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  isSecret: z.boolean().default(false),
  options: z
    .array(z.object({ label: z.string(), description: z.string() }))
    .nullable()
    .default(null),
});
export const AgentPendingSchema = z.object({
  id: Id,
  turnId: z.string(),
  kind: z.enum(["approval", "questions"]),
  title: z.string(),
  summary: z.string().default(""),
  detail: z.string(),
  decisions: z.array(z.enum(["accept", "decline", "cancel"])),
  questions: z.array(AgentQuestionSchema).max(3),
});
export type AgentPending = z.infer<typeof AgentPendingSchema>;
export const AgentSettingsSchema = z.object({
  model: z.string().max(100).nullable().default(null),
  effort: z.string().min(1).max(100).nullable().default(null),
  mode: z.enum(["default", "auto-review", "full-access"]).default("default"),
  planMode: z.boolean().optional(),
  serviceTier: z.string().max(100).nullable().optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
export const AgentAttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  data: z
    .string()
    .max(1400000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;
const AgentPresentationSchema = z.object({
  type: z.enum(["shell", "files", "mcp", "search", "sub_agent", "plan", "thinking"]),
  command: z.string().max(16000).optional(),
  cwd: z.string().optional(),
  output: z.string().max(16000).optional(),
  input: z.string().max(16000).optional(),
  exitCode: z.number().nullable().optional(),
  files: z
    .array(z.object({ path: z.string(), diff: z.string().max(16000) }))
    .max(100)
    .optional(),
  steps: z
    .array(z.object({ step: z.string(), status: z.string() }))
    .max(100)
    .optional(),
  children: z
    .array(z.object({ id: z.string(), status: z.string(), message: z.string().nullable() }))
    .max(100)
    .optional(),
});
export type AgentPresentation = z.infer<typeof AgentPresentationSchema>;
export const AgentInfoSchema = z.object({
  id: Id,
  projectId: Id,
  provider: AgentProviderIdSchema,
  name: z.string(),
  directory: z.string(),
  model: z.string().nullable(),
  settings: AgentSettingsSchema.optional(),
  supportsPlan: z.boolean().optional(),
  models: z.array(AgentModelSchema).max(100).optional(),
  context: z
    .object({
      used: z.number().nonnegative(),
      limit: z.number().positive().nullable(),
      total: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
  threadId: z.string().nullable(),
  turnId: z.string().nullable(),
  status: z.enum(["idle", "starting", "working", "needs_input", "done", "failed", "interrupted"]),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  turnStartedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
  pending: z.array(AgentPendingSchema).max(16),
  attention: z
    .object({
      id: Id,
      kind: z.enum(["done", "needs_input"]),
      createdAt: z.string().datetime(),
      seen: z.boolean(),
    })
    .nullable()
    .default(null),
});
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export const AgentItemSchema = z.object({
  id: z.string(),
  sessionId: Id,
  turnId: z.string(),
  position: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative().default(0),
  kind: z.enum(["user", "assistant", "tool", "plan", "system"]),
  title: z.string(),
  text: z.string(),
  detail: z.string(),
  presentation: AgentPresentationSchema.optional(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  createdAt: z.string().datetime(),
});
export type AgentItem = z.infer<typeof AgentItemSchema>;
export const AgentConversationSchema = z.object({
  agent: AgentInfoSchema,
  items: z.array(AgentItemSchema).max(80),
  hasMore: z.boolean(),
});
export type AgentConversation = z.infer<typeof AgentConversationSchema>;
export const AgentOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("account"), sessionId: Id, action: AgentAccountActionSchema }),
  z.object({ kind: z.literal("provider-catalog"), sessionId: Id }),
  z.object({
    kind: z.literal("switch-provider"),
    sessionId: Id,
    provider: AgentProviderIdSchema,
    model: z.string().min(1).max(100).nullable(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("start"),
    provider: AgentProviderIdSchema.optional(),
    epoch: Id,
    projectId: Id,
    tabId: Id,
    paneId: Id,
    expectedVersion: z.number().int().nonnegative(),
    model: z.string().trim().min(1).max(100).optional(),
  }),
  z.object({
    kind: z.literal("read"),
    sessionId: Id,
    before: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal("seen"), sessionId: Id, attentionId: Id }),
  z.object({
    kind: z.literal("configure"),
    sessionId: Id,
    settings: AgentSettingsSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("refresh-models"), sessionId: Id }),
  z
    .object({
      kind: z.literal("send"),
      sessionId: Id,
      text: z.string().trim().max(16000),
      attachments: z.array(AgentAttachmentSchema).max(3).optional(),
    })
    .refine((v) => v.text.length > 0 || !!v.attachments?.length, "Add a message or attachment"),
  z.object({ kind: z.literal("interrupt"), sessionId: Id, turnId: z.string().min(1) }),
  z.object({
    kind: z.literal("respond"),
    sessionId: Id,
    pendingId: Id,
    decision: z.enum(["accept", "decline", "cancel"]).optional(),
    answers: z.record(z.string(), z.array(z.string().max(4000)).max(5)).optional(),
  }),
]);
export type AgentOperation = z.infer<typeof AgentOperationSchema>;
export const AgentRequestSchema = z.object({
  type: z.literal("agent.request"),
  requestId: Id,
  operation: AgentOperationSchema,
});
export type AgentRequest = z.infer<typeof AgentRequestSchema>;
export const AgentResultSchema = z.object({
  type: z.literal("agent.result"),
  requestId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      conversation: AgentConversationSchema,
      account: AgentAccountSchema.optional(),
      providers: z.array(AgentProviderCatalogSchema).max(16).optional(),
    }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent.list"), agents: z.array(AgentInfoSchema).max(128) }),
  z.object({ type: z.literal("agent.state"), agent: AgentInfoSchema }),
  z.object({ type: z.literal("agent.item"), item: AgentItemSchema }),
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;

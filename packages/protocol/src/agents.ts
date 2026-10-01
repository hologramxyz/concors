import { AgentAccountActionSchema, AgentAccountSchema } from "./agent-accounts.ts";
import { z } from "zod";
import { AgentPlanUsageSchema } from "./agent-usage.ts";
import { AgentControlsSchema, AgentFeatureValueSchema } from "./agent-controls.ts";
import { ProviderIdSchema, ProviderEngineSchema, ProviderVersionSchema } from "./providers.ts";
import { providerPresets } from "./provider-presets.ts";
import { NativeSessionSchema } from "./native-sessions.ts";
export { NativeSessionSchema, type NativeSession } from "./native-sessions.ts";
const Id = z.string().uuid();
export const MAX_AGENT_MODELS = 4096;
export const AgentModelIdSchema = z.string().min(1).max(1024);
export const builtinAgentProviders = [
  "codex",
  "claude",
  "opencode",
  "pi",
  "copilot",
  "omp",
] as const;
export const AgentProviderIdSchema = ProviderIdSchema;
export type AgentProviderId = z.infer<typeof AgentProviderIdSchema>;
export const agentProviderNames: Record<string, string> = Object.fromEntries(
  providerPresets.map((p) => [p.id, p.label]),
);
export const agentProviderName = (id: string): string => agentProviderNames[id] ?? id;
export const AgentModelSchema = z.object({
  id: AgentModelIdSchema,
  label: z.string(),
  resolvedModel: AgentModelIdSchema.optional(),
  isDefault: z.boolean().optional(),
  description: z.string().optional(),
  efforts: z.array(z.string()),
  defaultEffort: z.string().nullable(),
  supportsImages: z.boolean().optional(),
  contextWindow: z.number().positive().optional(),
  serviceTiers: z
    .array(z.object({ id: z.string(), label: z.string(), description: z.string() }))
    .max(20)
    .optional(),
});
export const AgentProviderCatalogSchema = z.object({
  id: AgentProviderIdSchema,
  revision: z.string().max(100).optional(),
  models: z.array(AgentModelSchema).max(MAX_AGENT_MODELS),
  label: z.string().optional(),
  loaded: z.boolean().optional(),
  error: z.string().optional(),
  /** New models often need a newer CLI, so the picker surfaces pending updates. */
  version: ProviderVersionSchema.optional(),
});
export type AgentProviderCatalog = z.infer<typeof AgentProviderCatalogSchema>;
export const AgentQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  isSecret: z.boolean().default(false),
  required: z.boolean().optional(),
  multiline: z.boolean().optional(),
  placeholder: z.string().max(1000).optional(),
  defaultValue: z.string().max(16000).optional(),
  multiSelect: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  options: z
    .array(z.object({ label: z.string(), description: z.string() }))
    .nullable()
    .default(null),
});
export type AgentQuestion = z.infer<typeof AgentQuestionSchema>;
export const AgentPendingSchema = z.object({
  id: Id,
  turnId: z.string(),
  asynchronous: z.boolean().optional(),
  sourceItemId: z.string().max(4096).optional(),
  kind: z.enum(["approval", "questions", "elicitation"]),
  title: z.string(),
  approvalKind: z.enum(["tool", "plan", "mode"]).optional(),
  plan: z.string().max(16000).optional(),
  actions: z
    .array(
      z.object({
        id: z.string().min(1).max(512),
        label: z.string().min(1).max(100),
        decision: z.enum(["accept", "decline", "cancel"]),
      }),
    )
    .max(32)
    .optional(),
  elicitation: z
    .object({ schema: z.record(z.string(), z.unknown()), url: z.string().url().optional() })
    .optional(),
  decisionLabels: z
    .object({
      accept: z.string().max(100).optional(),
      decline: z.string().max(100).optional(),
      cancel: z.string().max(100).optional(),
    })
    .optional(),
  summary: z.string().default(""),
  detail: z.string(),
  decisions: z.array(z.enum(["accept", "decline", "cancel"])),
  questions: z.array(AgentQuestionSchema).max(32),
});
export type AgentPending = z.infer<typeof AgentPendingSchema>;
export const AgentSettingsSchema = z.object({
  model: AgentModelIdSchema.nullable().default(null),
  effort: z.string().min(1).max(100).nullable().default(null),
  mode: z.enum(["default", "auto-review", "full-access"]).default("default"),
  planMode: z.boolean().optional(),
  serviceTier: z.string().max(100).nullable().optional(),
  nativeMode: z.string().min(1).max(512).nullable().optional(),
  features: z.record(z.string().max(128), AgentFeatureValueSchema).optional(),
});
export type AgentSettings = z.infer<typeof AgentSettingsSchema>;
/** Images an agent can show in one reply; a sent prompt still carries at most three files. */
export const MAX_MESSAGE_IMAGES = 8;
export const AgentAttachmentSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  data: z
    .string()
    .max(1400000)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;
/** The latest steps a sub-agent row keeps; its full conversation stays with the CLI. */
export const SUB_AGENT_STEPS = 40;
export const AgentActivityStepSchema = z.object({
  id: z.string().max(200),
  /** The tool it ran, as the CLI names it. */
  title: z.string().max(100),
  /** What it ran on: a file, a command, a search. */
  text: z.string().max(300),
  status: z.enum(["running", "completed", "failed"]),
  /** Which of several sub-agents one tool call started took the step. */
  childId: z.string().max(200).optional(),
});
export type AgentActivityStep = z.infer<typeof AgentActivityStepSchema>;
const AgentPresentationSchema = z.object({
  type: z.enum(["shell", "files", "mcp", "search", "sub_agent", "plan", "thinking"]),
  command: z.string().max(16000).optional(),
  cwd: z.string().optional(),
  output: z.string().max(16000).optional(),
  input: z.string().max(16000).optional(),
  exitCode: z.number().nullable().optional(),
  fileOperation: z.enum(["read", "edit"]).optional(),
  files: z
    .array(z.object({ path: z.string(), diff: z.string().max(16000) }))
    .max(100)
    .optional(),
  steps: z
    .array(
      z.object({
        step: z.string(),
        status: z.string(),
        id: z.string().optional(),
        activeForm: z.string().optional(),
      }),
    )
    .max(100)
    .optional(),
  children: z
    .array(z.object({ id: z.string(), status: z.string(), message: z.string().nullable() }))
    .max(100)
    .optional(),
  /** A sub-agent's kind as its CLI names it, such as Claude Code's "Explore". */
  agentType: z.string().max(100).optional(),
  /** What a sub-agent has done so far, oldest first; only the latest steps are kept. */
  activity: z.array(AgentActivityStepSchema).max(SUB_AGENT_STEPS).optional(),
});
export type AgentPresentation = z.infer<typeof AgentPresentationSchema>;
export const AgentInfoSchema = z.object({
  id: Id,
  projectId: Id,
  // Provider-specific conversations that can be restored in the same pane.
  providerGroupId: Id.optional(),
  provider: AgentProviderIdSchema,
  engine: ProviderEngineSchema.optional(),
  providerLabel: z.string().max(100).optional(),
  name: z.string(),
  // The custom names of its pane, and of its tab when alone in it, so a closed chat reopens as it was.
  paneName: z.string().max(120).optional(),
  tabName: z.string().max(120).optional(),
  directory: z.string(),
  model: z.string().nullable(),
  settings: AgentSettingsSchema.optional(),
  supportsPlan: z.boolean().optional(),
  controls: AgentControlsSchema.optional(),
  models: z.array(AgentModelSchema).max(MAX_AGENT_MODELS).optional(),
  queue: z
    .array(
      z.object({
        id: Id,
        text: z.string().max(16000),
        attachments: z.array(z.object({ name: z.string(), mime: z.string() })).max(3),
        queuedAt: z.string().datetime(),
      }),
    )
    .max(20)
    .optional(),
  queuePaused: z.boolean().optional(),
  historyRevision: z.number().int().nonnegative().optional(),
  context: z
    .object({
      used: z.number().nonnegative(),
      limit: z.number().positive().nullable(),
      total: z.number().nonnegative().nullable(),
    })
    .nullable()
    .optional(),
  threadId: z.string().nullable(),
  // An explicitly selected native session must never fall back to a new empty thread.
  nativeImport: z.boolean().optional(),
  turnId: z.string().nullable(),
  status: z.enum(["idle", "starting", "working", "needs_input", "done", "failed", "interrupted"]),
  error: z.string().nullable(),
  /**
   * The account behind the chat reached a plan limit during its last turn, so the chat can offer
   * the machine's other subscriptions. It describes the account in use, so a new turn or an
   * account switch clears it. `resetsAt` is ISO 8601 when the provider says.
   */
  limit: z
    .object({ resetsAt: z.string().max(40).nullable() })
    .nullable()
    .optional(),
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
  attachments: z
    .array(
      z.object({
        name: z.string().max(200),
        mime: z.string().max(100),
        /** For an image the agent showed, the destination written in its Markdown. */
        source: z.string().max(4096).optional(),
      }),
    )
    .max(MAX_MESSAGE_IMAGES)
    .optional(),
  status: z.enum(["running", "completed", "failed", "interrupted"]),
  createdAt: z.string().datetime(),
});
export type AgentItem = z.infer<typeof AgentItemSchema>;
export const AgentConversationSchema = z.object({
  agent: AgentInfoSchema,
  items: z.array(AgentItemSchema).max(80),
  hasMore: z.boolean(),
  // Optional for compatibility with daemons that only support backward paging.
  hasNewer: z.boolean().optional(),
});
export type AgentConversation = z.infer<typeof AgentConversationSchema>;
export const AgentMessageIndexSchema = z.object({
  messages: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().nonnegative(),
        preview: z.string().max(240),
      }),
    )
    .max(200),
  hasMore: z.boolean(),
});
export type AgentMessageIndex = z.infer<typeof AgentMessageIndexSchema>;
export const AgentOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("open-session"),
    sessionId: Id,
  }),
  z.object({
    kind: z.literal("resume-session"),
    sessionId: Id,
    provider: AgentProviderIdSchema,
    nativeSessionId: z.string().min(1).max(4096),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("read-attachment"),
    sessionId: Id,
    itemId: z.string().max(4096),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_MESSAGE_IMAGES - 1),
  }),
  z.object({
    kind: z.literal("implement-plan"),
    sessionId: Id,
    itemId: z.string().min(1).max(4096),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("child-history"),
    sessionId: Id,
    itemId: z.string().min(1).max(4096),
    childId: z.string().min(1).max(4096),
  }),
  z.object({ kind: z.literal("mcp-status"), sessionId: Id }),
  z.object({ kind: z.literal("sessions-list"), sessionId: Id }),
  z.object({
    kind: z.literal("import-session"),
    sessionId: Id,
    nativeSessionId: z.string().min(1).max(4096),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("fork-session"),
    sessionId: Id,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("rewind"),
    sessionId: Id,
    turnId: z.string().min(1),
    mode: z.enum(["conversation", "files", "both"]),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("steer"),
    sessionId: Id,
    turnId: z.string().min(1),
    text: z.string().trim().min(1).max(16000),
  }),
  z
    .object({
      kind: z.literal("queue-add"),
      sessionId: Id,
      text: z.string().trim().max(16000),
      attachments: z.array(AgentAttachmentSchema).max(3).optional(),
    })
    .refine((v) => v.text.length > 0 || !!v.attachments?.length, "Add a message or attachment"),
  z.object({ kind: z.literal("queue-remove"), sessionId: Id, id: Id }),
  z.object({ kind: z.literal("queue-pause"), sessionId: Id, paused: z.boolean() }),
  z.object({
    kind: z.literal("provider-catalog"),
    sessionId: Id,
    provider: AgentProviderIdSchema.optional(),
  }),
  z.object({ kind: z.literal("account"), sessionId: Id, action: AgentAccountActionSchema }),
  /** What is left of the plan behind this session's provider. */
  z.object({ kind: z.literal("usage"), sessionId: Id }),
  z.object({
    kind: z.literal("switch-provider"),
    sessionId: Id,
    provider: AgentProviderIdSchema,
    model: AgentModelIdSchema.nullable(),
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
    model: AgentModelIdSchema.optional(),
  }),
  z
    .object({
      kind: z.literal("read"),
      sessionId: Id,
      before: z.number().int().nonnegative().optional(),
      after: z.number().int().nonnegative().optional(),
    })
    .refine((read) => read.before === undefined || read.after === undefined, {
      message: "Read history in one direction at a time",
    }),
  z.object({
    kind: z.literal("list-messages"),
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
  z.object({
    kind: z.literal("command"),
    sessionId: Id,
    name: z.string().min(1).max(128),
    args: z.string().max(16000).default(""),
  }),
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
    actionId: z.string().min(1).max(512).optional(),
    decision: z.enum(["accept", "decline", "cancel"]).optional(),
    answers: z.record(z.string(), z.array(z.string().max(16000)).max(128)).optional(),
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
      providers: z.array(AgentProviderCatalogSchema).max(128).optional(),
      sessions: z.array(NativeSessionSchema).max(100).optional(),
      childItems: z.array(AgentItemSchema).max(80).optional(),
      servers: z
        .array(z.object({ name: z.string(), status: z.string() }))
        .max(100)
        .optional(),
      account: AgentAccountSchema.optional(),
      attachment: AgentAttachmentSchema.optional(),
      messageIndex: AgentMessageIndexSchema.optional(),
      usage: AgentPlanUsageSchema.optional(),
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

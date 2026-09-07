import { z } from "zod";
const Id = z.string().uuid();
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
export const AgentInfoSchema = z.object({
  id: Id,
  projectId: Id,
  provider: z.literal("codex"),
  name: z.string(),
  directory: z.string(),
  model: z.string().nullable(),
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
  z.object({
    kind: z.literal("start"),
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
  z.object({ kind: z.literal("send"), sessionId: Id, text: z.string().trim().min(1).max(16000) }),
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
    z.object({ status: z.literal("ok"), conversation: AgentConversationSchema }),
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

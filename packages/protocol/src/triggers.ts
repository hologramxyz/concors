import { z } from "zod";
import { AgentProviderIdSchema, AgentModelIdSchema } from "./agents.ts";

export const WEBHOOK_TRIGGERS_CAPABILITY = "webhook-triggers-v1";
export const TriggerDefinitionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    projectId: z.uuid().nullable(),
    prompt: z
      .string()
      .trim()
      .max(16000)
      .refine((s) => !s.startsWith("/"), "Use a prompt, not a slash command"),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("session"), sessionId: z.uuid() }),
      z.object({
        kind: z.literal("agent"),
        provider: AgentProviderIdSchema,
        model: AgentModelIdSchema.nullable(),
      }),
      z.object({ kind: z.literal("supervisor") }),
    ]),
    mode: z.enum(["same", "new"]),
    enabled: z.boolean(),
  })
  .refine(
    (v) =>
      v.target.kind === "supervisor"
        ? v.mode === "same" && v.projectId === null
        : v.projectId !== null,
    "Supervisor triggers use same mode and no project; other targets need a project",
  );
export type TriggerDefinition = z.infer<typeof TriggerDefinitionSchema>;
export const TriggerEventSchema = z.object({
  id: z.uuid(),
  receivedAt: z.iso.datetime(),
  source: z.string().max(40),
  idempotencyKey: z.string().max(256).nullable(),
  status: z.enum(["received", "delivered", "queued", "duplicate", "failed"]),
  sessionId: z.uuid().nullable(),
  message: z.string().max(1000).nullable(),
  bytes: z.number().int().nonnegative(),
});
export type TriggerEvent = z.infer<typeof TriggerEventSchema>;
export const AgentTriggerSchema = TriggerDefinitionSchema.safeExtend({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sessionId: z.uuid().nullable(),
  secretHint: z.string().length(4),
  events: z.array(TriggerEventSchema),
});
export type AgentTrigger = z.infer<typeof AgentTriggerSchema>;
export const TriggerRequestSchema = z.object({
  type: z.literal("trigger.request"),
  requestId: z.uuid(),
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("list") }),
    z.object({ kind: z.literal("create"), trigger: TriggerDefinitionSchema }),
    z.object({
      kind: z.literal("update"),
      id: z.uuid(),
      expectedRevision: z.number().int().nonnegative(),
      trigger: TriggerDefinitionSchema,
    }),
    z.object({
      kind: z.literal("delete"),
      id: z.uuid(),
      expectedRevision: z.number().int().nonnegative(),
    }),
    z.object({
      kind: z.literal("rotate"),
      id: z.uuid(),
      expectedRevision: z.number().int().nonnegative(),
    }),
  ]),
});
export type TriggerRequest = z.infer<typeof TriggerRequestSchema>;
export const TriggerListSchema = z.object({
  type: z.literal("trigger.list"),
  triggers: z.array(AgentTriggerSchema).max(64),
});
export const TriggerResultSchema = z.object({
  type: z.literal("trigger.result"),
  requestId: z.uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      triggers: z.array(AgentTriggerSchema).max(64),
      secret: z.string().optional(),
    }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type TriggerResult = z.infer<typeof TriggerResultSchema>;

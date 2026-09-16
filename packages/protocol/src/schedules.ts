import { z } from "zod";
import { AgentProviderIdSchema, AgentModelIdSchema } from "./agents.ts";

export const SCHEDULES_CAPABILITY = "agent-schedules-v1";
const Timezone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid time zone");
const Time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const ScheduleCadenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(15).max(43200) }),
  z.object({ kind: z.literal("daily"), time: Time, timezone: Timezone }),
  z.object({
    kind: z.literal("weekly"),
    time: Time,
    timezone: Timezone,
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  }),
]);
export type ScheduleCadence = z.infer<typeof ScheduleCadenceSchema>;
export const ScheduleTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("session"), sessionId: z.uuid() }),
  z.object({
    kind: z.literal("agent"),
    provider: AgentProviderIdSchema,
    model: AgentModelIdSchema.nullable(),
  }),
]);
export const ScheduleDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  projectId: z.uuid(),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(16000)
    .refine((s) => !s.startsWith("/"), "Schedule a prompt, not a slash command"),
  target: ScheduleTargetSchema,
  cadence: ScheduleCadenceSchema,
  enabled: z.boolean(),
});
export type ScheduleDefinition = z.infer<typeof ScheduleDefinitionSchema>;
export const ScheduleRunSchema = z.object({
  id: z.uuid(),
  scheduledAt: z.iso.datetime(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  sessionId: z.uuid().nullable(),
  turnId: z.string().nullable(),
  status: z.enum(["running", "needs_input", "done", "failed", "skipped", "interrupted"]),
  message: z.string().max(1000).nullable(),
});
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
export const AgentScheduleSchema = ScheduleDefinitionSchema.extend({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  source: z.enum(["user", "agent"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  nextRunAt: z.iso.datetime().nullable(),
  sessionId: z.uuid().nullable(),
  runs: z.array(ScheduleRunSchema).max(20),
});
export type AgentSchedule = z.infer<typeof AgentScheduleSchema>;
export const ScheduleOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list") }),
  z.object({ kind: z.literal("create"), schedule: ScheduleDefinitionSchema }),
  z.object({
    kind: z.literal("update"),
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    schedule: ScheduleDefinitionSchema,
  }),
  z.object({
    kind: z.literal("delete"),
    id: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ kind: z.literal("run"), id: z.uuid() }),
]);
export type ScheduleOperation = z.infer<typeof ScheduleOperationSchema>;
export const ScheduleRequestSchema = z.object({
  type: z.literal("schedule.request"),
  requestId: z.uuid(),
  operation: ScheduleOperationSchema,
});
export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;
export const ScheduleListSchema = z.object({
  type: z.literal("schedule.list"),
  schedules: z.array(AgentScheduleSchema).max(64),
});
export const ScheduleResultSchema = z.object({
  type: z.literal("schedule.result"),
  requestId: z.uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), schedules: z.array(AgentScheduleSchema).max(64) }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type ScheduleResult = z.infer<typeof ScheduleResultSchema>;

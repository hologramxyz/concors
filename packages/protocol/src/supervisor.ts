import { z } from "zod";
import { WorkspaceCommandSchema, WorkspaceProjectSchema } from "./workspace.ts";

const Id = z.string().uuid();
/** The native iOS host supplies the recipients it actually disclosed, never the model. */
export const SupervisorSharingSchema = z.object({
  revision: z.number().int().nonnegative(),
  providers: z.array(z.string().min(1).max(128)).max(64),
});
export type SupervisorSharing = z.infer<typeof SupervisorSharingSchema>;

export const SupervisorDeliverySchema = z.object({
  id: Id,
  supervisorId: Id,
  sessionId: Id,
  projectId: Id,
  text: z.string().max(16000),
  status: z.enum([
    "pending",
    "queued",
    "working",
    "needs_input",
    "done",
    "failed",
    "interrupted",
    "cancelled",
  ]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().max(4000).optional(),
});
export type SupervisorDelivery = z.infer<typeof SupervisorDeliverySchema>;
export const SupervisorRequestSchema = z.object({
  type: z.literal("supervisor.request"),
  requestId: Id,
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("open") }),
    z.object({ kind: z.literal("status") }),
    z.object({ kind: z.literal("revoke-sharing") }),
  ]),
});
export type SupervisorRequest = z.infer<typeof SupervisorRequestSchema>;
export type SupervisorOperation = SupervisorRequest["operation"];
export const SupervisorResultSchema = z.object({
  type: z.literal("supervisor.result"),
  requestId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("ok"),
      project: WorkspaceProjectSchema.optional(),
      deliveries: z.array(SupervisorDeliverySchema).max(128),
    }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type SupervisorResult = z.infer<typeof SupervisorResultSchema>;

/** One typed contract for MCP and the local command bridge. The calling session is authenticated separately. */
export const SupervisorControlSchema = z.object({
  requestId: Id,
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("workspaces") }),
    z.object({ kind: z.literal("layout"), projectId: Id }),
    z.object({
      kind: z.literal("sessions"),
      projectId: Id.optional(),
      query: z.string().max(500).optional(),
      offset: z.number().int().min(0).default(0),
    }),
    z.object({
      kind: z.literal("read"),
      sessionId: Id,
      before: z.number().int().min(0).optional(),
    }),
    z.object({
      kind: z.literal("send"),
      sessionId: Id,
      text: z.string().trim().min(1).max(16000),
      whenBusy: z.enum(["queue", "reject", "steer"]).default("queue"),
    }),
    z.object({
      kind: z.literal("start"),
      projectId: Id,
      provider: z.string().min(1).max(128),
      model: z.string().max(1024).optional(),
    }),
    z.object({ kind: z.literal("workspace"), command: WorkspaceCommandSchema }),
    z.object({ kind: z.literal("open-session"), sessionId: Id }),
    z.object({
      kind: z.literal("interrupt"),
      sessionId: Id,
      turnId: z.string().min(1),
      confirmed: z.literal(true),
    }),
    z.object({ kind: z.literal("queue-remove"), sessionId: Id, id: Id }),
    z.object({ kind: z.literal("status") }),
  ]),
});
export type SupervisorControl = z.infer<typeof SupervisorControlSchema>;

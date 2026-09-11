import { z } from "zod";
import { SavedTerminalProfileSchema } from "./terminal-profiles.ts";

const Id = z.string().uuid();
const Size = { cols: z.number().int().min(10).max(240), rows: z.number().int().min(2).max(100) };
export const TerminalProfileSchema = z.enum(["shell", "codex", "claude", "opencode"]);
export type TerminalProfile = z.infer<typeof TerminalProfileSchema>;
export const TerminalInfoSchema = z.object({
  agentActivity: z.enum(["unknown", "idle", "working", "needs_input"]).optional(),
  // Separate from activity so older clients can still parse the idle state.
  agentTurnCompleted: z.boolean().optional(),
  id: Id,
  projectId: Id,
  profile: TerminalProfileSchema,
  terminalProfile: SavedTerminalProfileSchema.optional(),
  detectedAgent: z.enum(["codex", "claude", "opencode"]).nullable().optional(),
  currentDirectory: z.string().min(1).max(4096).optional(),
  directory: z.string(),
  status: z.enum(["starting", "running", "exited", "failed", "interrupted"]),
  exitCode: z.number().int().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().datetime(),
  ...Size,
});
export type TerminalInfo = z.infer<typeof TerminalInfoSchema>;
export const TerminalOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
    recover: z.boolean().optional(),
    epoch: Id,
    projectId: Id,
    tabId: Id,
    paneId: Id,
    expectedVersion: z.number().int().nonnegative(),
    expectedSessionId: Id.nullable(),
    ...Size,
  }),
  z.object({ kind: z.literal("attach"), sessionId: Id }),
  z.object({ kind: z.literal("detach"), sessionId: Id }),
  z.object({ kind: z.literal("claim"), sessionId: Id, ifUnowned: z.boolean().optional(), ...Size }),
  z.object({ kind: z.literal("resize"), sessionId: Id, ...Size }),
  z.object({ kind: z.literal("stop"), sessionId: Id }),
  z.object({ kind: z.literal("list") }),
  z.object({
    kind: z.literal("bind"),
    projectId: Id,
    tabId: Id,
    paneId: Id,
    expectedVersion: z.number().int().nonnegative(),
    sessionId: Id,
  }),
]);
export type TerminalOperation = z.infer<typeof TerminalOperationSchema>;
export const TerminalRequestSchema = z.object({
  type: z.literal("terminal.request"),
  requestId: Id,
  operation: TerminalOperationSchema,
});
export type TerminalRequest = z.infer<typeof TerminalRequestSchema>;
export const TerminalInputSchema = z.object({
  type: z.literal("terminal.input"),
  sessionId: Id,
  data: z.string().min(1).max(16_384),
});
export const TerminalResultSchema = z.object({
  type: z.literal("terminal.result"),
  requestId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), sessions: z.array(TerminalInfoSchema).max(256) }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type TerminalResult = z.infer<typeof TerminalResultSchema>;
export const TerminalEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("terminal.snapshot"),
    session: TerminalInfoSchema,
    sequence: z.number().int().nonnegative(),
    data: z.string(),
    ownerId: Id.nullable(),
    viewerId: Id,
  }),
  z.object({
    type: z.literal("terminal.output"),
    sessionId: Id,
    sequence: z.number().int().nonnegative(),
    data: z.string(),
  }),
  z.object({ type: z.literal("terminal.state"), session: TerminalInfoSchema }),
  z.object({ type: z.literal("terminal.owner"), sessionId: Id, ownerId: Id.nullable(), ...Size }),
  z.object({ type: z.literal("terminal.error"), sessionId: Id, message: z.string() }),
]);
export type TerminalEvent = z.infer<typeof TerminalEventSchema>;

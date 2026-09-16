import { z } from "zod";

export const RESOURCES_CAPABILITY = "machine-resources";
const Bytes = z.number().int().nonnegative();
const Path = z.string().max(4096);

export const MachineProcessSchema = z.object({
  id: z.string().max(120),
  pid: z.number().int().positive(),
  parentPid: z.number().int().nonnegative(),
  name: z.string().max(160),
  directory: Path.nullable(),
  projectId: z.string().uuid().nullable(),
  cpuPercent: z.number().min(0).max(100).nullable(),
  memoryBytes: Bytes.nullable(),
  state: z.enum(["running", "sleeping", "stopped", "zombie", "unknown"]),
  ports: z.array(z.number().int().min(1).max(65535)).max(64),
  stopBlocked: z.string().max(500).nullable(),
});
export type MachineProcess = z.infer<typeof MachineProcessSchema>;

export const ProcessSnapshotSchema = z.object({
  sampledAt: z.number().int().nonnegative(),
  processes: z.array(MachineProcessSchema).max(4096),
  warnings: z.array(z.string().max(500)).max(20),
});
export type ProcessSnapshot = z.infer<typeof ProcessSnapshotSchema>;

export const ResourceOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("processes") }),
  z.object({ kind: z.literal("stop"), id: z.string().max(120) }),
]);
export type ResourceOperation = z.infer<typeof ResourceOperationSchema>;
export const ResourceRequestSchema = z.object({
  type: z.literal("resource.request"),
  requestId: z.string().uuid(),
  operation: ResourceOperationSchema,
});
export type ResourceRequest = z.infer<typeof ResourceRequestSchema>;
export const ResourceResultSchema = z.object({
  type: z.literal("resource.result"),
  requestId: z.string().uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("processes"), snapshot: ProcessSnapshotSchema }),
    z.object({ status: z.literal("done"), message: z.string().max(1000) }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type ResourceResult = z.infer<typeof ResourceResultSchema>;

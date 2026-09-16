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

export const StorageEntrySchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["worktree", "temporary", "cache"]),
  path: Path,
  bytes: Bytes.nullable(),
  modifiedAt: z.number().nonnegative(),
  memoryBacked: z.boolean(),
  branch: z.string().max(500).nullable(),
  cleanupBlocked: z.string().max(500).nullable(),
});
export type StorageEntry = z.infer<typeof StorageEntrySchema>;

export const StorageSnapshotSchema = z.object({
  scannedAt: z.number().int().nonnegative(),
  volumes: z
    .array(
      z.object({ path: Path, totalBytes: Bytes, availableBytes: Bytes, memoryBacked: z.boolean() }),
    )
    .max(10),
  entries: z.array(StorageEntrySchema).max(256),
  warnings: z.array(z.string().max(500)).max(20),
});
export type StorageSnapshot = z.infer<typeof StorageSnapshotSchema>;

export const ResourceOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("processes") }),
  z.object({ kind: z.literal("storage") }),
  z.object({ kind: z.literal("stop"), id: z.string().max(120) }),
  // Only daemon-issued candidate IDs are accepted, never arbitrary client paths.
  z.object({ kind: z.literal("cleanup"), id: z.string().uuid(), confirmation: Path }),
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
    z.object({ status: z.literal("storage"), snapshot: StorageSnapshotSchema }),
    z.object({ status: z.literal("done"), message: z.string().max(1000) }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type ResourceResult = z.infer<typeof ResourceResultSchema>;

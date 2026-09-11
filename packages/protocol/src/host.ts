import { z } from "zod";

/** Opt-in, machine-wide telemetry; never contains process names or user data. */
export const HOST_USAGE_CAPABILITY = "host-usage";
export const HOST_USAGE_INTERVAL_MS = 2_000;

export const HostUsageSchema = z.object({
  sampledAt: z.number().int().nonnegative(),
  /** Aggregate busy percentage across logical CPUs; null while establishing a baseline. */
  cpuPercent: z.number().min(0).max(100).nullable(),
  cpuCount: z.number().int().nonnegative(),
  memory: z
    .object({
      usedBytes: z.number().int().nonnegative(),
      totalBytes: z.number().int().positive(),
    })
    .refine((memory) => memory.usedBytes <= memory.totalBytes),
});
export type HostUsage = z.infer<typeof HostUsageSchema>;

export const HostSubscribeSchema = z.object({
  type: z.literal("host.subscribe"),
  enabled: z.boolean(),
});

export const HostUsageMessageSchema = z.object({
  type: z.literal("host.usage"),
  /** null means collection failed, not zero usage. */
  usage: HostUsageSchema.nullable(),
});

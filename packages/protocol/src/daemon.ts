import { z } from "zod";

import { ProtocolVersionSchema, SemverSchema } from "./version.ts";

/**
 * Coarse lifecycle state of a daemon process.
 *
 * - `starting`      – process is up but not yet accepting sessions
 * - `ready`         – accepting connections and (eventually) agent sessions
 * - `shutting_down` – draining; clients should not start new work
 */
export const DAEMON_STATUSES = ["starting", "ready", "shutting_down"] as const;

export const DaemonStatusSchema = z.enum(DAEMON_STATUSES);
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

/** Identity and state a daemon reports about itself. */
export const DaemonInfoSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  daemonVersion: SemverSchema,
  status: DaemonStatusSchema,
});
export type DaemonInfo = z.infer<typeof DaemonInfoSchema>;

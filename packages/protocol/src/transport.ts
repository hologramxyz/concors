import { z } from "zod";

/*
 * Transport conventions. These describe *where* the protocol is served, not the messages
 * themselves. Any daemon implementation (TypeScript today, possibly Rust tomorrow) must expose
 * the same endpoints.
 */

/** HTTP liveness probe. Returns `HealthResponse`. */
export const HEALTH_PATH = "/health";

/** WebSocket endpoint that speaks the message protocol defined in `messages.ts`. */
export const WS_PATH = "/ws";

/** Port a locally-bundled daemon listens on unless configured otherwise. */
export const DEFAULT_LOCAL_DAEMON_PORT = 7420;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/**
 * Whether a machine's agents are in the middle of something, for the control plane: it installs a
 * new daemon only when this says the machine is not busy, because installing restarts every agent
 * on it. Managed daemons serve it behind the machine token. Returns `ActivityResponse`.
 */
export const ACTIVITY_PATH = "/activity";

export const ActivityResponseSchema = z.object({
  busy: z.boolean(),
  agents: z.object({
    working: z.number().int().nonnegative(),
    waiting: z.number().int().nonnegative(),
  }),
});
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

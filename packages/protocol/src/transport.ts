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

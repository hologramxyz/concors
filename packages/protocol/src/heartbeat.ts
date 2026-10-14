import { z } from "zod";

/**
 * A connection can die without closing: after sleep, a network change, or a proxy that drops an
 * idle socket. Neither end notices, and every request sent into it just waits. A daemon that
 * advertises this sends a heartbeat on each connection, so a client that hears nothing for a
 * while knows the socket is gone and reconnects. The traffic also keeps idle proxies from
 * dropping the connection in the first place.
 */
export const HEARTBEAT_CAPABILITY = "heartbeat";
export const HEARTBEAT_INTERVAL_MS = 15_000;
/** Three missed heartbeats: long enough for a busy daemon, short enough to notice quickly. */
export const HEARTBEAT_SILENCE_MS = 45_000;
export const DaemonHeartbeatSchema = z.object({ type: z.literal("daemon.heartbeat") });
export type DaemonHeartbeat = z.infer<typeof DaemonHeartbeatSchema>;

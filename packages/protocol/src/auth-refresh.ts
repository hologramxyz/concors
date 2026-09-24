import { z } from "zod";

/**
 * Advertised by a managed gateway in `daemon.ready`: a client may hand it a freshly minted
 * machine token on the live socket, so access is renewed without dropping the connection.
 */
export const AUTH_REFRESH_CAPABILITY = "auth-refresh";

/** Handled by the managed gateway; never forwarded to the session host. */
export const AuthRefreshMessageSchema = z.object({
  type: z.literal("auth.refresh"),
  token: z.string().min(1).max(8192),
});
export type AuthRefreshMessage = z.infer<typeof AuthRefreshMessageSchema>;

/** `expiresAt` (ms since epoch) is the socket's new deadline when `ok`. */
export const AuthRefreshedMessageSchema = z.object({
  type: z.literal("auth.refreshed"),
  ok: z.boolean(),
  expiresAt: z.number().int().positive().optional(),
});
export type AuthRefreshedMessage = z.infer<typeof AuthRefreshedMessageSchema>;

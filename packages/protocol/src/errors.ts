import { z } from "zod";

/**
 * Stable, machine-readable error codes. Clients should branch on `code`, never on `message`.
 * Codes are part of the protocol contract: renaming or removing one is a breaking change.
 */
export const ERROR_CODES = [
  "INVALID_MESSAGE",
  "UNKNOWN_MESSAGE_TYPE",
  "HANDSHAKE_REQUIRED",
  "HANDSHAKE_TIMEOUT",
  "PROTOCOL_VERSION_UNSUPPORTED",
  "INTERNAL_ERROR",
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Structured error payload shared by every transport (WebSocket messages, HTTP bodies). */
export const ProtocolErrorSchema = z.object({
  code: ErrorCodeSchema,
  /** Human-readable description intended for logs and developer tooling, not for end users. */
  message: z.string(),
  /** Optional structured context (e.g. validation issues). Must be JSON-serialisable. */
  details: z.unknown().optional(),
});
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;

export function createProtocolError(
  code: ErrorCode,
  message: string,
  details?: unknown,
): ProtocolError {
  return details === undefined ? { code, message } : { code, message, details };
}

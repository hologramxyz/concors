import { FileRequestSchema, FileResultSchema } from "./files.ts";
import { AgentRequestSchema, AgentResultSchema, AgentEventSchema } from "./agents.ts";
import { ProjectRequestSchema, ProjectResultSchema, ProjectSetupsSchema } from "./projects.ts";
import { z } from "zod";
import {
  TerminalRequestSchema,
  TerminalInputSchema,
  TerminalResultSchema,
  TerminalEventSchema,
} from "./terminal.ts";

import { ClientInfoSchema } from "./client.ts";
import { DaemonInfoSchema } from "./daemon.ts";
import { ProtocolErrorSchema } from "./errors.ts";
import { ProtocolVersionSchema } from "./version.ts";
import {
  WorkspaceCommandSchema,
  WorkspaceSubscribeSchema,
  WorkspaceSnapshotMessageSchema,
  WorkspaceResultSchema,
} from "./workspace.ts";

/*
 * WebSocket messages are JSON objects discriminated by a dotted `type` string:
 *
 *   <sender>.<event>   e.g. "client.hello", "daemon.ready"
 *
 * The handshake precedes workspace subscriptions and commands. New runtime messages extend
 * the same discriminated envelope.
 *
 *   client                                 daemon
 *     │ ── client.hello ──────────────────▶ │  validate + negotiate protocol version
 *     │ ◀────────────────── daemon.ready ── │  connection is now usable
 *     │ ◀──────────────── (or) error ────── │  followed by close
 */

// ───────────────────────────── client → daemon ─────────────────────────────

export const ClientHelloMessageSchema = z.object({
  type: z.literal("client.hello"),
  protocolVersion: ProtocolVersionSchema,
  client: ClientInfoSchema,
});
export type ClientHelloMessage = z.infer<typeof ClientHelloMessageSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  ClientHelloMessageSchema,
  WorkspaceSubscribeSchema,
  WorkspaceCommandSchema,
  TerminalRequestSchema,
  TerminalInputSchema,
  ProjectRequestSchema,
  AgentRequestSchema,
  FileRequestSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ───────────────────────────── daemon → client ─────────────────────────────

export const DaemonReadyMessageSchema = DaemonInfoSchema.extend({
  type: z.literal("daemon.ready"),
});
export type DaemonReadyMessage = z.infer<typeof DaemonReadyMessageSchema>;

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  error: ProtocolErrorSchema,
});
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;

export const DaemonMessageSchema = z.discriminatedUnion("type", [
  DaemonReadyMessageSchema,
  ErrorMessageSchema,
  WorkspaceSnapshotMessageSchema,
  WorkspaceResultSchema,
  TerminalResultSchema,
  ...TerminalEventSchema.options,
  ProjectResultSchema,
  ProjectSetupsSchema,
  FileResultSchema,
  AgentResultSchema,
  ...AgentEventSchema.options,
]);
export type DaemonMessage = z.infer<typeof DaemonMessageSchema>;

// ───────────────────────────── helpers ─────────────────────────────

/** Parses raw wire text (or an already-decoded value) into a validated client message. */
export function parseClientMessage(raw: unknown): z.ZodSafeParseResult<ClientMessage> {
  return ClientMessageSchema.safeParse(decodeIfString(raw));
}

/** Parses raw wire text (or an already-decoded value) into a validated daemon message. */
export function parseDaemonMessage(raw: unknown): z.ZodSafeParseResult<DaemonMessage> {
  return DaemonMessageSchema.safeParse(decodeIfString(raw));
}

function decodeIfString(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    // Return a value that will fail schema validation with a useful issue instead of throwing.
    return { type: "<unparseable json>" };
  }
}

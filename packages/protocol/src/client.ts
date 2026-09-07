import { z } from "zod";

import { SemverSchema } from "./version.ts";

/** Which kind of Concors client is connecting. Purely informational for now (logging, diagnostics). */
export const CLIENT_KINDS = ["desktop", "mobile", "web", "cli", "test"] as const;

export const ClientKindSchema = z.enum(CLIENT_KINDS);
export type ClientKind = z.infer<typeof ClientKindSchema>;

/** Identity a client presents during the handshake. */
export const ClientInfoSchema = z.object({
  kind: ClientKindSchema,
  /** Human-readable client name, e.g. `concors-desktop`. */
  name: z.string().min(1).max(100),
  version: SemverSchema,
  /** Free-form platform hint, e.g. `macos`, `windows`, `linux`, `ios`, `android`, `browser`. */
  platform: z.string().min(1).max(50).optional(),
});
export type ClientInfo = z.infer<typeof ClientInfoSchema>;

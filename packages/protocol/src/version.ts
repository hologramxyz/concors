import { z } from "zod";

/**
 * Every protocol revision gets a new literal here. Clients and daemons negotiate the version
 * during the handshake; a daemon that does not support the requested version must reject the
 * connection with a `PROTOCOL_VERSION_UNSUPPORTED` error instead of guessing.
 */
export const PROTOCOL_VERSIONS = ["v1"] as const;

export const ProtocolVersionSchema = z.enum(PROTOCOL_VERSIONS);
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

/** The protocol version implemented by this copy of the package. */
export const PROTOCOL_VERSION: ProtocolVersion = "v1";

/**
 * Loose semantic-version string used for daemon and client versions.
 * Intentionally permissive (pre-release/build metadata allowed) — it is informational only and
 * never used for compatibility decisions; that is what `ProtocolVersion` is for.
 */
export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "Expected a semver string");
export type Semver = z.infer<typeof SemverSchema>;

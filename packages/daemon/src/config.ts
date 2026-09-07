import { DEFAULT_LOCAL_DAEMON_PORT } from "@concors/protocol";
import { z } from "zod";

/**
 * Runtime configuration for one daemon process.
 *
 * Precedence: CLI flags > environment variables > defaults. Defaults are tuned for the bundled
 * local daemon (loopback only). A VPS deployment overrides host/port explicitly.
 */
export const DaemonConfigSchema = z.object({
  /** Interface to bind. Loopback by default so a local daemon is never exposed accidentally. */
  host: z.string().min(1).default("127.0.0.1"),
  /** `0` asks the OS for a free port (useful for tests and for a client-managed local daemon). */
  port: z.coerce.number().int().min(0).max(65_535).default(DEFAULT_LOCAL_DAEMON_PORT),
  logLevel: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});
export type DaemonConfig = z.infer<typeof DaemonConfigSchema>;

export interface DaemonConfigOverrides {
  readonly host?: string | undefined;
  readonly port?: string | number | undefined;
  readonly logLevel?: string | undefined;
}

export class DaemonConfigError extends Error {
  override readonly name = "DaemonConfigError";
}

export function loadDaemonConfig(
  overrides: DaemonConfigOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): DaemonConfig {
  const result = DaemonConfigSchema.safeParse({
    host: overrides.host ?? env["CONCORS_DAEMON_HOST"],
    port: overrides.port ?? env["CONCORS_DAEMON_PORT"],
    logLevel: overrides.logLevel ?? env["CONCORS_DAEMON_LOG_LEVEL"],
  });

  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new DaemonConfigError(`Invalid daemon configuration:\n  ${problems.join("\n  ")}`);
  }
  return result.data;
}

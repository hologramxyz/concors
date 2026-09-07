import { z } from "zod";

/**
 * Build-time configuration for the desktop client. Values come from `VITE_*` environment variables
 * (see `.env.example`) and are validated once at startup so a misconfiguration fails loudly.
 *
 * Everything here is public: it ends up in the shipped bundle. Secrets never belong here.
 */
const EnvSchema = z.object({
  /** Concors control-plane API base URL. */
  VITE_CONCORS_API_URL: z.url().default("http://localhost:3000"),
  /** Optional explicit daemon URL; when unset the app manages a local daemon itself. */
  VITE_CONCORS_DAEMON_URL: z.string().min(1).optional(),
});

export interface AppEnv {
  readonly apiUrl: string;
  readonly daemonUrl: string | undefined;
}

export function parseEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${problems.join("\n")}`);
  }
  return {
    apiUrl: parsed.data.VITE_CONCORS_API_URL,
    daemonUrl: parsed.data.VITE_CONCORS_DAEMON_URL,
  };
}

export const env: AppEnv = parseEnv(import.meta.env);

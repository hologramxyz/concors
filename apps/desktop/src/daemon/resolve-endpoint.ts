import {
  describeDaemonEndpoint,
  localDaemonEndpoint,
  type DaemonEndpoint,
} from "@concors/daemon-client";

import { preferredConnection, type Host } from "../workspace/machines.ts";

import { env } from "../config/env.ts";
import { isTauri, localDaemon, type DaemonIdentity } from "../tauri/index.ts";

/**
 * Native builds own their bundled runtime; browser/dev overrides never redirect a packaged app.
 * The identity selects the runtime's data partition, so it is only resolvable once signed in.
 */
export async function resolveStartupEndpoint(identity: DaemonIdentity): Promise<DaemonEndpoint> {
  if (isTauri()) {
    const status = await localDaemon.start(identity);
    if (status.state === "running") return localDaemonEndpoint(status.port);
    if (import.meta.env.DEV) return localDaemonEndpoint();
    throw new Error(
      "This desktop build is missing its local runtime. Install a complete Concors desktop package.",
    );
  }
  if (env.daemonUrl !== undefined)
    return describeDaemonEndpoint(env.daemonUrl, "Configured daemon");
  return localDaemonEndpoint();
}

export function resolveHostEndpoint(
  host: Host,
  local: DaemonEndpoint | null,
): DaemonEndpoint | null {
  const connection = preferredConnection(host);
  if (!connection) return null;
  return connection.kind === "local" ? local : describeDaemonEndpoint(connection.url, host.label);
}

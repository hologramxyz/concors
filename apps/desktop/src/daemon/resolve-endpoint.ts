import {
  describeDaemonEndpoint,
  localDaemonEndpoint,
  type DaemonEndpoint,
} from "@concors/daemon-client";

import { env } from "../config/env.ts";
import { isTauri, localDaemon } from "../tauri/index.ts";

/**
 * Decides which daemon this app instance should talk to on startup.
 *
 *  1. An explicit `VITE_CONCORS_DAEMON_URL` always wins (developer override / remote daemon).
 *  2. Inside Tauri, ask the native shell to start the bundled daemon and use its port.
 *  3. Otherwise assume a developer is running `pnpm daemon:dev` on the default port.
 *
 * Later, this is where saved remote daemons (the user's VPS) will be selectable.
 */
export async function resolveStartupEndpoint(): Promise<DaemonEndpoint> {
  if (env.daemonUrl !== undefined) {
    return describeDaemonEndpoint(env.daemonUrl, "Configured daemon");
  }

  if (isTauri()) {
    try {
      const status = await localDaemon.start();
      if (status.state === "running") {
        return localDaemonEndpoint(status.port);
      }
    } catch (error) {
      console.warn("Could not start bundled daemon; falling back to default local port", error);
    }
  }

  return localDaemonEndpoint();
}

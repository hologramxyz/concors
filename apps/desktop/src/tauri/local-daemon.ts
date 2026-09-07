import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/*
 * Thin wrappers around the Rust commands in `src-tauri/src/daemon.rs`. The native side only knows
 * how to start/stop a process; it does not speak the Concors protocol. Once the daemon is running,
 * the UI talks to it over WebSocket like it would to any other daemon.
 */

const LocalDaemonStatusSchema = z.discriminatedUnion("state", [
  /** This build has no bundled daemon (development). Run `pnpm daemon:dev` instead. */
  z.object({ state: z.literal("notBundled") }),
  z.object({ state: z.literal("stopped") }),
  z.object({ state: z.literal("running"), pid: z.number().int(), port: z.number().int() }),
]);
export type LocalDaemonStatus = z.infer<typeof LocalDaemonStatusSchema>;

async function call(command: string): Promise<LocalDaemonStatus> {
  return LocalDaemonStatusSchema.parse(await invoke(command));
}

export const localDaemon = {
  status: () => call("local_daemon_status"),
  start: () => call("start_local_daemon"),
  stop: () => call("stop_local_daemon"),
} as const;

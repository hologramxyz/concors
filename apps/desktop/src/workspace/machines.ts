import { describeDaemonEndpoint } from "@concors/daemon-client";
import { z } from "zod";

export const MachineConnectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  url: z.string().url(),
});
export type MachineConnection = z.infer<typeof MachineConnectionSchema>;
export const MACHINES_STORAGE_KEY = "concors.machine-connections.v1";

/** Connection bookmarks are device-local; workspace data always comes from the machine. */
export function parseMachineConnections(raw: string | null): MachineConnection[] {
  try {
    return z
      .array(MachineConnectionSchema)
      .max(32)
      .parse(JSON.parse(raw ?? "[]"))
      .filter((machine) => {
        try {
          describeDaemonEndpoint(machine.url);
          return true;
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}

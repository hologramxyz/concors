import { invoke } from "@tauri-apps/api/core";
import { z } from "zod";

/*
 * Wrapper around `src-tauri/src/ssh_key.rs`: this computer's key for connecting to Concors
 * machines over SSH. The private key stays on disk; only the public key crosses into the webview.
 */

const DeviceSshKeySchema = z.object({
  publicKey: z.string().min(1),
  path: z.string().min(1),
  deviceName: z.string().min(1),
});

export type DeviceSshKey = z.infer<typeof DeviceSshKeySchema>;

export const deviceSshKey = {
  /** This computer's key, or `null` when none was created yet. Never writes to `~/.ssh`. */
  find: async (): Promise<DeviceSshKey | null> =>
    DeviceSshKeySchema.nullable().parse(await invoke("device_ssh_key", { create: false })),
  /** This computer's key, created with `ssh-keygen` if it does not exist yet. Never replaces one. */
  create: async (): Promise<DeviceSshKey> =>
    DeviceSshKeySchema.parse(await invoke("device_ssh_key", { create: true })),
} as const;

import { z } from "zod";

/** Proposed control-plane contract. Absent capabilities fail closed on older servers. */
export const MobileCapabilitiesSchema = z.object({
  version: z.literal(1),
  remoteAccess: z.boolean(),
  pushNotifications: z.boolean(),
  accountDeletion: z.boolean(),
});
export type MobileCapabilities = z.infer<typeof MobileCapabilitiesSchema>;
export const NO_MOBILE_CAPABILITIES: MobileCapabilities = {
  version: 1,
  remoteAccess: false,
  pushNotifications: false,
  accountDeletion: false,
};
/** One-use gateway ticket, never a control-plane token. URLs contain no credentials. */
export const MachineConnectionTicketSchema = z.object({
  machineId: z.string().min(1).max(128),
  url: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return url.protocol === "wss:" && !url.username && !url.password && !url.search && !url.hash;
    }, "A connection requires a secure WebSocket URL without credentials or query parameters"),
  ticket: z
    .string()
    .min(16)
    .max(2048)
    .regex(/^[A-Za-z0-9_-]+$/),
  expiresAt: z.string().datetime(),
});
export type MachineConnectionTicket = z.infer<typeof MachineConnectionTicketSchema>;
/** Actual upstream /machines/:id/token contract; not the proposed one-use gateway ticket. */
export const MachineAccessTokenSchema = z.object({
  machineId: z.string().min(1).max(128),
  token: z
    .string()
    .min(16)
    .max(8192)
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  expiresAt: z.string().datetime(),
});
export type MachineAccessToken = z.infer<typeof MachineAccessTokenSchema>;
export const PushDeviceSchema = z.object({
  installationId: z.string().uuid(),
  token: z.string().min(1).max(512),
  platform: z.enum(["ios", "android"]),
});
export type PushDevice = z.infer<typeof PushDeviceSchema>;
export const AccountDeletionSchema = z.object({ status: z.enum(["deleted", "scheduled"]) });

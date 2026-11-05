import { z } from "zod";

/** Proposed control-plane contract. Absent capabilities fail closed on older servers. */
export const MobileCapabilitiesSchema = z.object({
  version: z.literal(1),
  remoteAccess: z.boolean(),
  pushNotifications: z.boolean(),
  accountDeletion: z.boolean(),
  accountDeletionFlow: z.literal("reauth-plan-v1").optional(),
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
export const AccountDeletionPlanSchema = z.object({
  planToken: z.string().regex(/^[a-f0-9]{64}$/),
  organizations: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      action: z.enum(["delete", "leave"]),
      transferTo: z.object({ userId: z.string(), name: z.string() }).nullable(),
      machines: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          provider: z.enum(["ovh", "external"]),
          alreadyEnded: z.boolean().default(false),
        }),
      ),
    }),
  ),
});
export type AccountDeletionPlan = z.infer<typeof AccountDeletionPlanSchema>;
export const AccountDeletionReceiptSchema = z.object({
  id: z.string(),
  receipt: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("scheduled"),
});
export const AccountDeletionStatusSchema = z.object({
  status: z.enum(["processing", "completed"]),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  delayed: z.boolean(),
});
export const SupportReportReceiptSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("received"),
});

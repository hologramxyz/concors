import { z } from "zod";

// Account exchanges are transient request/reply data, never conversation items or receipts.
export const AgentAccountActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("read") }),
  z.object({ type: z.literal("start"), methodId: z.string().min(1).max(250) }),
  z.object({
    type: z.literal("complete"),
    flowId: z.string().uuid(),
    value: z.string().min(1).max(8192),
  }),
  z.object({ type: z.literal("cancel"), flowId: z.string().uuid() }),
]);
export type AgentAccountAction = z.infer<typeof AgentAccountActionSchema>;
export const AgentAccountMethodSchema = z.object({
  id: z.string().max(250),
  label: z.string().max(250),
  kind: z.enum(["browser", "api-key"]),
});
export type AgentAccountMethod = z.infer<typeof AgentAccountMethodSchema>;
export const AgentAccountSchema = z.object({
  status: z.enum(["connected", "disconnected", "pending", "unknown"]),
  label: z.string().max(250).optional(),
  message: z.string().max(1000).optional(),
  methods: z.array(AgentAccountMethodSchema).max(1000),
  challenge: z
    .object({
      flowId: z.string().uuid(),
      url: z
        .url({ protocol: /^https$/ })
        .max(8192)
        .refine((value) => /^https:\/\/[^/?#@]+(?:[/?#]|$)/.test(value))
        .optional(),
      code: z.string().max(100).optional(),
      instructions: z.string().max(1000).optional(),
      input: z.enum(["code", "api-key"]).optional(),
      expiresAt: z.string().datetime(),
    })
    .optional(),
});
export type AgentAccount = z.infer<typeof AgentAccountSchema>;

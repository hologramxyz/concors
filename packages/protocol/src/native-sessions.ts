import { z } from "zod";

export const NATIVE_SESSIONS_CAPABILITY = "agent-resume-sessions";
export const NativeSessionSchema = z.object({
  id: z.string().min(1).max(4096),
  title: z.string().max(4000),
  directory: z.string(),
  updatedAt: z.string().datetime(),
  busy: z.boolean().optional(),
});
export type NativeSession = z.infer<typeof NativeSessionSchema>;
export const NativeSessionPageSchema = z.object({
  sessions: z.array(NativeSessionSchema).max(100),
  nextCursor: z.string().min(1).max(4096).nullable().default(null),
});
export type NativeSessionPage = z.infer<typeof NativeSessionPageSchema>;

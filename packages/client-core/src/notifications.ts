import { z } from "zod";
export const NotificationTargetSchema = z.object({
  version: z.literal(1),
  eventId: z.string().uuid(),
  userId: z.string().min(1).max(128),
  machineId: z.string().min(1).max(128),
  projectId: z.string().uuid(),
  sessionId: z.string().uuid(),
});
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;
/** Accept structured IDs only: push payloads cannot supply URLs or credentials. */
export function notificationTarget(data: unknown, userId: string): NotificationTarget | null {
  const parsed = NotificationTargetSchema.safeParse(data);
  return parsed.success && parsed.data.userId === userId ? parsed.data : null;
}
export function sessionHref(
  target: Pick<NotificationTarget, "machineId" | "projectId" | "sessionId">,
): string {
  return `/session?${new URLSearchParams({ machineId: target.machineId, projectId: target.projectId, sessionId: target.sessionId })}`;
}
export class NotificationDeduplicator {
  private readonly ids = new Set<string>();
  accept(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    const first = this.ids.values().next().value;
    if (this.ids.size > 128 && first) this.ids.delete(first);
    return true;
  }
}

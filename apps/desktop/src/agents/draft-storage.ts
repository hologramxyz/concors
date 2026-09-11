import { z } from "zod";
import { AgentAttachmentSchema, AgentOperationSchema } from "@concors/protocol";
const input = z.object({
  message: z.string().max(16000),
  attachments: z.array(AgentAttachmentSchema).max(3),
});
const saved = z.object({
  version: z.literal(1),
  updatedAt: z.number(),
  draft: input.extend({ queue: z.array(input).max(20) }),
  attempt: z
    .object({ id: z.string().uuid(), draft: input, operation: AgentOperationSchema })
    .nullable(),
});
export type SavedDraft = z.infer<typeof saved>;
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const draftStorageKey = (machineId: string, sessionId: string) =>
  `concors:agent-draft:${machineId}:${sessionId}`;
export function readDraft(storage: DraftStorage, key: string): SavedDraft | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = saved.parse(JSON.parse(raw));
    if (Date.now() - parsed.updatedAt > 7 * 24 * 60 * 60 * 1000) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
export function writeDraft(storage: DraftStorage, key: string, value: SavedDraft): boolean {
  try {
    if (
      !value.draft.message &&
      !value.draft.attachments.length &&
      !value.draft.queue.length &&
      !value.attempt
    )
      storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

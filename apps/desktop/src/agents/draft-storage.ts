import { z } from "zod";
import {
  AgentAttachmentSchema,
  AgentOperationSchema,
  AgentUploadSchema,
  MAX_MESSAGE_ATTACHMENTS,
} from "@concors/protocol";
import type { DraftAttachment } from "./attachment-uploads";
/**
 * Files inline (older machines) or uploaded ones. An upload is saved only once finished: what is
 * saved is its reference, never its bytes, which a reload loses anyway.
 */
const attachment = z.union([
  AgentAttachmentSchema,
  z.object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(200),
    mime: z.string().max(100),
    size: z.number().int().nonnegative(),
    upload: AgentUploadSchema,
  }),
]);
type SavedAttachment = z.infer<typeof attachment>;
const input = z.object({
  message: z.string().max(16000),
  attachments: z.array(attachment).max(MAX_MESSAGE_ATTACHMENTS),
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
/** The attachments a saved draft can keep: everything but uploads still under way or failed. */
export function savedAttachments(attachments: readonly DraftAttachment[]): SavedAttachment[] {
  return attachments.flatMap<SavedAttachment>((value) => {
    if (!("upload" in value)) return [value];
    const { id, name, mime, size, upload } = value;
    return upload ? [{ id, name, mime, size, upload }] : [];
  });
}
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

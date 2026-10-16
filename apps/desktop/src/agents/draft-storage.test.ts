import { expect, it } from "vitest";
import {
  draftStorageKey,
  readDraft,
  savedAttachments,
  writeDraft,
  type DraftStorage,
} from "./draft-storage";
import type { DraftAttachment } from "./attachment-uploads";

it("saves uploaded attachments as references, any number of them, and never unfinished ones", () => {
  const values = new Map<string, string>();
  const storage: DraftStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const uploaded = (n: number): DraftAttachment => {
    const upload = { uploadId: crypto.randomUUID(), name: `f${n}.zip`, mime: "", size: 9e6 };
    return { id: `local-${n}`, name: upload.name, mime: "", size: upload.size, upload };
  };
  const attachments: DraftAttachment[] = [
    { name: "a.txt", mime: "text/plain", data: btoa("a") },
    ...Array.from({ length: 10 }, (_, n) => uploaded(n)),
    { id: "uploading", name: "big.mov", mime: "video/quicktime", size: 4e7, upload: null },
    { id: "failed", name: "x.bin", mime: "", size: 1, upload: null, error: "Disk full" },
  ];
  const saved = savedAttachments(attachments);
  expect(saved).toHaveLength(11);
  expect(JSON.stringify(saved)).not.toContain("big.mov");
  const key = draftStorageKey("one", crypto.randomUUID());
  writeDraft(storage, key, {
    version: 1,
    updatedAt: Date.now(),
    draft: { message: "", attachments: saved, queue: [] },
    attempt: null,
  });
  expect(readDraft(storage, key)?.draft.attachments).toEqual(saved);
});
it("restores an uncertain request identity within its machine and expires old drafts", () => {
  const values = new Map<string, string>();
  const storage: DraftStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const sessionId = crypto.randomUUID(),
    requestId = crypto.randomUUID(),
    key = draftStorageKey("one", sessionId),
    draft = { message: "keep this", attachments: [] };
  expect(
    writeDraft(storage, key, {
      version: 1,
      updatedAt: Date.now(),
      draft: { ...draft, queue: [] },
      attempt: {
        id: requestId,
        draft,
        operation: { kind: "send", sessionId, text: draft.message },
      },
    }),
  ).toBe(true);
  expect(readDraft(storage, key)?.attempt?.id).toBe(requestId);
  expect(readDraft(storage, draftStorageKey("two", sessionId))).toBeNull();
  writeDraft(storage, key, {
    version: 1,
    updatedAt: 0,
    draft: { ...draft, queue: [] },
    attempt: null,
  });
  expect(readDraft(storage, key)).toBeNull();
  expect(values.size).toBe(0);
});

import { expect, it } from "vitest";
import { draftStorageKey, readDraft, writeDraft, type DraftStorage } from "./draft-storage";
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

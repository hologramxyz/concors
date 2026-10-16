import { expect, it } from "vitest";
import { messageFiles, unsent, type DraftAttachment } from "./attachment-uploads";

const upload = { uploadId: crypto.randomUUID(), name: "big.zip", mime: "", size: 9e6 };
const inline = { name: "a.txt", mime: "text/plain", data: btoa("a") };
const uploaded: DraftAttachment = { id: "1", name: "big.zip", mime: "", size: 9e6, upload };

it("sends inline files and upload references in their own fields, leaving out empty ones", () => {
  expect(messageFiles([uploaded, inline])).toEqual({ attachments: [inline], uploads: [upload] });
  expect(messageFiles([uploaded])).toEqual({ uploads: [upload] });
  expect(messageFiles([])).toEqual({});
});

it("holds a message back while any upload is under way or has failed", () => {
  expect(unsent([inline, uploaded])).toBe(false);
  expect(unsent([uploaded, { id: "2", name: "b", mime: "", size: 1, upload: null }])).toBe(true);
  expect(unsent([{ id: "3", name: "c", mime: "", size: 1, upload: null, error: "No" }])).toBe(true);
});

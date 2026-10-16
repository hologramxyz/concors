import { describe, expect, it } from "vitest";
import {
  AgentInfoSchema,
  AgentItemSchema,
  AgentOperationSchema,
  MAX_MESSAGE_ATTACHMENTS,
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  parseClientMessage,
  parseDaemonMessage,
} from "./index.ts";

// This package compiles against plain ES only, so IDs and base64 are spelled out.
let ids = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const base64 = (bytes: number) => "A".repeat(Math.ceil(bytes / 3) * 4);
const sessionId = uuid();
const upload = (index = 0) => ({
  uploadId: uuid(),
  name: `file-${index}.bin`,
  mime: "application/octet-stream",
  size: 2 * 1024 * 1024,
});
const inline = { name: "a.txt", mime: "text/plain", data: "YQ==" };

describe("upload messages", () => {
  it("accepts a begin up to the per-file limit and refuses one past it", () => {
    const begin = (size: number) =>
      parseClientMessage({
        type: "upload.request",
        requestId: uuid(),
        operation: { kind: "begin", uploadId: uuid(), name: "a.zip", mime: "", size },
      }).success;
    expect(begin(MAX_UPLOAD_BYTES)).toBe(true);
    expect(begin(MAX_UPLOAD_BYTES + 1)).toBe(false);
  });

  it("bounds a chunk to its size as base64 and requires valid base64", () => {
    const chunk = (data: string) =>
      parseClientMessage({ type: "upload.chunk", uploadId: uuid(), seq: 0, data }).success;
    expect(chunk(base64(UPLOAD_CHUNK_BYTES))).toBe(true);
    expect(chunk(base64(UPLOAD_CHUNK_BYTES + 3))).toBe(false);
    expect(chunk("not base64!")).toBe(false);
    expect(chunk("")).toBe(false);
  });

  it("parses the daemon's answers and progress", () => {
    const uploadId = uuid();
    expect(
      parseDaemonMessage({
        type: "upload.result",
        requestId: uuid(),
        outcome: { status: "ok", upload: { ...upload(), uploadId } },
      }).success,
    ).toBe(true);
    expect(parseDaemonMessage({ type: "upload.progress", uploadId, received: 10 }).success).toBe(
      true,
    );
    expect(
      parseDaemonMessage({ type: "upload.error", uploadId, message: "Disk full" }).success,
    ).toBe(true);
  });
});

describe("messages with uploaded files", () => {
  it("carries any number of uploads up to the sanity bound, with or without text", () => {
    const send = (uploads: unknown[], text = "") =>
      AgentOperationSchema.safeParse({ kind: "send", sessionId, text, uploads }).success;
    expect(send(Array.from({ length: 12 }, (_, i) => upload(i)))).toBe(true);
    expect(send(Array.from({ length: MAX_MESSAGE_ATTACHMENTS }, (_, i) => upload(i)))).toBe(true);
    expect(send(Array.from({ length: MAX_MESSAGE_ATTACHMENTS + 1 }, (_, i) => upload(i)))).toBe(
      false,
    );
    expect(send([])).toBe(false);
  });

  it("still takes the inline form older clients send, three files at most", () => {
    const parse = (attachments: unknown[], uploads?: unknown[]) =>
      AgentOperationSchema.safeParse({
        kind: "queue-add",
        sessionId,
        text: "",
        attachments,
        ...(uploads ? { uploads } : {}),
      }).success;
    expect(parse([inline, inline, inline])).toBe(true);
    expect(parse([inline, inline, inline, inline])).toBe(false);
    // Together they still respect the bound.
    expect(
      parse(
        [inline],
        Array.from({ length: MAX_MESSAGE_ATTACHMENTS }, (_, i) => upload(i)),
      ),
    ).toBe(false);
  });

  it("refuses an upload reference that is not an ID", () => {
    expect(
      AgentOperationSchema.safeParse({
        kind: "steer",
        sessionId,
        turnId: "turn",
        text: "",
        uploads: [{ ...upload(), uploadId: "../../etc/passwd" }],
      }).success,
    ).toBe(false);
  });

  it("lists every file of a sent or queued message, past the old three", () => {
    const files = Array.from({ length: 20 }, (_, i) => ({ name: `f${i}`, mime: "text/plain" }));
    expect(
      AgentItemSchema.safeParse({
        id: "prompt:1",
        sessionId,
        turnId: "turn",
        position: 0,
        kind: "user",
        title: "You",
        text: "",
        detail: "",
        attachments: files,
        status: "completed",
        createdAt: "2026-10-15T00:00:00.000Z",
      }).success,
    ).toBe(true);
    const now = "2026-10-15T00:00:00.000Z";
    expect(
      AgentInfoSchema.shape.queue.safeParse([
        { id: uuid(), text: "", attachments: files, queuedAt: now },
      ]).success,
    ).toBe(true);
  });
});

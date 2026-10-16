import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_AGENT_IMAGE_BYTES,
  UPLOAD_CHUNK_BYTES,
  type UploadEvent,
  type UploadOperation,
} from "@concors/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Uploads } from "./uploads.ts";
import { claimUploads, messageInputs, readUpload } from "./attachments.ts";

let root = "";
let uploads: Uploads;
let events: UploadEvent[] = [];
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "concors-uploads-"));
  uploads = new Uploads(root, 60_000);
  events = [];
});
afterEach(async () => {
  await uploads.close();
  await rm(root, { recursive: true, force: true });
});
const request = (operation: UploadOperation, owner = "viewer") =>
  uploads.request(owner, { type: "upload.request", requestId: randomUUID(), operation }, (event) =>
    events.push(event),
  );
const begin = (uploadId: string, size: number, name = "report.pdf", owner = "viewer") =>
  request({ kind: "begin", uploadId, name, mime: "application/pdf", size }, owner);
const chunk = (uploadId: string, seq: number, bytes: Buffer, owner = "viewer") =>
  uploads.chunk(owner, {
    type: "upload.chunk",
    uploadId,
    seq,
    data: bytes.toString("base64"),
  });
const staged = (uploadId: string) => join(root, "uploads", uploadId);
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

it("writes chunks in order to a private file named after the upload, and confirms each", async () => {
  const id = randomUUID();
  const bytes = Buffer.alloc(UPLOAD_CHUNK_BYTES * 2 + 5, 7);
  expect((await begin(id, bytes.length, "../../My Report.pdf")).outcome.status).toBe("ok");
  chunk(id, 0, bytes.subarray(0, UPLOAD_CHUNK_BYTES));
  chunk(id, 1, bytes.subarray(UPLOAD_CHUNK_BYTES, UPLOAD_CHUNK_BYTES * 2));
  chunk(id, 2, bytes.subarray(UPLOAD_CHUNK_BYTES * 2));
  const finished = await request({ kind: "finish", uploadId: id });
  expect(finished.outcome).toEqual({
    status: "ok",
    upload: { uploadId: id, name: "../../My Report.pdf", mime: "application/pdf", size: 262149 },
  });
  expect(events).toEqual([
    { type: "upload.progress", uploadId: id, received: UPLOAD_CHUNK_BYTES },
    { type: "upload.progress", uploadId: id, received: UPLOAD_CHUNK_BYTES * 2 },
    { type: "upload.progress", uploadId: id, received: bytes.length },
  ]);
  // The name stays inside its directory, and only its owner can read it.
  expect(await readdir(staged(id))).toEqual([".._.._My_Report.pdf"]);
  const file = join(staged(id), ".._.._My_Report.pdf");
  expect(await readFile(file)).toEqual(bytes);
  if (process.platform !== "win32") {
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(staged(id))).mode & 0o777).toBe(0o700);
  }
});

it("ends an upload whose chunks skip, overflow or fall short, and removes what it wrote", async () => {
  const skipped = randomUUID();
  await begin(skipped, 10);
  chunk(skipped, 1, Buffer.alloc(5));
  expect(events).toEqual([
    {
      type: "upload.error",
      uploadId: skipped,
      message: "Part of the file went missing. Attach it again.",
    },
  ]);
  await expect.poll(() => exists(staged(skipped))).toBe(false);

  const larger = randomUUID();
  await begin(larger, 4);
  chunk(larger, 0, Buffer.alloc(5));
  expect(events.at(-1)).toMatchObject({ type: "upload.error", uploadId: larger });
  await expect.poll(() => exists(staged(larger))).toBe(false);

  // A client that sends without waiting for confirmations cannot pile chunks up in memory.
  const flood = randomUUID();
  await begin(flood, UPLOAD_CHUNK_BYTES * 20);
  for (let seq = 0; seq < 20; seq++) chunk(flood, seq, Buffer.alloc(UPLOAD_CHUNK_BYTES));
  expect(events.at(-1)).toEqual({
    type: "upload.error",
    uploadId: flood,
    message: "The file arrived faster than it could be saved.",
  });
  await expect.poll(() => exists(staged(flood))).toBe(false);

  const short = randomUUID();
  await begin(short, 10);
  chunk(short, 0, Buffer.alloc(5));
  expect(await request({ kind: "finish", uploadId: short })).toMatchObject({
    outcome: { status: "error", message: "Part of the file did not arrive. Attach it again." },
  });
  expect(await exists(staged(short))).toBe(false);
});

it("discards an upload its client cancels or disconnects from, and ignores other clients", async () => {
  const cancelled = randomUUID();
  await begin(cancelled, 10);
  chunk(cancelled, 0, Buffer.alloc(5));
  expect((await request({ kind: "cancel", uploadId: cancelled }, "someone else")).outcome).toEqual({
    status: "error",
    message: "That upload is not yours.",
  });
  expect((await request({ kind: "cancel", uploadId: cancelled })).outcome.status).toBe("ok");
  expect(await exists(staged(cancelled))).toBe(false);
  // Chunks still on their way after a cancel are dropped quietly.
  const before = events.length;
  chunk(cancelled, 1, Buffer.alloc(5));
  expect(events).toHaveLength(before);

  const dropped = randomUUID();
  await begin(dropped, 10);
  chunk(dropped, 0, Buffer.alloc(5));
  uploads.detach("viewer");
  await expect.poll(() => exists(staged(dropped))).toBe(false);

  // A finished upload nobody sent can be discarded too.
  const finished = randomUUID();
  await begin(finished, 3);
  chunk(finished, 0, Buffer.from("abc"));
  await request({ kind: "finish", uploadId: finished });
  await request({ kind: "cancel", uploadId: finished }, "a reconnected client");
  expect(await exists(staged(finished))).toBe(false);
});

it("sweeps away unfinished uploads left behind and finished ones never sent", async () => {
  const leftover = randomUUID(),
    old = randomUUID(),
    recent = randomUUID(),
    running = randomUUID();
  await mkdir(staged(leftover), { recursive: true });
  await writeFile(join(staged(leftover), "~incoming"), "partial");
  await mkdir(staged(old));
  await writeFile(join(staged(old), "old.txt"), "old");
  await utimes(staged(old), new Date(0), new Date(0));
  await mkdir(staged(recent));
  await writeFile(join(staged(recent), "recent.txt"), "recent");
  await begin(running, 10);
  await uploads.sweep();
  expect((await readdir(join(root, "uploads"))).sort()).toEqual([recent, running].sort());
});

it("moves uploads into the chat when a message claims them, and gives them to the agent", async () => {
  const session = randomUUID();
  const image = randomUUID(),
    photo = randomUUID(),
    notes = randomUUID();
  const upload = async (uploadId: string, name: string, bytes: Buffer) => {
    await begin(uploadId, bytes.length, name);
    // As a client does: one chunk at a time once the one before is confirmed.
    for (let offset = 0, seq = 0; offset < bytes.length; offset += UPLOAD_CHUNK_BYTES) {
      chunk(uploadId, seq++, bytes.subarray(offset, offset + UPLOAD_CHUNK_BYTES));
      const end = Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.length);
      await expect
        .poll(() =>
          events.some(
            (e) => e.type === "upload.progress" && e.uploadId === uploadId && e.received === end,
          ),
        )
        .toBe(true);
    }
    const result = await request({ kind: "finish", uploadId });
    if (result.outcome.status !== "ok" || !result.outcome.upload) throw new Error("No upload");
    return result.outcome.upload;
  };
  const refs = [
    { ...(await upload(image, "shot.png", Buffer.from("png"))), mime: "image/png" },
    // Too large for an agent to take as an image: it gets the path instead.
    {
      ...(await upload(photo, "photo.png", Buffer.alloc(MAX_AGENT_IMAGE_BYTES + 1))),
      mime: "image/png",
    },
    await upload(notes, "notes.pdf", Buffer.from("%PDF")),
  ];
  await claimUploads(root, session, refs);
  // Claiming again, as a retried or queued message does, is harmless.
  await claimUploads(root, session, refs);
  expect(await exists(staged(image))).toBe(false);
  const inputs = await messageInputs(root, session, { uploads: refs });
  expect(inputs).toEqual([
    { type: "localImage", path: join(root, session, image, "shot.png") },
    {
      type: "text",
      text: `The user attached "photo.png". Its file on this machine is: ${join(root, session, photo, "photo.png")}`,
    },
    {
      type: "text",
      text: `The user attached "notes.pdf". Its file on this machine is: ${join(root, session, notes, "notes.pdf")}`,
    },
  ]);
  expect(await readUpload(root, session, refs[2]!)).toEqual({
    name: "notes.pdf",
    mime: "application/pdf",
    data: Buffer.from("%PDF").toString("base64"),
  });
  // An upload that never finished, or was swept, cannot be claimed.
  const missing = { uploadId: randomUUID(), name: "gone.txt", mime: "text/plain", size: 1 };
  await expect(claimUploads(root, session, [missing])).rejects.toThrow(
    "gone.txt is no longer on this machine. Attach it again.",
  );
  const unfinished = randomUUID();
  await begin(unfinished, 10, "half.txt");
  await expect(
    claimUploads(root, session, [{ ...missing, uploadId: unfinished, name: "half.txt" }]),
  ).rejects.toThrow("half.txt is no longer on this machine");
});

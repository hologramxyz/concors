import { z } from "zod";

/**
 * Attachment uploads: a client streams a file to the machine before sending the message that
 * uses it, and the message then carries only a reference. Files no longer ride inside the agent
 * request itself, so neither their size nor their number is bound by one WebSocket frame.
 *
 *   client                                            daemon
 *     │ ── upload.request begin {uploadId, size} ──▶ │  creates the file
 *     │ ── upload.chunk seq 0, 1, 2 … ─────────────▶ │  appends each in order
 *     │ ◀──────────────── upload.progress {received} │  after each chunk is on disk
 *     │ ── upload.request finish ─────────────────▶ │  checks the size, keeps the file
 *     │ ◀──────────────── upload.result {upload} ─── │
 *
 * Chunks are JSON with base64 data, like dictation audio, because the clients' socket interface
 * and the mobile app's bridge between its web UI and native host carry only text. A client keeps
 * only a few chunks unacknowledged, so an upload never queues more than that ahead of other traffic.
 *
 * The daemon advertises `ATTACHMENT_UPLOADS_CAPABILITY`; clients declare the same string in
 * `client.hello` to say they read attachment lists longer than older clients could.
 */
export const ATTACHMENT_UPLOADS_CAPABILITY = "attachment-uploads";

/** Each attached file may be this large; there is no limit on how many a message carries. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Far below the daemon's frame limit, and small enough not to hold up other messages. */
export const UPLOAD_CHUNK_BYTES = 128 * 1024;

/** How many chunks a client sends before waiting for the daemon to confirm the first of them. */
export const UPLOAD_WINDOW_CHUNKS = 4;

/** A sanity bound on one message's attachments, so a single frame cannot be made enormous. */
export const MAX_MESSAGE_ATTACHMENTS = 100;

/** What older clients accept: three files sent inline per message, eight on a chat item. */
export const LEGACY_MESSAGE_ATTACHMENTS = 3;

/**
 * Images larger than this go to an agent as a file path instead of an image: Anthropic's API
 * refuses images over 5 MB of base64, the strictest of the providers'. Clients shrink still images
 * to fit before uploading them.
 */
export const MAX_AGENT_IMAGE_BYTES = (5 * 1024 * 1024 * 3) / 4;

/** An uploaded file a message refers to. The daemon finds the file by its ID, never by a path. */
export const AgentUploadSchema = z.object({
  uploadId: z.string().uuid(),
  name: z.string().min(1).max(200),
  mime: z.string().max(100),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
});
export type AgentUpload = z.infer<typeof AgentUploadSchema>;

const UploadId = z.string().uuid();

export const UploadOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("begin"),
    uploadId: UploadId,
    name: z.string().min(1).max(200),
    mime: z.string().max(100),
    size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  }),
  /** Answers once every chunk is on disk and the file has the size `begin` announced. */
  z.object({ kind: z.literal("finish"), uploadId: UploadId }),
  /** Stops an upload, or discards a finished one no message has used yet. */
  z.object({ kind: z.literal("cancel"), uploadId: UploadId }),
]);
export type UploadOperation = z.infer<typeof UploadOperationSchema>;

export const UploadRequestSchema = z.object({
  type: z.literal("upload.request"),
  requestId: z.string().uuid(),
  operation: UploadOperationSchema,
});
export type UploadRequest = z.infer<typeof UploadRequestSchema>;

/** Fire-and-forget like dictation audio. `seq` starts at 0 so a gap fails instead of corrupting. */
export const UploadChunkSchema = z.object({
  type: z.literal("upload.chunk"),
  uploadId: UploadId,
  seq: z.number().int().nonnegative(),
  data: z
    .string()
    .min(1)
    .max(Math.ceil(UPLOAD_CHUNK_BYTES / 3) * 4)
    .base64(),
});
export type UploadChunk = z.infer<typeof UploadChunkSchema>;

export const UploadResultSchema = z.object({
  type: z.literal("upload.result"),
  requestId: z.string().uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), upload: AgentUploadSchema.optional() }),
    z.object({ status: z.literal("error"), message: z.string().max(1000) }),
  ]),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

export const UploadEventSchema = z.discriminatedUnion("type", [
  /** How many bytes of the upload are on disk; sent after each chunk. */
  z.object({
    type: z.literal("upload.progress"),
    uploadId: UploadId,
    received: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  }),
  /** The upload stopped and its partial file is gone; nothing more is sent for it. */
  z.object({
    type: z.literal("upload.error"),
    uploadId: UploadId,
    message: z.string().max(1000),
  }),
]);
export type UploadEvent = z.infer<typeof UploadEventSchema>;

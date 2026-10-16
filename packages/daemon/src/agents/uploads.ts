import { mkdir, open, readdir, rename, rm, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  UPLOAD_WINDOW_CHUNKS,
  type UploadChunk,
  type UploadEvent,
  type UploadRequest,
  type UploadResult,
} from "@concors/protocol";
import { PARTIAL_UPLOAD, UPLOADS_DIRECTORY, safeFileName } from "./attachments.ts";

/** As long as a saved draft is kept, so a draft reopened within it can still be sent. */
export const KEEP_UNSENT_UPLOADS_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
/** A client that waits for acknowledgements never has more than its window waiting here. */
const MAX_WAITING_CHUNKS = UPLOAD_WINDOW_CHUNKS * 2;

interface Upload {
  readonly owner: string;
  readonly name: string;
  readonly mime: string;
  readonly size: number;
  readonly directory: string;
  readonly handle: FileHandle;
  /** Chunk writes, one after another, in the order they arrived. */
  work: Promise<void>;
  next: number;
  accepted: number;
  received: number;
  waiting: number;
  notify: (event: UploadEvent) => void;
}

/**
 * Receives the files clients upload ahead of a message, one at a time per upload, straight to
 * disk under `<attachments>/uploads/<uploadId>/`. A message then claims its files into the chat's
 * directory (see `claimUploads`). What is never claimed is removed: an unfinished upload as soon
 * as its client cancels or disconnects, and on the next start after a crash; a finished one after
 * `KEEP_UNSENT_UPLOADS_MS`.
 *
 * It holds no bytes beyond the few chunks waiting for the disk, and knows nothing of chats.
 */
export class Uploads {
  readonly #root: string;
  readonly #keepMs: number;
  readonly #active = new Map<string, Upload>();
  #sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(attachmentsDirectory: string, keepMs = KEEP_UNSENT_UPLOADS_MS) {
    this.#root = join(attachmentsDirectory, UPLOADS_DIRECTORY);
    this.#keepMs = keepMs;
  }

  start(): void {
    void this.sweep();
    this.#sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.#sweeper.unref?.();
  }

  close(): void {
    clearInterval(this.#sweeper);
    for (const id of [...this.#active.keys()]) void this.#discard(id);
  }

  async request(
    owner: string,
    request: UploadRequest,
    notify: (event: UploadEvent) => void,
  ): Promise<UploadResult> {
    const result = (outcome: UploadResult["outcome"]): UploadResult => ({
      type: "upload.result",
      requestId: request.requestId,
      outcome,
    });
    const op = request.operation;
    try {
      if (op.kind === "begin") {
        const directory = join(this.#root, op.uploadId);
        if (this.#active.has(op.uploadId)) throw new Error("That upload has already begun.");
        await mkdir(this.#root, { recursive: true, mode: 0o700 });
        // Fails if the directory exists: an upload ID is never reused.
        await mkdir(directory, { mode: 0o700 });
        const handle = await open(join(directory, PARTIAL_UPLOAD), "wx", 0o600);
        this.#active.set(op.uploadId, {
          owner,
          name: op.name,
          mime: op.mime,
          size: op.size,
          directory,
          handle,
          work: Promise.resolve(),
          next: 0,
          accepted: 0,
          received: 0,
          waiting: 0,
          notify,
        });
        return result({ status: "ok" });
      }
      const upload = this.#active.get(op.uploadId);
      if (op.kind === "cancel") {
        if (upload && upload.owner !== owner) throw new Error("That upload is not yours.");
        if (upload) await this.#discard(op.uploadId);
        // A finished upload nobody sent: only its staging directory can be named here.
        else await rm(join(this.#root, op.uploadId), { recursive: true, force: true });
        return result({ status: "ok" });
      }
      if (!upload || upload.owner !== owner)
        throw new Error("The upload stopped. Attach the file again.");
      await upload.work;
      if (this.#active.get(op.uploadId) !== upload)
        throw new Error("The upload stopped. Attach the file again.");
      if (upload.received !== upload.size) {
        await this.#discard(op.uploadId);
        throw new Error("Part of the file did not arrive. Attach it again.");
      }
      this.#active.delete(op.uploadId);
      await upload.handle.close();
      await rename(
        join(upload.directory, PARTIAL_UPLOAD),
        join(upload.directory, safeFileName(upload.name)),
      );
      return result({
        status: "ok",
        upload: { uploadId: op.uploadId, name: upload.name, mime: upload.mime, size: upload.size },
      });
    } catch (error) {
      return result({
        status: "error",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      });
    }
  }

  /** Appends a chunk once those before it are written; anything out of order ends the upload. */
  chunk(owner: string, chunk: UploadChunk): void {
    const upload = this.#active.get(chunk.uploadId);
    // Chunks still in flight after a cancel are expected; there is nothing to tell anyone.
    if (!upload || upload.owner !== owner) return;
    const bytes = Buffer.from(chunk.data, "base64");
    if (chunk.seq !== upload.next)
      return this.#fail(chunk.uploadId, "Part of the file went missing. Attach it again.");
    if (upload.accepted + bytes.length > upload.size)
      return this.#fail(chunk.uploadId, "The file is larger than its upload said.");
    if (++upload.waiting > MAX_WAITING_CHUNKS)
      return this.#fail(chunk.uploadId, "The file arrived faster than it could be saved.");
    upload.next++;
    upload.accepted += bytes.length;
    upload.work = upload.work.then(async () => {
      if (this.#active.get(chunk.uploadId) !== upload) return;
      try {
        await upload.handle.write(bytes);
      } catch (error) {
        this.#fail(
          chunk.uploadId,
          `Could not save the file on this machine: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
      upload.received += bytes.length;
      upload.waiting--;
      upload.notify({
        type: "upload.progress",
        uploadId: chunk.uploadId,
        received: upload.received,
      });
    });
  }

  /** The connection is gone, and with it any chance of finishing what it was sending. */
  detach(owner: string): void {
    for (const [id, upload] of this.#active) if (upload.owner === owner) void this.#discard(id);
  }

  /**
   * Removes what nothing will claim: unfinished uploads not in progress (left by a crash or a
   * restart) and finished ones older than the keep period.
   */
  async sweep(now = Date.now()): Promise<void> {
    const ids = await readdir(this.#root).catch(() => []);
    for (const id of ids) {
      if (this.#active.has(id)) continue;
      const directory = join(this.#root, id);
      try {
        const names = await readdir(directory);
        const old = now - (await stat(directory)).mtimeMs > this.#keepMs;
        if (old || names.length !== 1 || names[0] === PARTIAL_UPLOAD)
          await rm(directory, { recursive: true, force: true });
      } catch {
        // Claimed or removed meanwhile.
      }
    }
  }

  #fail(id: string, message: string): void {
    const upload = this.#active.get(id);
    if (!upload) return;
    void this.#discard(id);
    upload.notify({ type: "upload.error", uploadId: id, message });
  }

  async #discard(id: string): Promise<void> {
    const upload = this.#active.get(id);
    if (!upload) return;
    this.#active.delete(id);
    // Writes already queued see the upload gone and skip; wait so none lands after the removal.
    await upload.work.catch(() => undefined);
    await upload.handle.close().catch(() => undefined);
    await rm(upload.directory, { recursive: true, force: true });
  }
}

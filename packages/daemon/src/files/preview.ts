import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  MAX_DOWNLOAD_BYTES,
  MAX_PREVIEW_BYTES,
  MAX_RANGE_DOWNLOAD_BYTES,
  type FileDownload,
  type FilePreview,
  type FileRange,
} from "@concors/protocol";

/**
 * Reads a PDF or image for a read-only file tab. The type comes from the file's own signature,
 * not its name, so a renamed file can neither slip arbitrary bytes into a viewer nor be refused
 * for a misleading extension. Anything else stays with the text editor's rules.
 */
export async function readProjectPreview(file: string, path: string): Promise<FilePreview> {
  const bytes = await readWholeFile(file, MAX_PREVIEW_BYTES, "preview");
  const mime = previewMime(bytes);
  if (!mime)
    throw new Error(
      "Concors can preview PDF, PNG, JPEG, GIF and WebP files. Open this one in a terminal.",
    );
  return { path, mime, data: bytes.toString("base64"), size: bytes.length };
}

/** Reads any regular file so a link to it can be saved on the person's device. */
export async function readProjectDownload(file: string, path: string): Promise<FileDownload> {
  const bytes = await readWholeFile(file, MAX_DOWNLOAD_BYTES, "download");
  return { path, data: bytes.toString("base64"), size: bytes.length };
}

/**
 * One piece of a regular file, for downloads too large to send whole. `expected` is the file as the
 * first piece found it; a file that changed since is refused, as the whole-file read refuses one
 * that changes while it is read.
 */
export async function readProjectRange(
  file: string,
  path: string,
  offset: number,
  length: number,
  expected?: { size: number; modified: number },
): Promise<FileRange> {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("Only regular files can be downloaded.");
    if (stat.size > MAX_RANGE_DOWNLOAD_BYTES)
      throw new Error(
        `This file exceeds the ${MAX_RANGE_DOWNLOAD_BYTES / 1024 / 1024 / 1024} GB download limit. Copy it from a terminal.`,
      );
    if (expected && (expected.size !== stat.size || expected.modified !== stat.mtimeMs))
      throw new Error("File changed while downloading. Try again.");
    if (offset > stat.size) throw new Error("File changed while downloading. Try again.");
    const buffer = Buffer.alloc(Math.min(length, stat.size - offset));
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, offset + read);
      if (!bytesRead) throw new Error("File changed while downloading. Try again.");
      read += bytesRead;
    }
    return {
      path,
      offset,
      data: buffer.toString("base64"),
      size: stat.size,
      modified: stat.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

/**
 * The whole file, refusing links, anything but a regular file, files over the limit, and files
 * that change while being read, which would otherwise arrive as a mix of two versions.
 */
async function readWholeFile(file: string, limit: number, purpose: "preview" | "download") {
  const tooLarge = `This file exceeds the ${limit / 1024 / 1024} MB ${purpose} limit. Open it in a terminal.`;
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile())
      throw new Error(
        purpose === "preview"
          ? "Only regular files can be previewed."
          : "Only regular files can be downloaded.",
      );
    if (before.size > limit) throw new Error(tooLarge);
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > limit) throw new Error(tooLarge);
    const after = await handle.stat();
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error("File changed while loading. Try again.");
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

const starts = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export function previewMime(bytes: Uint8Array): FilePreview["mime"] | null {
  // PDF readers accept the header anywhere in the first kilobyte, after stray bytes some tools add.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (head.includes("%PDF-")) return "application/pdf";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts(bytes, ascii("GIF87a")) || starts(bytes, ascii("GIF89a"))) return "image/gif";
  if (starts(bytes, ascii("RIFF")) && starts(bytes, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

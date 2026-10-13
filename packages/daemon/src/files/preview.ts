import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { MAX_PREVIEW_BYTES, type FilePreview } from "@concors/protocol";

/**
 * Reads a PDF or image for a read-only file tab. The type comes from the file's own signature,
 * not its name, so a renamed file can neither slip arbitrary bytes into a viewer nor be refused
 * for a misleading extension. Anything else stays with the text editor's rules.
 */
export async function readProjectPreview(file: string, path: string): Promise<FilePreview> {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Only regular files can be previewed.");
    if (before.size > MAX_PREVIEW_BYTES) throw new Error(tooLarge);
    const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_PREVIEW_BYTES) throw new Error(tooLarge);
    const after = await handle.stat();
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error("File changed while loading. Try again.");
    const bytes = buffer.subarray(0, size);
    const mime = previewMime(bytes);
    if (!mime)
      throw new Error(
        "Concors can preview PDF, PNG, JPEG, GIF and WebP files. Open this one in a terminal.",
      );
    return { path, mime, data: bytes.toString("base64"), size };
  } finally {
    await handle.close();
  }
}

const tooLarge = `This file exceeds the ${MAX_PREVIEW_BYTES / 1024 / 1024} MB preview limit. Open it in a terminal.`;

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

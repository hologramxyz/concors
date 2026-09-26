import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_MESSAGE_IMAGES, type AgentAttachment } from "@concors/protocol";

/**
 * Images an agent shows in its reply. The agent writes `![alt](path)` to a file on this machine
 * (typically a screenshot in /tmp); the person reads the chat on another computer, so the daemon
 * keeps a copy of each image when the message completes and serves it like a sent attachment.
 *
 * Only files the agent named in its own message are read, only recognised image formats, and only
 * up to the attachment size limit. Web addresses are never fetched: the chat does not load remote
 * images at all.
 */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** The destinations of Markdown images, in order, skipping code where `![...]` is just text. */
export function imageReferences(markdown: string): string[] {
  const prose = markdown.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm, "");
  const sources: string[] = [];
  const pattern = /(`+)[\s\S]*?\1|!\[(?:\\.|[^\]\\])*\]\(\s*(<[^>\n]*>|(?:\\.|[^\s()\\])+)/g;
  for (const match of prose.matchAll(pattern)) {
    const raw = match[2];
    if (!raw) continue;
    const source = (raw.startsWith("<") ? raw.slice(1, -1) : raw).replace(
      /\\([!-/:-@[-`{-~])/g,
      "$1",
    );
    if (source && !sources.includes(source)) sources.push(source);
  }
  return sources;
}

/** The file an image destination names, or null for web addresses and anything else. */
export function localImagePath(source: string, directory: string): string | null {
  if (/^file:\/\//i.test(source)) {
    try {
      return fileURLToPath(source);
    } catch {
      return null;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source)) return null;
  let path = source;
  try {
    path = decodeURI(source);
  } catch {
    // Not percent-encoded after all; use it as written.
  }
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return isAbsolute(path) ? path : resolve(directory, path);
}

export function imageMime(bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP")
    return "image/webp";
  return null;
}

export interface MessageImage {
  source: string;
  attachment: AgentAttachment;
}

/** Reads the images a message shows. Missing, oversized or non-image files are left out. */
export function readMessageImages(markdown: string, directory: string): MessageImage[] {
  const images: MessageImage[] = [];
  for (const source of imageReferences(markdown)) {
    if (images.length >= MAX_MESSAGE_IMAGES) break;
    const path = localImagePath(source, directory);
    const bytes = path ? readImageFile(path) : null;
    const mime = bytes && imageMime(bytes);
    if (!path || !bytes || !mime) continue;
    images.push({
      source,
      attachment: {
        name: basename(path).slice(0, 200) || "image",
        mime,
        data: Buffer.from(bytes).toString("base64"),
      },
    });
  }
  return images;
}

function readImageFile(path: string): Buffer | null {
  let descriptor: number | undefined;
  try {
    // Checked before opening too: opening a named pipe would wait for a writer.
    if (!statSync(path).isFile()) return null;
    descriptor = openSync(path, "r");
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_IMAGE_BYTES) return null;
    const bytes = Buffer.alloc(stat.size);
    let read = 0;
    while (read < bytes.length) {
      const count = readSync(descriptor, bytes, read, bytes.length - read, read);
      if (!count) break;
      read += count;
    }
    return read === bytes.length ? bytes : null;
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

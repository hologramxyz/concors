import type { DaemonConnection } from "@concors/daemon-client";
import {
  DOWNLOAD_RANGE_BYTES,
  FILE_DOWNLOAD_CAPABILITY,
  FILE_RANGE_DOWNLOAD_CAPABILITY,
  type FileRange,
} from "@concors/protocol";
import type { FileLinkTarget } from "./context";

/** Pieces asked for at once: enough to hide the round trip, few enough not to hold up other traffic. */
const WINDOW = 4;

function decode(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/**
 * Reads a file from the machine for saving on this device. A machine that reads files in pieces
 * sends any size up to its limit, a few pieces at a time, reporting progress as they arrive; an
 * older one sends the file whole, which fits only smaller files.
 */
export async function downloadProjectFile(
  connection: DaemonConnection,
  target: FileLinkTarget,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array> {
  const capabilities =
    connection.state.status === "ready" ? (connection.state.daemon.capabilities ?? []) : null;
  if (!capabilities) throw new Error("Reconnect to this machine to download the file.");
  if (!capabilities.includes(FILE_RANGE_DOWNLOAD_CAPABILITY)) {
    if (!capabilities.includes(FILE_DOWNLOAD_CAPABILITY))
      throw new Error("Update this machine’s Concors service from Machines to download files.");
    const { outcome } = await connection.requestFile(
      { kind: "download", ...target },
      crypto.randomUUID(),
    );
    if (outcome.status !== "downloaded")
      throw new Error("message" in outcome ? outcome.message : "Could not download this file.");
    return decode(outcome.download.data);
  }
  const piece = async (offset: number, expected?: { size: number; modified: number }) => {
    const { outcome } = await connection.requestFile(
      {
        kind: "download-range",
        ...target,
        offset,
        length: DOWNLOAD_RANGE_BYTES,
        ...(expected ? { expected } : {}),
      },
      crypto.randomUUID(),
    );
    if (outcome.status !== "range")
      throw new Error("message" in outcome ? outcome.message : "Could not download this file.");
    return outcome.range;
  };
  // The first piece says how large the file is; the rest are checked against it.
  const first = await piece(0);
  const expected = { size: first.size, modified: first.modified };
  const file = new Uint8Array(first.size);
  let received = 0;
  const write = (range: FileRange) => {
    const bytes = decode(range.data);
    file.set(bytes, range.offset);
    received += bytes.length;
    onProgress?.(file.length ? received / file.length : 1);
  };
  write(first);
  let next = DOWNLOAD_RANGE_BYTES;
  const worker = async () => {
    while (next < file.length) {
      const offset = next;
      next += DOWNLOAD_RANGE_BYTES;
      write(await piece(offset, expected));
    }
  };
  await Promise.all(Array.from({ length: WINDOW }, worker));
  return file;
}

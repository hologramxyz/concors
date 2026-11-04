import { expect, it, vi } from "vitest";
import type { DaemonConnection } from "@concors/daemon-client";
import { DOWNLOAD_RANGE_BYTES, FILE_RANGE_DOWNLOAD_CAPABILITY } from "@concors/protocol";
import { downloadProjectFile, FileTooLargeError } from "./download";

const target = { projectId: "p", epoch: "e", directory: "/d", path: "clip.mp4" };

function machine(size: number) {
  const requestFile = vi.fn(async (operation: { offset: number; length: number }) => {
    const length = Math.min(operation.length, Math.max(0, size - operation.offset));
    return {
      outcome: {
        status: "range",
        range: {
          offset: operation.offset,
          size,
          modified: 1,
          data: btoa("\x07".repeat(length)),
        },
      },
    };
  });
  const connection = {
    state: { status: "ready", daemon: { capabilities: [FILE_RANGE_DOWNLOAD_CAPABILITY] } },
    requestFile,
  } as unknown as DaemonConnection;
  return { connection, requestFile };
}

it("reads a file in pieces, reporting progress up to the whole", async () => {
  const { connection } = machine(DOWNLOAD_RANGE_BYTES * 2 + 10);
  const progress = vi.fn();
  const bytes = await downloadProjectFile(connection, target as never, progress);
  expect(bytes.length).toBe(DOWNLOAD_RANGE_BYTES * 2 + 10);
  expect(bytes.every((value) => value === 7)).toBe(true);
  expect(progress).toHaveBeenLastCalledWith(1);
});

it("refuses a file over the limit after one piece, before making room for it", async () => {
  const { connection, requestFile } = machine(DOWNLOAD_RANGE_BYTES * 10);
  const refused = downloadProjectFile(connection, target as never, undefined, {
    maxBytes: DOWNLOAD_RANGE_BYTES,
  });
  await expect(refused).rejects.toBeInstanceOf(FileTooLargeError);
  await expect(refused).rejects.toMatchObject({ size: DOWNLOAD_RANGE_BYTES * 10 });
  expect(requestFile).toHaveBeenCalledTimes(1);
});

it("stops asking for pieces once cancelled", async () => {
  const { connection, requestFile } = machine(DOWNLOAD_RANGE_BYTES * 50);
  const abort = new AbortController();
  const cancelled = downloadProjectFile(connection, target as never, () => abort.abort(), {
    signal: abort.signal,
  });
  await expect(cancelled).rejects.toThrow();
  expect(requestFile.mock.calls.length).toBeLessThan(10);
});

import { useEffect, useRef, useState } from "react";
import { MAX_SCHEDULE_FILES, MAX_UPLOAD_BYTES, type AgentUpload } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";

export const UPLOAD_LIMIT = `${MAX_UPLOAD_BYTES / 1024 / 1024} MB`;

export interface ScheduleFile {
  id: string;
  name: string;
  size: number;
  /** Set once the machine has the file; until then it is uploading, or failed with `error`. */
  upload: AgentUpload | null;
  received: number;
  error?: string;
}

/**
 * The files a schedule form attaches, uploaded as soon as they are chosen, as a chat composer
 * does. Files the schedule already had arrive uploaded. Uploads the form leaves unsaved, by
 * removing a file or closing without saving, are cancelled so the machine drops them at once.
 */
export function useScheduleFiles(
  connection: DaemonConnection | null,
  initial: AgentUpload[] | undefined,
) {
  const [files, setFiles] = useState<ScheduleFile[]>(() =>
    (initial ?? []).map((upload) => ({
      id: upload.uploadId,
      name: upload.name,
      size: upload.size,
      upload,
      received: upload.size,
    })),
  );
  const saved = useRef(new Set((initial ?? []).map((upload) => upload.uploadId)));
  const running = useRef(new Map<string, AbortController>());
  const fresh = useRef(new Set<string>());
  const committed = useRef(false);
  const patch = (id: string, change: Partial<ScheduleFile>) =>
    setFiles((list) => list.map((file) => (file.id === id ? { ...file, ...change } : file)));
  const discard = (uploadId: string) =>
    void connection
      ?.requestUpload({ kind: "cancel", uploadId }, crypto.randomUUID())
      .catch(() => undefined);

  useEffect(() => {
    const uploads = running.current;
    const unsaved = fresh.current;
    return () => {
      for (const controller of uploads.values()) controller.abort();
      if (!committed.current) for (const uploadId of unsaved) discard(uploadId);
    };
    // Runs once, on close: what to discard is read from refs at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = (chosen: File[]): string | null => {
    if (!connection) return "Machine is disconnected";
    const room = MAX_SCHEDULE_FILES - files.length;
    const tooLarge = chosen.filter((file) => file.size > MAX_UPLOAD_BYTES);
    const accepted = chosen.filter((file) => file.size <= MAX_UPLOAD_BYTES).slice(0, room);
    for (const file of accepted) {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      running.current.set(id, controller);
      setFiles((list) => [
        ...list,
        { id, name: file.name, size: file.size, upload: null, received: 0 },
      ]);
      void connection
        .upload(file, {
          name: file.name,
          mime: file.type || "application/octet-stream",
          signal: controller.signal,
          onProgress: (received) => patch(id, { received }),
        })
        .then((upload) => {
          fresh.current.add(upload.uploadId);
          patch(id, { upload, received: upload.size });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            patch(id, {
              error: cause instanceof Error ? cause.message : `${file.name} did not upload.`,
            });
        })
        .finally(() => running.current.delete(id));
    }
    if (tooLarge.length)
      return `${tooLarge.map((file) => file.name).join(", ")} ${tooLarge.length > 1 ? "are" : "is"} larger than ${UPLOAD_LIMIT}.`;
    if (accepted.length < chosen.length)
      return `A schedule can carry up to ${MAX_SCHEDULE_FILES} files.`;
    return null;
  };

  const remove = (id: string) => {
    const file = files.find((entry) => entry.id === id);
    setFiles((list) => list.filter((entry) => entry.id !== id));
    running.current.get(id)?.abort();
    // A file the schedule already had goes when the change is saved, not before.
    if (file?.upload && !saved.current.has(file.upload.uploadId)) {
      fresh.current.delete(file.upload.uploadId);
      discard(file.upload.uploadId);
    }
  };

  return {
    files,
    add,
    remove,
    uploading: files.some((file) => !file.upload && !file.error),
    failed: files.find((file) => file.error),
    /** What the saved schedule carries. */
    uploads: () => files.flatMap((file) => (file.upload ? [file.upload] : [])),
    /** The schedule saved them, so closing the form must not discard them. */
    commit: () => {
      committed.current = true;
    },
  };
}

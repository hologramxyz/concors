import { useSyncExternalStore } from "react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { AgentAttachment, AgentUpload } from "@concors/protocol";
import { isPreviewableImage } from "./attachment-cache";
import { fileBase64 } from "./image-attachment";

/**
 * A file attached in the composer and uploaded to the machine as soon as it is attached, so the
 * message itself carries only its reference. Machines without uploads take attachments inline
 * (`AgentAttachment`), as before.
 *
 * The draft keeps what can be saved and restored: the file's name, size and, once uploaded, its
 * reference. The bytes stay in memory here, outside the draft, so a draft never writes them to
 * storage, and so an upload stopped by a dropped connection or a closed composer can start again.
 * A file lost with a reload has to be attached again.
 */
export interface UploadAttachment {
  /** Local identity, kept while the file is uploaded again. */
  id: string;
  name: string;
  mime: string;
  size: number;
  /** The machine's reference, once it has the whole file. */
  upload: AgentUpload | null;
  /** Why the upload stopped; it starts again only when asked. */
  error?: string;
}
export type DraftAttachment = AgentAttachment | UploadAttachment;

export const isUpload = (attachment: DraftAttachment): attachment is UploadAttachment =>
  "upload" in attachment;

/** Not sendable yet: still uploading, or stopped with an error. */
export const unsent = (attachments: readonly DraftAttachment[]) =>
  attachments.some((attachment) => isUpload(attachment) && !attachment.upload);

/** What an operation carries, in the order the chat will list them: inline first, then uploads. */
export function messageFiles(attachments: readonly DraftAttachment[]): {
  attachments?: AgentAttachment[];
  uploads?: AgentUpload[];
} {
  const inline = attachments.filter(
    (attachment): attachment is AgentAttachment => !isUpload(attachment),
  );
  const uploads = attachments.flatMap((attachment) =>
    isUpload(attachment) && attachment.upload ? [attachment.upload] : [],
  );
  return {
    ...(inline.length ? { attachments: inline } : {}),
    ...(uploads.length ? { uploads } : {}),
  };
}

/** Images up to this size are also kept as data, to show in the composer and the sent message. */
const PREVIEW_LIMIT_BYTES = 4 * 1024 * 1024;

interface Local {
  file: Blob;
  preview: AgentAttachment | null;
  controller: AbortController | null;
  received: number;
}
const locals = new Map<string, Local>();
const listeners = new Set<() => void>();
/** Counts uploads starting and stopping, not their progress, which only chips follow. */
let version = 0;
const changed = (progress = false) => {
  if (!progress) version++;
  for (const listener of listeners) listener();
};

/** Holds a newly attached file and, for a small image, the data to show it with. */
export async function keepFile(id: string, file: File): Promise<void> {
  const preview =
    isPreviewableImage(file.type) && file.size <= PREVIEW_LIMIT_BYTES
      ? { name: file.name, mime: file.type, data: await fileBase64(file) }
      : null;
  locals.set(id, { file, preview, controller: null, received: 0 });
  changed();
}

/** Stops any upload of the file and lets go of its bytes. */
export function forgetFile(id: string): void {
  const local = locals.get(id);
  if (!local) return;
  local.controller?.abort();
  locals.delete(id);
  changed();
}

export const filePreview = (id: string) => locals.get(id)?.preview ?? null;
export const hasFile = (id: string) => locals.has(id);
export const uploading = (id: string) => !!locals.get(id)?.controller;

/** Stops an upload in progress; the draft keeps the attachment, to start again later. */
export function stopUpload(id: string): void {
  locals.get(id)?.controller?.abort();
}

export type UploadOutcome =
  | { upload: AgentUpload }
  | { error: string }
  /** The connection dropped; the upload starts again once it is back. */
  | { interrupted: true };

/** Uploads a kept file. Stopping it (`stopUpload`, `forgetFile`) settles nothing. */
export function startUpload(
  connection: DaemonConnection,
  attachment: UploadAttachment,
  settle: (outcome: UploadOutcome) => void,
): void {
  const local = locals.get(attachment.id);
  if (!local) {
    settle({ error: "Attach this file again." });
    return;
  }
  if (local.controller) return;
  const controller = new AbortController();
  local.controller = controller;
  local.received = 0;
  changed();
  connection
    .upload(local.file, {
      name: attachment.name,
      mime: attachment.mime,
      signal: controller.signal,
      onProgress: (received) => {
        local.received = received;
        changed(true);
      },
    })
    .then(
      (upload) => {
        if (!controller.signal.aborted) settle({ upload });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        settle(
          connection.state.status !== "ready"
            ? { interrupted: true }
            : { error: error instanceof Error ? error.message : "Could not upload the file" },
        );
      },
    )
    .finally(() => {
      if (local.controller === controller) local.controller = null;
      changed();
    });
}

/** How much of a file the machine has, for its chip; re-renders as chunks arrive. */
export function useUploadProgress(id: string): { running: boolean; received: number } {
  const running = useSyncExternalStore(subscribe, () => !!locals.get(id)?.controller);
  const received = useSyncExternalStore(subscribe, () => locals.get(id)?.received ?? 0);
  return { running, received };
}

/** Changes whenever an upload starts or stops. */
export const useUploadsVersion = () => useSyncExternalStore(subscribe, () => version);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

import type { AgentAttachment } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";

/** Attachments the chat can draw itself; anything else is offered as a file. */
export const PREVIEWABLE_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const isPreviewableImage = (mime: string) => PREVIEWABLE_IMAGES.includes(mime);

/** Up to three images per message, each at most 1 MB: a few dozen stay cheap to keep. */
const LIMIT = 48;
const values = new Map<string, AgentAttachment>();
const loads = new Map<string, Promise<AgentAttachment>>();
const key = (sessionId: string, itemId: string, index: number) =>
  JSON.stringify([sessionId, itemId, index]);
function keep(id: string, attachment: AgentAttachment) {
  values.delete(id);
  values.set(id, attachment);
  for (const oldest of values.keys()) {
    if (values.size <= LIMIT) break;
    values.delete(oldest);
  }
}

/**
 * Keeps what this client just sent, so its own message shows the images straight away instead of
 * fetching back what it already has. The daemon names a sent prompt `prompt:<request id>`.
 */
export function rememberSentAttachments(
  sessionId: string,
  requestId: string,
  attachments: readonly AgentAttachment[],
) {
  attachments.forEach((attachment, index) => {
    if (isPreviewableImage(attachment.mime))
      keep(key(sessionId, `prompt:${requestId}`, index), attachment);
  });
}

export function cachedAttachment(sessionId: string, itemId: string, index: number) {
  return values.get(key(sessionId, itemId, index)) ?? null;
}

/** One request per attachment however many previews ask for it at once. */
export function loadAttachment(
  connection: DaemonConnection,
  sessionId: string,
  itemId: string,
  index: number,
): Promise<AgentAttachment> {
  const id = key(sessionId, itemId, index);
  const cached = values.get(id);
  if (cached) return Promise.resolve(cached);
  let load = loads.get(id);
  if (!load) {
    load = connection
      .requestAgent({ kind: "read-attachment", sessionId, itemId, index }, crypto.randomUUID())
      .then((result) => {
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
        if (!result.outcome.attachment)
          throw new Error("Update this machine to preview attachments.");
        // Other files are read when opened, so a failed read can simply be tried again.
        if (isPreviewableImage(result.outcome.attachment.mime)) keep(id, result.outcome.attachment);
        return result.outcome.attachment;
      })
      .finally(() => loads.delete(id));
    loads.set(id, load);
  }
  return load;
}

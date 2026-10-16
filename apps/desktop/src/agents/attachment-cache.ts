import type { AgentAttachment } from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";

/** Attachments the chat can draw itself; anything else is offered as a file. */
export const PREVIEWABLE_IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const isPreviewableImage = (mime: string) => PREVIEWABLE_IMAGES.includes(mime);

/**
 * A few dozen images, and no more than this much of their data: uploaded images can be several
 * megabytes each, where inline ones were at most one.
 */
const LIMIT = 48;
const LIMIT_CHARACTERS = 64 * 1024 * 1024;
const values = new Map<string, AgentAttachment>();
const loads = new Map<string, Promise<AgentAttachment>>();
let characters = 0;
const key = (sessionId: string, itemId: string, index: number) =>
  JSON.stringify([sessionId, itemId, index]);
function keep(id: string, attachment: AgentAttachment) {
  const prior = values.get(id);
  if (prior) characters -= prior.data.length;
  values.delete(id);
  values.set(id, attachment);
  characters += attachment.data.length;
  for (const [oldest, value] of values) {
    if (values.size <= LIMIT && characters <= LIMIT_CHARACTERS) break;
    values.delete(oldest);
    characters -= value.data.length;
  }
}

/**
 * Keeps what this client just sent, so its own message shows the images straight away instead of
 * fetching back what it already has. The daemon names a sent prompt `prompt:<request id>`; the
 * list is in the message's order, with null where this client has nothing to show.
 */
export function rememberSentAttachments(
  sessionId: string,
  requestId: string,
  attachments: readonly (AgentAttachment | null)[],
) {
  attachments.forEach((attachment, index) => {
    if (attachment && isPreviewableImage(attachment.mime))
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
        // Large uploaded files come as `file`, which older clients do not read.
        const attachment = result.outcome.attachment ?? result.outcome.file;
        if (!attachment) throw new Error("Update this machine to preview attachments.");
        // Other files are read when opened, so a failed read can simply be tried again.
        if (isPreviewableImage(attachment.mime)) keep(id, attachment);
        return attachment;
      })
      .finally(() => loads.delete(id));
    loads.set(id, load);
  }
  return load;
}

import type { AgentItem } from "@concors/protocol";

/**
 * Which kept image a Markdown image in an agent's message is. The daemon records each image's
 * destination as written; the Markdown parser may hand it back percent-encoded or decoded, so both
 * sides are compared decoded.
 */
export function messageImageIndex(attachments: AgentItem["attachments"], src: string): number {
  if (!src || !attachments?.length) return -1;
  const target = decoded(src);
  return attachments.findIndex(
    (attachment) => attachment.source !== undefined && decoded(attachment.source) === target,
  );
}

function decoded(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

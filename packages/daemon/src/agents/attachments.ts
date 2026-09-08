import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentAttachment } from "@concors/protocol";
export async function saveAttachments(
  root: string,
  sessionId: string,
  attachments: AgentAttachment[],
) {
  const directory = join(root, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const inputs: ({ type: "localImage"; path: string } | { type: "text"; text: string })[] = [];
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.length > 1024 * 1024) throw new Error("Each attachment must be 1 MB or smaller");
    const filename = attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "attachment";
    const path = join(directory, randomUUID() + "-" + filename);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(attachment.mime))
      inputs.push({ type: "localImage", path });
    else
      inputs.push({
        type: "text",
        text: `The user attached "${attachment.name}". Its file on this machine is: ${path}`,
      });
  }
  return inputs;
}

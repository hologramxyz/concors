import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MAX_AGENT_IMAGE_BYTES,
  MAX_ATTACHMENT_READ_BYTES,
  type AgentAttachment,
  type AgentUpload,
} from "@concors/protocol";

type AgentInput = { type: "localImage"; path: string } | { type: "text"; text: string };

/** Files uploaded ahead of a message wait here until a message uses them. */
export const UPLOADS_DIRECTORY = "uploads";
/** An upload is written under this name until it is complete; no sanitized name can match it. */
export const PARTIAL_UPLOAD = "~incoming";

const IMAGES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** A file name that stays inside its directory, keeping the end, where the extension is. */
export function safeFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  return /^\.*$/.test(safe) ? "attachment" : safe;
}

/**
 * How the agent receives a file: as an image when it is one its model can be given, otherwise as
 * a line naming the file on this machine, which its tools can read. Oversized images take the
 * second form too, since a provider refuses the whole turn over one image it will not accept.
 */
function agentInput(path: string, name: string, mime: string, size: number): AgentInput {
  if (IMAGES.includes(mime) && size <= MAX_AGENT_IMAGE_BYTES) return { type: "localImage", path };
  return {
    type: "text",
    text: `The user attached "${name}". Its file on this machine is: ${path}`,
  };
}

export async function saveAttachments(
  root: string,
  sessionId: string,
  attachments: AgentAttachment[],
) {
  const directory = join(root, sessionId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const inputs: AgentInput[] = [];
  for (const attachment of attachments) {
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.length > 1024 * 1024) throw new Error("Each attachment must be 1 MB or smaller");
    const path = join(directory, randomUUID() + "-" + safeFileName(attachment.name));
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    inputs.push(agentInput(path, attachment.name, attachment.mime, bytes.length));
  }
  return inputs;
}

/**
 * Moves uploaded files into the chat's own directory, where they live and are removed with it.
 * Repeating a claim is harmless, so a retried or queued message claims its files again.
 */
export async function claimUploads(root: string, sessionId: string, uploads: AgentUpload[]) {
  for (const upload of uploads) {
    const target = join(root, sessionId, upload.uploadId);
    if (await exists(target)) continue;
    const staged = join(root, UPLOADS_DIRECTORY, upload.uploadId);
    const names = await readdir(staged).catch(() => []);
    if (names.length !== 1 || names[0] === PARTIAL_UPLOAD)
      throw new Error(`${upload.name} is no longer on this machine. Attach it again.`);
    await mkdir(join(root, sessionId), { recursive: true, mode: 0o700 });
    await rename(staged, target);
  }
}

/** Where a claimed upload is. Its name on disk is the sanitized one the daemon chose. */
export async function uploadedPath(root: string, sessionId: string, upload: AgentUpload) {
  const directory = join(root, sessionId, upload.uploadId);
  const [name] = await readdir(directory).catch(() => []);
  if (!name || name === PARTIAL_UPLOAD) throw new Error(`${upload.name} is no longer available.`);
  return join(directory, name);
}

/** The agent's input for a message's files: inline ones saved first, then the uploaded ones. */
export async function messageInputs(
  root: string,
  sessionId: string,
  files: { attachments?: AgentAttachment[] | undefined; uploads?: AgentUpload[] | undefined },
) {
  const inputs = files.attachments?.length
    ? await saveAttachments(root, sessionId, files.attachments)
    : [];
  for (const upload of files.uploads ?? []) {
    const path = await uploadedPath(root, sessionId, upload);
    inputs.push(agentInput(path, upload.name, upload.mime, (await stat(path)).size));
  }
  return inputs;
}

/** An uploaded file's bytes, for the chat to show or save it; past a preview's size it says where. */
export async function readUpload(root: string, sessionId: string, upload: AgentUpload) {
  const path = await uploadedPath(root, sessionId, upload);
  if ((await stat(path)).size > MAX_ATTACHMENT_READ_BYTES)
    throw new Error(`${upload.name} is too large to open here. It is on the machine at ${path}`);
  return {
    name: upload.name,
    mime: upload.mime,
    data: (await readFile(path)).toString("base64"),
  };
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

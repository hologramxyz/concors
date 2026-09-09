import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  type FileEntry,
  type FileRequest,
  type FileResult,
  type ProjectFile,
} from "@concors/protocol";
import type { WorkspaceStore } from "../workspace/store.ts";

class FileConflict extends Error {}
const revision = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Reads/writes run on the machine hosting the project, through its existing connection. */
export class ProjectFiles {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly workspace: WorkspaceStore;
  constructor(workspace: WorkspaceStore) {
    this.workspace = workspace;
  }

  async request(request: FileRequest): Promise<FileResult> {
    try {
      const operation = request.operation;
      const snapshot = this.workspace.snapshot();
      if (snapshot.epoch !== operation.epoch)
        throw new Error("Machine state changed. Reconnect before opening files.");
      const project = snapshot.projects.find((item) => item.id === operation.projectId);
      if (!project) throw new Error("Project is no longer available.");
      const root = await realpath(this.workspace.fileDirectory(project.id, operation.directory));
      if (operation.kind === "create") {
        const entry = await createProjectEntry(root, operation.path, operation.entryKind);
        return {
          type: "file.result",
          requestId: request.requestId,
          outcome: { status: "created", entry },
        };
      }
      const file = await resolveProjectPath(root, operation.path);
      let outcome: FileResult["outcome"];
      if (operation.kind === "list") {
        const entries: FileEntry[] = [];
        let truncated = false;
        for await (const entry of await opendir(file)) {
          if (entries.length === MAX_DIRECTORY_ENTRIES) {
            truncated = true;
            break;
          }
          entries.push({
            name: entry.name,
            path: relative(root, join(file, entry.name)).split(sep).join("/"),
            kind: entry.isSymbolicLink()
              ? "symlink"
              : entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "other",
          });
        }
        entries.sort(
          (a, b) =>
            Number(b.kind === "directory") - Number(a.kind === "directory") ||
            a.name.localeCompare(b.name),
        );
        outcome = { status: "listed", entries, truncated };
      } else if (operation.kind === "read") {
        outcome = { status: "read", file: await readProjectFile(file, operation.path) };
      } else {
        const previous = this.queues.get(file) ?? Promise.resolve();
        const write = previous
          .catch(() => undefined)
          .then(async () => {
            // Revalidate after waiting for any other client's write.
            await resolveProjectPath(root, operation.path);
            return writeProjectFile(
              root,
              file,
              operation.path,
              operation.content,
              operation.expectedRevision,
            );
          });
        this.queues.set(file, write);
        try {
          outcome = { status: "written", file: await write };
        } finally {
          if (this.queues.get(file) === write) this.queues.delete(file);
        }
      }
      return { type: "file.result", requestId: request.requestId, outcome };
    } catch (error) {
      return {
        type: "file.result",
        requestId: request.requestId,
        outcome: {
          status: error instanceof FileConflict ? "conflict" : "error",
          message: fileError(error),
        },
      };
    }
  }
}

function projectPath(root: string, path: string): string {
  if (
    path.includes("\0") ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.startsWith("\\") ||
    path.split(/[\\/]/).includes("..")
  )
    throw new Error("Choose a file inside this project.");
  const candidate = resolve(root, path.replaceAll("\\", "/"));
  const rel = relative(root, candidate);
  if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
    throw new Error("Choose a file inside this project.");
  return candidate;
}

async function createProjectEntry(
  root: string,
  path: string,
  kind: "file" | "directory",
): Promise<FileEntry> {
  const file = projectPath(root, path);
  if (file === root) throw new Error("Enter a name inside this project.");
  // Only the final entry may be missing. Every parent must exist inside the project without links.
  await resolveProjectPath(root, relative(root, dirname(file)));
  if (kind === "directory") {
    await mkdir(file);
  } else {
    // Exclusive creation cannot replace an existing file, directory, or symbolic link.
    const handle = await open(file, "wx");
    await handle.close();
  }
  return { name: basename(file), path: relative(root, file).split(sep).join("/"), kind };
}

async function resolveProjectPath(root: string, path: string): Promise<string> {
  const candidate = projectPath(root, path);
  const rel = relative(root, candidate);
  let cursor = root;
  for (const part of rel.split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink())
      throw new Error("Symbolic links cannot be opened in the file browser.");
  }
  const canonical = await realpath(candidate);
  const resolvedRelative = relative(root, canonical);
  if (
    resolvedRelative.startsWith(`..${sep}`) ||
    resolvedRelative === ".." ||
    isAbsolute(resolvedRelative)
  )
    throw new Error("Choose a file inside this project.");
  return candidate;
}

async function readProjectFile(file: string, path: string): Promise<ProjectFile> {
  const handle = await open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Only regular text files can be opened.");
    if (before.size > MAX_FILE_BYTES)
      throw new Error("This file exceeds the 1 MB editor limit. Open it in a terminal.");
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_FILE_BYTES)
      throw new Error("This file exceeds the 1 MB editor limit. Open it in a terminal.");
    const after = await handle.stat();
    if (before.mtimeMs !== after.mtimeMs || before.size !== after.size)
      throw new Error("File changed while loading. Try again.");
    const bytes = buffer.subarray(0, size);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new Error("This is not a UTF-8 text file. Open it in a terminal.");
    }
    if (content.includes("\0")) throw new Error("Binary files cannot be edited here.");
    return { path, content, revision: revision(bytes), size };
  } finally {
    await handle.close();
  }
}

async function writeProjectFile(
  root: string,
  file: string,
  path: string,
  content: string,
  expected: string,
): Promise<ProjectFile> {
  const bytes = Buffer.from(content, "utf8");
  if (bytes.length > MAX_FILE_BYTES) throw new Error("This file exceeds the 1 MB editor limit.");
  if (content.includes("\0")) throw new Error("Binary files cannot be edited here.");
  const current = await readProjectFile(file, path);
  const nextRevision = revision(bytes);
  // A lost acknowledgement may be retried without replacing an agent's newer content.
  if (current.revision === nextRevision) return current;
  if (current.revision !== expected)
    throw new FileConflict(
      "The file changed on disk. Your draft is kept. Compare it with the latest version before saving.",
    );
  const stat = await lstat(file);
  const temporary = join(dirname(file), `.${basename(file)}.concors-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", stat.mode & 0o777);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(stat.mode & 0o777);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await resolveProjectPath(root, path);
    if ((await readProjectFile(file, path)).revision !== expected)
      throw new FileConflict("The file changed while saving. Your draft is kept.");
    await rename(temporary, file);
    return { path, content, size: bytes.length, revision: nextRevision };
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function fileError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "EEXIST")
      return "A file or folder with that name already exists. Choose another name.";
    if (error.code === "ENOENT") return "File or folder no longer exists. Refresh the file tree.";
    if (error.code === "EACCES" || error.code === "EPERM")
      return "The machine denied access to this file.";
    if (error.code === "ENOTDIR" || error.code === "EISDIR")
      return "Choose a file or folder of the correct type.";
    return "Could not access this file on the machine. Try again.";
  }
  return error instanceof Error ? error.message : "Could not access this file.";
}

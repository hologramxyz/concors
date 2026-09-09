import { z } from "zod";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_DIRECTORY_ENTRIES = 2000;
const Path = z.string().max(4096);
const Target = { projectId: z.string().uuid(), epoch: z.string().uuid(), path: Path };
export const FileRequestSchema = z.object({
  type: z.literal("file.request"),
  requestId: z.string().uuid(),
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("list"), ...Target }),
    z.object({ kind: z.literal("read"), ...Target }),
    z.object({
      kind: z.literal("write"),
      ...Target,
      content: z.string().max(MAX_FILE_BYTES),
      expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ]),
});
export type FileRequest = z.infer<typeof FileRequestSchema>;
export type FileOperation = FileRequest["operation"];
export const ProjectFileSchema = z.object({
  path: Path,
  content: z.string().max(MAX_FILE_BYTES),
  revision: z.string(),
  size: z.number().int().nonnegative(),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;
export const FileEntrySchema = z.object({
  name: z.string(),
  path: Path,
  kind: z.enum(["directory", "file", "symlink", "other"]),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;
export const FileResultSchema = z.object({
  type: z.literal("file.result"),
  requestId: z.string().uuid(),
  outcome: z.discriminatedUnion("status", [
    z.object({
      status: z.literal("listed"),
      entries: z.array(FileEntrySchema).max(MAX_DIRECTORY_ENTRIES),
      truncated: z.boolean(),
    }),
    z.object({ status: z.literal("read"), file: ProjectFileSchema }),
    z.object({ status: z.literal("written"), file: ProjectFileSchema }),
    z.object({ status: z.literal("conflict"), message: z.string() }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type FileResult = z.infer<typeof FileResultSchema>;

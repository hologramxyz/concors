import { z } from "zod";

export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_DIRECTORY_ENTRIES = 2000;
export const PROJECT_ICON_CAPABILITY = "project-icons";
export const MAX_PROJECT_ICON_BYTES = 256 * 1024;
/** PDFs and images open read-only in a file tab, sent whole as base64. */
export const FILE_PREVIEW_CAPABILITY = "file-previews";
export const MAX_PREVIEW_BYTES = 20 * 1024 * 1024;
export const PREVIEW_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export const ProjectIconSchema = z.object({
  isGit: z.boolean(),
  source: z
    .string()
    .max(Math.ceil(MAX_PROJECT_ICON_BYTES / 3) * 4 + 64)
    .regex(/^data:image\/(?:png|svg\+xml|x-icon|webp);base64,[A-Za-z0-9+/]+=*$/)
    .nullable(),
});
export type ProjectIcon = z.infer<typeof ProjectIconSchema>;
const Path = z.string().max(4096);
const Target = {
  directory: z.string().min(1).max(4096).optional(),
  projectId: z.string().uuid(),
  epoch: z.string().uuid(),
  path: Path,
};
export const FileRequestSchema = z.object({
  type: z.literal("file.request"),
  requestId: z.string().uuid(),
  operation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project-icon"), ...Target, path: z.literal("") }),
    z.object({ kind: z.literal("list"), ...Target }),
    z.object({ kind: z.literal("read"), ...Target }),
    z.object({ kind: z.literal("preview"), ...Target }),
    z.object({
      kind: z.literal("create"),
      ...Target,
      path: Path.min(1),
      entryKind: z.enum(["file", "directory"]),
    }),
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
export const FilePreviewSchema = z.object({
  path: Path,
  mime: z.enum(PREVIEW_MIME_TYPES),
  data: z
    .string()
    .max(Math.ceil(MAX_PREVIEW_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*=*$/),
  size: z.number().int().nonnegative(),
});
export type FilePreview = z.infer<typeof FilePreviewSchema>;
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
    z.object({ status: z.literal("project-icon"), icon: ProjectIconSchema }),
    z.object({
      status: z.literal("listed"),
      entries: z.array(FileEntrySchema).max(MAX_DIRECTORY_ENTRIES),
      truncated: z.boolean(),
    }),
    z.object({ status: z.literal("read"), file: ProjectFileSchema }),
    z.object({ status: z.literal("preview"), preview: FilePreviewSchema }),
    z.object({ status: z.literal("written"), file: ProjectFileSchema }),
    z.object({ status: z.literal("created"), entry: FileEntrySchema }),
    z.object({ status: z.literal("conflict"), message: z.string() }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type FileResult = z.infer<typeof FileResultSchema>;

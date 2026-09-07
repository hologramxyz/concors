import { z } from "zod";
const Id = z.string().uuid();
export const ProjectSetupSchema = z.object({
  id: Id,
  mode: z.enum(["open", "create", "clone"]),
  name: z.string().trim().min(1).max(120),
  directory: z.string().trim().min(1).max(4096),
  repository: z.string().trim().max(4096),
  status: z.enum(["working", "done", "failed", "cancelled", "interrupted"]),
  progress: z.string().max(4096),
});
export type ProjectSetup = z.infer<typeof ProjectSetupSchema>;
export const ProjectRequestSchema = z.object({
  type: z.literal("project.request"),
  requestId: Id,
  operation: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("start"),
      epoch: Id,
      ...ProjectSetupSchema.pick({
        id: true,
        mode: true,
        name: true,
        directory: true,
        repository: true,
      }).shape,
    }),
    z.object({ kind: z.literal("cancel"), id: Id }),
  ]),
});
export type ProjectRequest = z.infer<typeof ProjectRequestSchema>;
export type ProjectOperation = ProjectRequest["operation"];
export const ProjectResultSchema = z.object({
  type: z.literal("project.result"),
  requestId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ok") }),
    z.object({ status: z.literal("error"), message: z.string() }),
  ]),
});
export type ProjectResult = z.infer<typeof ProjectResultSchema>;
export const ProjectSetupsSchema = z.object({
  type: z.literal("project.setups"),
  setups: z.array(ProjectSetupSchema).max(64),
});

import { z } from "zod";

const Id = z.string().uuid();
const Name = z.string().trim().min(1).max(120);
const Version = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PaneProfileSchema = z.enum(["shell", "chat", "codex", "claude", "opencode"]);
export type PaneProfile = z.infer<typeof PaneProfileSchema>;

export const LayoutNodeSchema = z.discriminatedUnion("kind", [
  z.object({
    id: Id,
    kind: z.literal("pane"),
    profile: PaneProfileSchema,
    sessionId: Id.nullable(),
    directory: z.string().min(1).max(4096).optional(),
  }),
  z.object({
    id: Id,
    kind: z.literal("split"),
    axis: z.enum(["horizontal", "vertical"]),
    before: z.boolean().optional(),
    ratio: z.number().min(0.1).max(0.9),
    first: Id,
    second: Id,
  }),
]);
export type LayoutNode = z.infer<typeof LayoutNodeSchema>;
export const WorkspaceTabSchema = z.object({
  id: Id,
  name: Name,
  root: Id,
  nodes: z.array(LayoutNodeSchema).min(1).max(63),
});
export type WorkspaceTab = z.infer<typeof WorkspaceTabSchema>;
export const WorkspaceProjectSchema = z.object({
  id: Id,
  name: Name,
  directory: z.string().min(1).max(4096),
  directoryMode: z.enum(["follow", "pinned"]).optional(),
  followPaneId: Id.optional(),
  version: Version,
  tabs: z.array(WorkspaceTabSchema).max(32),
});
export type WorkspaceProject = z.infer<typeof WorkspaceProjectSchema>;
export const WorkspaceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  machineId: Id,
  epoch: Id,
  revision: Version,
  projects: z.array(WorkspaceProjectSchema).max(64),
  selection: z.object({ projectId: Id, tabId: Id.nullable() }).nullable(),
});
export type WorkspaceSnapshot = z.infer<typeof WorkspaceSnapshotSchema>;

const ProjectTarget = { projectId: Id, expectedVersion: Version };
const TabTarget = { ...ProjectTarget, tabId: Id };
export const WorkspaceOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project.add"),
    projectId: Id,
    name: Name,
    directory: z.string().trim().min(1).max(4096),
    directoryMode: z.enum(["follow", "pinned"]).optional(),
  }),
  z.object({ kind: z.literal("project.remove"), ...ProjectTarget }),
  z.object({
    kind: z.literal("tab.create"),
    sourcePaneId: Id.optional(),
    ...ProjectTarget,
    tabId: Id,
    paneId: Id,
    name: Name,
    profile: PaneProfileSchema,
  }),
  z.object({ kind: z.literal("tab.rename"), ...TabTarget, name: Name }),
  z.object({ kind: z.literal("tab.move"), ...TabTarget, index: z.number().int().min(0).max(31) }),
  z.object({ kind: z.literal("tab.close"), ...TabTarget }),
  z.object({
    kind: z.literal("pane.split"),
    ...TabTarget,
    paneId: Id,
    newPaneId: Id,
    splitId: Id,
    axis: z.enum(["horizontal", "vertical"]),
    before: z.boolean().optional(),
    profile: PaneProfileSchema,
  }),
  z.object({ kind: z.literal("pane.close"), ...TabTarget, paneId: Id }),
  z.object({
    kind: z.literal("pane.move"),
    ...TabTarget,
    paneId: Id,
    targetPaneId: Id,
    scope: z.enum(["pane", "workspace"]).optional(),
    placement: z.enum(["center", "left", "right", "top", "bottom"]),
    splitId: Id,
  }),
  z.object({
    kind: z.literal("pane.resize"),
    ...TabTarget,
    splitId: Id,
    ratio: z.number().min(0.1).max(0.9),
  }),
  z.object({
    kind: z.literal("pane.configure"),
    ...TabTarget,
    paneId: Id,
    profile: PaneProfileSchema,
  }),
  z.object({ kind: z.literal("selection.set"), projectId: Id, tabId: Id.nullable() }),
]);
export type WorkspaceOperation = z.infer<typeof WorkspaceOperationSchema>;

export const WorkspaceCommandSchema = z.object({
  type: z.literal("workspace.command"),
  commandId: Id,
  epoch: Id,
  operation: WorkspaceOperationSchema,
});
export type WorkspaceCommand = z.infer<typeof WorkspaceCommandSchema>;
export const WorkspaceSubscribeSchema = z.object({ type: z.literal("workspace.subscribe") });
export const WorkspaceSnapshotMessageSchema = z.object({
  type: z.literal("workspace.snapshot"),
  snapshot: WorkspaceSnapshotSchema,
});
export const WorkspaceResultSchema = z.object({
  type: z.literal("workspace.result"),
  commandId: Id,
  outcome: z.discriminatedUnion("status", [
    z.object({ status: z.literal("accepted"), revision: Version }),
    z.object({
      status: z.literal("rejected"),
      code: z.enum([
        "CONFLICT",
        "NOT_FOUND",
        "INVALID_OPERATION",
        "LIMIT_EXCEEDED",
        "INTERNAL_ERROR",
      ]),
      message: z.string(),
    }),
  ]),
});
export type WorkspaceResult = z.infer<typeof WorkspaceResultSchema>;

import type { LayoutNode, WorkspaceSnapshot } from "@concors/protocol";

/** The pane showing the Supervisor's chat: the only one in the only tab of its own project. */
export function supervisorPane(
  workspace: Pick<WorkspaceSnapshot, "supervisor"> | null | undefined,
): Extract<LayoutNode, { kind: "pane" }> | undefined {
  const pane = workspace?.supervisor?.tabs[0]?.nodes.find((node) => node.kind === "pane");
  return pane?.kind === "pane" ? pane : undefined;
}

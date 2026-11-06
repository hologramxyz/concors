import { WorkspaceTree, type WorkspaceTreeProps } from "@/workspace/workspace-tree";
import { useChatMenu } from "./chat-menu-context";

/**
 * Desktop's workspace tree in the phone's sidebar: every tab under its workspace, closed chats
 * muted below them. A workspace row only folds, since the phone opens tabs from their rows, and
 * its chat menus share the phone's one undo with the Tabs sheet.
 */
export function MobileWorkspaceTree(
  props: Omit<WorkspaceTreeProps, "workspaceTap" | "rowActions">,
) {
  return <WorkspaceTree {...props} workspaceTap="toggle" rowActions={useChatMenu() ?? undefined} />;
}

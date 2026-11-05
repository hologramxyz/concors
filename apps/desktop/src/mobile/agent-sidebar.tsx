import type { MobileTarget } from "@concors/client-core";
import type { WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
import { AgentSidebar } from "@/agents/list";
import { agentPane } from "@/agents/visible-sessions";
import { useChatMenu } from "./chat-menu-context";
import { WorkspaceActions } from "./workspace-actions";

/**
 * The sidebar's Agents list, whose rows open the same menu as the agent's tab in the Tabs sheet.
 * An agent no tab shows has no menu, as there is no tab for it to act on.
 */
export function MobileAgentSidebar({
  onSelect,
  workspace,
  paneId,
  canEdit,
  execute,
  command,
  select,
}: {
  onSelect(id: string): void;
  workspace: WorkspaceSnapshot | null;
  /** The pane the phone shows. */
  paneId: string | undefined;
  canEdit: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  select(target: MobileTarget): void;
}) {
  const menu = useChatMenu();
  return (
    <AgentSidebar
      onSelect={onSelect}
      workspace={workspace}
      hidden={menu?.hidden}
      actions={(id, name) => {
        const target = agentPane(workspace, id);
        return (
          target && (
            <WorkspaceActions
              sidebar
              label={`Actions for ${name}`}
              title={name}
              project={target.project}
              tab={target.tab}
              pane={target.pane}
              selected={target.pane.id === paneId}
              canEdit={canEdit}
              execute={execute}
              command={command}
              onSelect={select}
            />
          )
        );
      }}
    />
  );
}

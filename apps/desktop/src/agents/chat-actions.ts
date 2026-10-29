import { useContext } from "react";
import {
  AGENT_PIN_DELETE_CAPABILITY,
  type AgentInfo,
  type WorkspaceOperation,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";

/** What a chat is called in the sidebar: its pane's or tab's name, or its own. */
export const chatName = (chat: Pick<AgentInfo, "name" | "paneName" | "tabName">) =>
  chat.paneName ?? chat.tabName ?? chat.name;

/**
 * Pins and deletes chats, once the machine supports it. Deleting an open chat closes its pane
 * first, and with it the tab when the chat was all it showed.
 */
export function useChatActions(
  workspace: Pick<WorkspaceSnapshot, "projects"> | null,
  execute: (operation: WorkspaceOperation) => Promise<void>,
) {
  const connection = useContext(TerminalConnectionContext);
  if (
    connection?.state.status !== "ready" ||
    !connection.state.daemon.capabilities?.includes(AGENT_PIN_DELETE_CAPABILITY)
  )
    return null;
  const request = async (operation: Parameters<typeof connection.requestAgent>[0]) => {
    const result = await connection.requestAgent(operation, crypto.randomUUID());
    if (result.outcome.status === "error") throw new Error(result.outcome.message);
  };
  return {
    pin: (chat: AgentInfo, pinned: boolean) => request({ kind: "pin", sessionId: chat.id, pinned }),
    remove: async (chat: AgentInfo) => {
      for (const project of workspace?.projects ?? [])
        for (const tab of project.tabs)
          for (const node of tab.nodes)
            if (node.kind === "pane" && node.sessionId === chat.id)
              await execute({
                kind: "pane.close",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: tab.id,
                paneId: node.id,
              });
      await request({ kind: "delete", sessionId: chat.id });
    },
  };
}
export type ChatActions = NonNullable<ReturnType<typeof useChatActions>>;

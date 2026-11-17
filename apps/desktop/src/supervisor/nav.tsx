import { Network } from "lucide-react";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { cn } from "cn";
import { chatAgentStatus } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { AgentLoadingIcon } from "@/agents/activity";
import { chatState } from "@/workspace/sidebar-rows";
import { SidebarDot } from "@/workspace/sidebar-tabs";
import { supervisorPane } from "./pane";

export function SupervisorNav({
  workspace,
  selected,
  onClick,
}: {
  workspace: Pick<WorkspaceSnapshot, "supervisor"> | null;
  selected: boolean;
  onClick: () => void;
}) {
  const sessionId = supervisorPane(workspace)?.sessionId;
  const agent = useAgents().find((item) => item.id === sessionId);
  // Its chat is in no workspace, so this row is where it shows what a chat's row would: a
  // question or failure, a finish not yet read, or a reply still coming.
  const state = agent && chatState(agent);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Supervisor"
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-2 text-ui hover:bg-sidebar-accent/70",
        selected
          ? "bg-sidebar-accent text-sidebar-foreground hover:bg-sidebar-accent"
          : "text-muted-foreground",
      )}
    >
      <Network className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1 text-left">Supervisor</span>
      {agent && (state === "attention" || state === "done" || state === "working") && (
        <span
          role="img"
          aria-label={`Agent status: ${chatAgentStatus(agent).status}`}
          data-row-state={state}
          className="flex size-4 shrink-0 items-center justify-center"
        >
          {state === "working" ? (
            <AgentLoadingIcon className="size-3.5" />
          ) : (
            <SidebarDot dot={state} />
          )}
        </span>
      )}
    </button>
  );
}

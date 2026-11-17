import { useState } from "react";
import { Ellipsis, Plug } from "lucide-react";
import type { WorkspaceSnapshot } from "@concors/protocol";
import { useAgents } from "@/agents/context";
import { McpStatusDialog } from "@/agents/mcp-status-dialog";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supervisorPane } from "./pane";

/**
 * The Supervisor's menu in its title bar, standing in for the menu a workspace chat's pane header
 * has: the Supervisor has no pane header, and so no other way to its agent's MCP servers. Only what
 * applies to a chat outside every workspace is here; moving, splitting and renaming are not.
 */
export function SupervisorActions({
  workspace,
}: {
  workspace: Pick<WorkspaceSnapshot, "supervisor"> | null;
}) {
  const sessionId = supervisorPane(workspace)?.sessionId;
  const agent = useAgents().find((item) => item.id === sessionId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  if (!agent?.controls?.mcpStatus) return null;
  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <SidebarTooltip place="title-bar" hidden={menuOpen} content="Supervisor options">
          <DropdownMenuTrigger
            aria-label="Supervisor actions"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
        </SidebarTooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMcpOpen(true)}>
            <Plug /> <span className="whitespace-nowrap">MCP servers…</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mcpOpen && <McpStatusDialog agent={agent} open={mcpOpen} onOpenChange={setMcpOpen} />}
    </>
  );
}

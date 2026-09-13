import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { WorkspaceSidebarItem } from "@/workspace/sidebar-item";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { projectIconKey } from "@/workspace/project-icons";
import { shortcutLabel } from "@/shortcuts/bindings";
import { AgentSidebar } from "@/agents/list";
import { SidebarSection } from "./sidebar-section";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { cn } from "cn";
import type { WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import type { View } from "@/navigation";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
import { MachineSwitcher } from "@/workspace/machine-switcher";
import type { Host } from "@/workspace/machines";

interface AppSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  onSelectAgent: (id: string) => void;
  view: View;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
  workspace: WorkspaceSnapshot | null;
  canEdit: boolean;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onOpenFolder: (mode: "open" | "clone", trigger?: HTMLElement | null) => void;
  hostScope: string;
  selectedHost: Host;
  machineConnected: boolean;
  onSelectMachine: (host: Host) => void;
  onViewCloud: (machineId?: string) => void;
  auth: SignedInAuth;
  onSignOut: () => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
}

export function AppSidebar(props: AppSidebarProps) {
  const icons = useProjectIcons(props.workspace);

  return (
    <div className="sidebar-shell" data-collapsed={props.collapsed}>
      <nav
        id="app-sidebar"
        aria-label="Primary"
        className="flex h-full w-full flex-col bg-sidebar text-ui text-sidebar-foreground"
      >
        <div
          className={cn(
            "flex shrink-0 items-center gap-1",
            props.collapsed ? "m-[6px] flex-col" : "m-2 h-9 justify-between",
          )}
        >
          <MachineSwitcher
            compact={props.collapsed}
            key={activeOrganization(props.auth)?.id}
            organizationId={activeOrganization(props.auth)?.id}
            onViewCloud={props.onViewCloud}
            scope={props.hostScope}
            selected={props.selectedHost}
            connected={props.machineConnected}
            onSelect={props.onSelectMachine}
          />
          <div
            className={cn(
              "flex shrink-0 items-center gap-0.5",
              props.collapsed ? "flex-col-reverse" : "ml-auto",
            )}
          >
            <SidebarTooltip collapsed={props.collapsed}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Search"
                  onClick={props.onOpenSearch}
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    props.collapsed ? "sidebar-rail-control" : "p-1.5",
                  )}
                >
                  <Search className="size-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent side={props.collapsed ? "right" : "bottom"}>
                Search ({shortcutLabel("search")})
              </TooltipContent>
            </SidebarTooltip>
            <SidebarTooltip collapsed={props.collapsed}>
              <TooltipTrigger asChild>
                <button
                  id={props.collapsed ? "expand-sidebar" : "collapse-sidebar"}
                  type="button"
                  aria-label={props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  aria-controls="app-sidebar"
                  aria-expanded={!props.collapsed}
                  onClick={props.onCollapse}
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    props.collapsed ? "sidebar-rail-control" : "p-1.5",
                  )}
                >
                  {props.collapsed ? (
                    <PanelLeftOpen className="size-4" aria-hidden="true" />
                  ) : (
                    <PanelLeftClose className="size-4" aria-hidden="true" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side={props.collapsed ? "right" : "bottom"}>
                {props.collapsed ? "Expand sidebar" : "Collapse sidebar"}
              </TooltipContent>
            </SidebarTooltip>
          </div>
        </div>
        <div
          className={cn(
            "min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto py-3",
            props.collapsed ? "px-[6px]" : "px-2",
          )}
        >
          <SidebarSection
            title="Workspaces"
            compact={props.collapsed}
            action={
              <NewWorkspaceMenu
                rail={props.collapsed}
                disabled={!props.canEdit}
                onNew={props.onAddProject}
                onOpen={props.onOpenFolder}
              />
            }
          >
            <ul className="mt-1 space-y-0.5">
              {props.workspace?.projects.map((project) => (
                <WorkspaceSidebarItem
                  key={project.id}
                  project={project}
                  compact={props.collapsed}
                  selected={
                    props.view === "projects" &&
                    props.workspace?.selection?.projectId === project.id
                  }
                  canEdit={props.canEdit}
                  icon={
                    props.workspace
                      ? icons.get(projectIconKey(props.workspace.epoch, project))
                      : undefined
                  }
                  onSelect={props.onSelectProject}
                  execute={props.execute}
                />
              ))}
              {!props.collapsed && props.workspace?.projects.length === 0 && (
                <li className="px-2 py-3 text-ui leading-relaxed text-muted-foreground">
                  Start a workspace or open a folder.
                </li>
              )}
            </ul>
          </SidebarSection>
          {props.collapsed ? (
            <AgentSidebar compact onSelect={props.onSelectAgent} workspace={props.workspace} />
          ) : (
            <SidebarSection title="Agents">
              <AgentSidebar onSelect={props.onSelectAgent} workspace={props.workspace} />
            </SidebarSection>
          )}
          {!props.collapsed && (
            <SidebarSection title="Servers">
              <p className="px-2 py-2 leading-relaxed text-muted-foreground">
                No servers discovered.
              </p>
            </SidebarSection>
          )}
        </div>
        <div className={cn("border-t border-sidebar-border", props.collapsed ? "p-[6px]" : "p-2")}>
          <AccountMenu
            collapsed={props.collapsed}
            auth={props.auth}
            onSignOut={props.onSignOut}
            onOpenSettings={props.onOpenSettings}
          />
        </div>
      </nav>
    </div>
  );
}

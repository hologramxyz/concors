import { SchedulesNav } from "@/schedules/nav";
import { PullRequestsNav } from "@/pull-requests/nav";
import { usePullRequests } from "@/pull-requests/use-pull-requests";
import { pullRequestKey } from "@/pull-requests/store";
import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { WorkspaceSidebarItem } from "@/workspace/sidebar-item";
import { clashingWorkspaceParents } from "@/workspace/workspace-parents";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { projectIconKey } from "@/workspace/project-icons";
import { useShortcutLabels } from "@/shortcuts/preferences-context";
import { AgentSidebar } from "@/agents/list";
import { PreviewsSidebar } from "@/host/previews-sidebar";
import { SidebarEmpty, SidebarSection } from "./sidebar-section";
import { PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { cn } from "cn";
import { useWindowChrome } from "@/window/context";
import type { WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import type { View } from "@/navigation";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
import { UpdateBadge } from "@/update/update-badge";
import { MachineSwitcher } from "@/workspace/machine-switcher";
import type { Host } from "@/workspace/machines";

interface AppSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  onSelectAgent: (id: string) => void;
  view: View;
  onOpenSettings: () => void;
  onOpenSchedules: () => void;
  /** Opens the Pull requests page, for one workspace or one of its repositories when given. */
  onOpenPullRequests: (projectId?: string, repository?: string) => void;
  onOpenSearch: () => void;
  onOpenResources: () => void;
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
  /** Like `execute`, but a failure is shown in the window's error banner. */
  onCommand: (operation: WorkspaceOperation) => void;
}

export function AppSidebar(props: AppSidebarProps) {
  const shortcutLabel = useShortcutLabels();
  const icons = useProjectIcons(props.workspace);
  const pullRequests = usePullRequests(props.workspace);
  const parents = clashingWorkspaceParents(props.workspace?.projects ?? []);
  const windowChrome = useWindowChrome();
  const trafficLights = windowChrome.inset && !windowChrome.fullscreen;
  const machineSwitcher = (
    <MachineSwitcher
      compact={props.collapsed}
      key={activeOrganization(props.auth)?.id}
      organizationId={activeOrganization(props.auth)?.id}
      onViewCloud={props.onViewCloud}
      scope={props.hostScope}
      selected={props.selectedHost}
      connected={props.machineConnected}
      onSelect={props.onSelectMachine}
      onOpenResources={props.onOpenResources}
    />
  );
  const controls = (
    <div
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        props.collapsed ? "flex-col-reverse" : !windowChrome.inset && "ml-auto",
      )}
    >
      <SidebarTooltip collapsed={props.collapsed}>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Search"
            data-tour="search"
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
  );

  return (
    <div className="sidebar-shell" data-collapsed={props.collapsed}>
      <nav
        id="app-sidebar"
        aria-label="Primary"
        className="flex h-full w-full flex-col bg-sidebar text-ui text-sidebar-foreground"
      >
        {windowChrome.inset && !props.collapsed ? (
          <>
            <div
              data-tauri-drag-region
              className={cn(
                "box-content flex h-11 shrink-0 items-center pt-2",
                trafficLights ? "pl-(--traffic-lights-width)" : "pl-2",
              )}
            >
              {controls}
            </div>
            <div className="mx-2 flex h-9 shrink-0 items-center">{machineSwitcher}</div>
          </>
        ) : (
          <>
            {windowChrome.inset && (
              <div data-tauri-drag-region className="box-content h-11 shrink-0 pt-2" />
            )}
            <div
              className={cn(
                "flex shrink-0 items-center gap-1",
                props.collapsed ? "m-[6px] flex-col" : "m-2 h-11",
              )}
            >
              {machineSwitcher}
              {controls}
            </div>
          </>
        )}
        <div
          className={cn(
            "min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto py-3",
            props.collapsed ? "px-[6px]" : "px-2",
          )}
        >
          <div className="space-y-0.5" data-tour="schedules">
            <SchedulesNav
              selected={props.view === "schedules"}
              compact={props.collapsed}
              onClick={props.onOpenSchedules}
            />
            <PullRequestsNav
              workspace={props.workspace}
              selected={props.view === "pull-requests"}
              compact={props.collapsed}
              onClick={() => props.onOpenPullRequests()}
            />
          </div>
          <div data-tour="workspaces">
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
              {props.workspace?.projects.length ? (
                <ul className="mt-1 space-y-0.5">
                  {props.workspace.projects.map((project) => (
                    <WorkspaceSidebarItem
                      key={project.id}
                      project={project}
                      parent={parents.get(project.id)}
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
                      pullRequests={
                        props.workspace
                          ? pullRequests.workspaces.get(
                              pullRequestKey(props.workspace.epoch, project),
                            )
                          : undefined
                      }
                      onSelect={props.onSelectProject}
                      onOpenPullRequests={props.onOpenPullRequests}
                      execute={props.execute}
                      onCommand={props.onCommand}
                    />
                  ))}
                </ul>
              ) : null}
              {!props.collapsed && props.workspace?.projects.length === 0 && (
                <SidebarEmpty>No workspaces yet.</SidebarEmpty>
              )}
            </SidebarSection>
          </div>
          {props.collapsed ? (
            <AgentSidebar compact onSelect={props.onSelectAgent} workspace={props.workspace} />
          ) : (
            <SidebarSection title="Agents">
              <AgentSidebar
                onSelect={props.onSelectAgent}
                workspace={props.workspace}
                canEdit={props.canEdit}
                onCommand={props.onCommand}
              />
            </SidebarSection>
          )}
          <PreviewsSidebar compact={props.collapsed} />
        </div>
        <div className={cn("space-y-1", props.collapsed ? "p-[6px]" : "p-2")}>
          <UpdateBadge collapsed={props.collapsed} />
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

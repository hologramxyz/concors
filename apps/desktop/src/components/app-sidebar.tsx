import { SupervisorNav } from "@/supervisor/nav";
import { SchedulesNav } from "@/schedules/nav";
import { PullRequestsNav } from "@/pull-requests/nav";
import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { recentlyClosed } from "@/workspace/closed-workspaces";
import { WorkspaceTree } from "@/workspace/workspace-tree";
import { useRef } from "react";
import { PreviewsSidebar } from "@/host/previews-sidebar";
import { SidebarEmpty, SidebarSection } from "./sidebar-section";
import { SearchButton } from "@/components/search-button";
import { ChatLimitBanner } from "@/agents/chat-limit";
import { useChatActions } from "@/agents/chat-actions";
import { useAgents } from "@/agents/context";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { cn } from "cn";
import { useWindowChrome } from "@/window/context";
import type { WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import type { View } from "@/navigation";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
import { MobileAppCard } from "@/components/mobile-app";
import { GuestSignInCard } from "@/auth/guest-sign-in-card";
import { UpdateBadge } from "@/update/update-badge";
import { MachineSwitcher } from "@/workspace/machine-switcher";
import type { Host } from "@/workspace/machines";

interface AppSidebarProps {
  collapsed: boolean;
  onCollapse: () => void;
  onSelectAgent: (id: string) => void;
  /** Switches to one tab of a workspace, as clicking it in that workspace's tab bar does. */
  onSelectTab: (projectId: string, tabId: string) => void;
  view: View;
  onOpenSettings: () => void;
  onOpenSupervisor: () => void;
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
  auth: SignedInAuth | null;
  /** Using this computer without an account; a session that could not be checked is not one. */
  guest: boolean;
  /** The workspace is loaded, so Take the tour has something to point at. */
  canTour: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  /** Like `execute`, but a failure is shown in the window's error banner. */
  onCommand: (operation: WorkspaceOperation) => void;
}

export function AppSidebar(props: AppSidebarProps) {
  const windowChrome = useWindowChrome();
  const trafficLights = windowChrome.inset && !windowChrome.fullscreen;
  const machineSwitcher = (
    <MachineSwitcher
      compact={false}
      key={props.auth ? activeOrganization(props.auth)?.id : undefined}
      organizationId={props.auth ? activeOrganization(props.auth)?.id : undefined}
      onViewCloud={props.onViewCloud}
      scope={props.hostScope}
      selected={props.selectedHost}
      connected={props.machineConnected}
      onSelect={props.onSelectMachine}
      onOpenResources={props.onOpenResources}
    />
  );
  const search = <SearchButton onOpenSearch={props.onOpenSearch} tour />;
  const toggle = <SidebarToggle collapsed={false} onToggle={props.onCollapse} className="p-1.5" />;
  const footer = useRef<HTMLDivElement>(null);

  return (
    // Collapsed, the sidebar keeps its layout and is clipped to nothing, so it slides away whole;
    // inert keeps its hidden controls out of focus and the accessibility tree.
    <div className="sidebar-shell" data-collapsed={props.collapsed} inert={props.collapsed}>
      <nav
        id="app-sidebar"
        aria-label="Primary"
        className="flex h-full w-(--sidebar-width) flex-col bg-sidebar text-ui text-sidebar-foreground"
      >
        {windowChrome.inset ? (
          <>
            <div
              data-tauri-drag-region
              className={cn(
                "box-content flex h-11 shrink-0 items-center gap-0.5 pt-2",
                trafficLights ? "pl-(--traffic-lights-width)" : "pl-2",
              )}
            >
              {toggle}
              {search}
            </div>
            <div className="mx-2 flex h-9 shrink-0 items-center">{machineSwitcher}</div>
          </>
        ) : (
          <div className="m-2 flex h-11 shrink-0 items-center gap-1">
            {machineSwitcher}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              {search}
              {toggle}
            </div>
          </div>
        )}
        <div className={cn("min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-2 py-3")}>
          <div className="space-y-0.5" data-tour="schedules">
            <SupervisorNav
              selected={props.view === "supervisor"}
              onClick={props.onOpenSupervisor}
            />
            <SchedulesNav
              selected={props.view === "schedules"}
              compact={false}
              onClick={props.onOpenSchedules}
            />
            <PullRequestsNav
              workspace={props.workspace}
              selected={props.view === "pull-requests"}
              compact={false}
              onClick={() => props.onOpenPullRequests()}
            />
          </div>
          <>
            <div data-tour="workspaces">
              <SidebarSection
                title="Workspaces"
                compact={false}
                action={
                  <NewWorkspaceMenu
                    rail={false}
                    disabled={!props.canEdit}
                    onNew={props.onAddProject}
                    onOpen={props.onOpenFolder}
                    closed={recentlyClosed(props.workspace)}
                    onReopen={(projectId) => props.onCommand({ kind: "project.reopen", projectId })}
                  />
                }
              >
                <WorkspaceTree
                  workspace={props.workspace}
                  canEdit={props.canEdit}
                  collapsed={false}
                  selection={
                    props.view === "projects" ? (props.workspace?.selection ?? null) : null
                  }
                  onSelectAgent={props.onSelectAgent}
                  onSelectTab={props.onSelectTab}
                  onSelectProject={props.onSelectProject}
                  onOpenPullRequests={props.onOpenPullRequests}
                  execute={props.execute}
                  onCommand={props.onCommand}
                />
                {props.workspace?.projects.length === 0 && (
                  <SidebarEmpty>No workspaces yet.</SidebarEmpty>
                )}
              </SidebarSection>
            </div>
            <PreviewsSidebar compact={false} />
          </>
        </div>
        <SidebarChatLimit workspace={props.workspace} execute={props.execute} />
        {props.guest && (
          <GuestSignInCard
            onSignIn={props.onSignIn}
            onDismissed={() => footer.current?.querySelector("button")?.focus()}
          />
        )}
        <MobileAppCard onDismissed={() => footer.current?.querySelector("button")?.focus()} />
        <div ref={footer} className="space-y-1 p-2">
          <UpdateBadge collapsed={false} />
          <AccountMenu
            collapsed={false}
            auth={props.auth}
            canTour={props.canTour}
            onSignOut={props.onSignOut}
            onSignIn={props.onSignIn}
            onOpenSettings={props.onOpenSettings}
          />
        </div>
      </nav>
    </div>
  );
}

/** The near-limit line, apart from the sidebar so chat updates repaint only it. */
function SidebarChatLimit({ workspace, execute }: Pick<AppSidebarProps, "workspace" | "execute">) {
  const chats = useAgents();
  const actions = useChatActions(execute);
  return <ChatLimitBanner workspace={workspace} chats={chats} actions={actions} />;
}

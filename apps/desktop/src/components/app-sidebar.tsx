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
import { SidebarTabRow, UnavailableChats } from "@/workspace/sidebar-tabs";
import {
  sidebarRows,
  stableOrder,
  useMinuteClock,
  type OpenTabRow,
  type SidebarRow,
} from "@/workspace/sidebar-rows";
import { defaultPaneTitle, mainPane } from "@/workspace/tab-title";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { canFork, useForkChat } from "@/agents/fork";
import { useSchedules } from "@/schedules/use-schedules";
import { Fragment, useContext, useLayoutEffect, useRef, useState } from "react";
import {
  isDefaultTabName,
  PANE_RENAME_CAPABILITY,
  type AgentInfo,
  type WorkspaceProject,
} from "@concors/protocol";
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
  /** Switches to one tab of a workspace, as clicking it in that workspace's tab bar does. */
  onSelectTab: (projectId: string, tabId: string) => void;
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

/** The rows' order as `order` (JSON) gives it, keeping the same map when nothing moved. */
function followOrder(previous: ReadonlyMap<string, string[]>, order: string) {
  return JSON.stringify([...previous]) === order
    ? previous
    : new Map(JSON.parse(order) as [string, string[]][]);
}

/** The chat a row stands for, when it stands for one. */
const rowChatId = (row: SidebarRow) => (row.kind === "tab" ? row.chat?.id : row.chat.agent.id);

/** Each workspace lists this many rows before "Show more"; the selected tab is always among them. */
const ROWS_SHOWN = 5;

export function AppSidebar(props: AppSidebarProps) {
  const shortcutLabel = useShortcutLabels();
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
              <WorkspaceTree {...props} />
              {!props.collapsed && props.workspace?.projects.length === 0 && (
                <SidebarEmpty>No workspaces yet.</SidebarEmpty>
              )}
            </SidebarSection>
          </div>
          {props.collapsed && (
            <AgentSidebar compact onSelect={props.onSelectAgent} workspace={props.workspace} />
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

/**
 * The workspaces and their tabs. Its state lives here, not in the sidebar, so hovering the list
 * (which freezes its order) repaints only the list and not the controls and tooltips around it.
 */
function WorkspaceTree(props: AppSidebarProps) {
  const icons = useProjectIcons(props.workspace);
  const pullRequests = usePullRequests(props.workspace);
  const parents = clashingWorkspaceParents(props.workspace?.projects ?? []);
  const connection = useContext(TerminalConnectionContext);
  const forkChat = useForkChat();
  const now = useMinuteClock();
  const chats = useAgents();
  const { rows, unavailable } = sidebarRows(props.workspace, chats, useTerminalSessions());
  const currentProjectId = props.workspace?.selection?.projectId ?? null;
  const selectedTabId =
    props.view === "projects" ? (props.workspace?.selection?.tabId ?? null) : null;
  // Only the workspace you are in starts expanded; what you expand or collapse yourself sticks.
  const [expandedByHand, setExpandedByHand] = useState<Record<string, boolean>>({});
  const isExpanded = (id: string) => expandedByHand[id] ?? id === currentProjectId;
  const selectWorkspace = (id: string) => {
    if (props.view === "projects" && id === currentProjectId) {
      setExpandedByHand((previous) => ({ ...previous, [id]: !isExpanded(id) }));
      return;
    }
    // Switching to a workspace expands it, even one collapsed by hand earlier.
    if (expandedByHand[id] === false) setExpandedByHand(({ [id]: _collapsed, ...rest }) => rest);
    props.onSelectProject(id);
  };
  const [more, setMore] = useState<ReadonlySet<string>>(new Set());
  // The order rows were last shown in. It follows every change except while the pointer is over
  // the list: rows then keep their places and new ones go after them. Hovering itself changes no
  // state, so it never repaints anything; only a change that arrives meanwhile is held back.
  const hovering = useRef(false);
  const [shownOrder, setShownOrder] = useState<ReadonlyMap<string, string[]>>(new Map());
  const order = JSON.stringify([...rows].map(([id, list]) => [id, list.map((row) => row.key)]));
  useLayoutEffect(() => {
    if (!hovering.current) setShownOrder((previous) => followOrder(previous, order));
  }, [order]);
  const canRenamePanes =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PANE_RENAME_CAPABILITY);
  /**
   * A tab nobody named shows its main pane's title, so renaming its row names that pane, as the
   * pane's own menu does: the tab, the pane and the chat once closed all keep the name, and
   * clearing it returns to the automatic one. A tab that has a name of its own is renamed itself.
   */
  const rename = (project: WorkspaceProject, row: OpenTabRow) => {
    if (!props.canEdit) return undefined;
    const tab = project.tabs.find((item) => item.id === row.tabId);
    const pane = tab && mainPane(tab);
    if (tab && pane && isDefaultTabName(tab.name) && canRenamePanes)
      return (value: string) => {
        const name = value.trim().slice(0, 120);
        const next = name && name !== defaultPaneTitle(pane, chats) ? name : null;
        if (next === (pane.name ?? null)) return;
        props.onCommand({
          kind: "pane.rename",
          projectId: project.id,
          expectedVersion: project.version,
          tabId: row.tabId,
          paneId: pane.id,
          name: next,
        });
      };
    return (value: string) => {
      const name = value.trim().slice(0, 120);
      if (!name || name === row.title) return;
      props.onCommand({
        kind: "tab.rename",
        projectId: project.id,
        expectedVersion: project.version,
        tabId: row.tabId,
        name,
      });
    };
  };
  const { schedules } = useSchedules();
  const scheduledChats = new Set(schedules?.filter((s) => s.enabled).map((s) => s.sessionId));
  const fork = (chat: AgentInfo | undefined) =>
    props.canEdit && connection?.state.status === "ready" && canFork(chat)
      ? () =>
          void forkChat(chat).catch((error: unknown) =>
            console.error("Could not fork the chat", error),
          )
      : undefined;
  return (
    <>
      {props.workspace?.projects.length ? (
        <ul
          className="mt-1 space-y-0.5"
          onPointerEnter={() => {
            hovering.current = true;
          }}
          onPointerLeave={() => {
            hovering.current = false;
            setShownOrder((previous) => followOrder(previous, order));
          }}
        >
          {props.workspace.projects.map((project) => {
            const expanded = !props.collapsed && isExpanded(project.id);
            const ordered = stableOrder(rows.get(project.id) ?? [], shownOrder.get(project.id));
            const selectedRow = ordered.find(
              (row) => row.kind === "tab" && row.tabId === selectedTabId,
            );
            const shown = !expanded
              ? []
              : more.has(project.id)
                ? ordered
                : ordered.filter((row, index) => index < ROWS_SHOWN || row === selectedRow);
            const current = props.view === "projects" && currentProjectId === project.id;
            return (
              <Fragment key={project.id}>
                <WorkspaceSidebarItem
                  project={project}
                  parent={parents.get(project.id)}
                  compact={props.collapsed}
                  selected={current && !(selectedRow && shown.includes(selectedRow))}
                  current={current}
                  canEdit={props.canEdit}
                  icon={
                    props.workspace
                      ? icons.get(projectIconKey(props.workspace.epoch, project))
                      : undefined
                  }
                  pullRequests={
                    props.workspace
                      ? pullRequests.workspaces.get(pullRequestKey(props.workspace.epoch, project))
                      : undefined
                  }
                  onSelect={selectWorkspace}
                  onOpenPullRequests={props.onOpenPullRequests}
                  execute={props.execute}
                  onCommand={props.onCommand}
                />
                {shown.length > 0 && (
                  <li>
                    <ul aria-label={`${project.name} tabs`} className="ml-3 space-y-0.5">
                      {shown.map((row) => (
                        <SidebarTabRow
                          key={row.key}
                          row={row}
                          now={now}
                          selected={row === selectedRow && current}
                          scheduled={scheduledChats.has(rowChatId(row) ?? "")}
                          onOpen={() => {
                            // Opening a session focuses its pane, as the tab bar does;
                            // a pane that has not started yet just has its tab selected.
                            const session =
                              row.kind === "tab"
                                ? (row.chat?.id ?? row.terminal?.id)
                                : row.chat.agent.id;
                            if (session) props.onSelectAgent(session);
                            else if (row.kind === "tab")
                              props.onSelectTab(row.projectId, row.tabId);
                          }}
                          onRename={row.kind === "tab" ? rename(project, row) : undefined}
                          onFork={fork(row.kind === "tab" ? row.chat : row.chat.agent)}
                        />
                      ))}
                      {shown.length < ordered.length && (
                        <li>
                          <button
                            type="button"
                            onClick={() => setMore((previous) => new Set(previous).add(project.id))}
                            className="flex h-8 w-full items-center rounded-md pr-2 pl-9 text-left text-ui text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                          >
                            Show more
                          </button>
                        </li>
                      )}
                    </ul>
                  </li>
                )}
              </Fragment>
            );
          })}
          {!props.collapsed && <UnavailableChats chats={unavailable} now={now} />}
        </ul>
      ) : null}
    </>
  );
}

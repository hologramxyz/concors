import { SchedulesNav } from "@/schedules/nav";
import { PullRequestsNav } from "@/pull-requests/nav";
import { usePullRequests } from "@/pull-requests/use-pull-requests";
import { pullRequestKey } from "@/pull-requests/store";
import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { WorkspaceSidebarItem } from "@/workspace/sidebar-item";
import { clashingWorkspaceParents } from "@/workspace/workspace-parents";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { projectIconKey } from "@/workspace/project-icons";
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
import { BackgroundTerminalsContext } from "@/terminal/background-terminals";
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
import { SearchButton } from "@/components/search-button";
import { SidebarToggle } from "@/components/sidebar-toggle";
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
const rowChatId = (row: SidebarRow) =>
  row.kind === "tab" ? row.chat?.id : row.kind === "closed" ? row.chat.agent.id : undefined;

/** Each workspace lists this many rows before "Show more"; the selected tab is always among them. */
const ROWS_SHOWN = 5;

export function AppSidebar(props: AppSidebarProps) {
  const windowChrome = useWindowChrome();
  const trafficLights = windowChrome.inset && !windowChrome.fullscreen;
  const machineSwitcher = (
    <MachineSwitcher
      compact={false}
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
  const search = <SearchButton collapsed={false} onOpenSearch={props.onOpenSearch} tour />;
  const toggle = (
    <SidebarToggle collapsed={false} onToggle={props.onCollapse} side="bottom" className="p-1.5" />
  );

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
                  />
                }
              >
                <WorkspaceTree {...props} collapsed={false} />
                {props.workspace?.projects.length === 0 && (
                  <SidebarEmpty>No workspaces yet.</SidebarEmpty>
                )}
              </SidebarSection>
            </div>
            <PreviewsSidebar compact={false} />
          </>
        </div>
        <div className="space-y-1 p-2">
          <UpdateBadge collapsed={false} />
          <AccountMenu
            collapsed={false}
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
  const background = useContext(BackgroundTerminalsContext);
  const forkChat = useForkChat();
  const now = useMinuteClock();
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const { rows, unavailable } = sidebarRows(props.workspace, chats, terminals);
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
        const next = name && name !== defaultPaneTitle(pane, chats, terminals) ? name : null;
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
            // Rendered while collapsed too, so the list can ease open and shut.
            const listed = props.collapsed
              ? []
              : more.has(project.id)
                ? ordered
                : ordered.filter((row, index) => index < ROWS_SHOWN || row === selectedRow);
            const shown = expanded ? listed : [];
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
                {listed.length > 0 && (
                  <li className="sidebar-collapse" data-collapsed={!expanded || undefined}>
                    <div>
                      <ul aria-label={`${project.name} tabs`} className="space-y-0.5">
                        {listed.map((row) => (
                          <SidebarTabRow
                            key={row.key}
                            row={row}
                            now={now}
                            selected={row === selectedRow && current}
                            scheduled={scheduledChats.has(rowChatId(row) ?? "")}
                            onOpen={() => {
                              // A background terminal comes back into a new tab.
                              if (row.kind === "terminal") {
                                background?.reopen(row.terminal);
                                return;
                              }
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
                            onFork={
                              row.kind === "terminal"
                                ? undefined
                                : fork(row.kind === "tab" ? row.chat : row.chat.agent)
                            }
                          />
                        ))}
                        {listed.length < ordered.length && (
                          <li>
                            <button
                              type="button"
                              onClick={() =>
                                setMore((previous) => new Set(previous).add(project.id))
                              }
                              className="flex h-8 w-full items-center rounded-md pr-2 pl-[calc(1rem+20px)] text-left text-ui text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            >
                              Show more
                            </button>
                          </li>
                        )}
                      </ul>
                    </div>
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

import { SchedulesNav } from "@/schedules/nav";
import { PullRequestsNav } from "@/pull-requests/nav";
import { usePullRequests } from "@/pull-requests/use-pull-requests";
import { pullRequestKey } from "@/pull-requests/store";
import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { recentlyClosed } from "@/workspace/closed-workspaces";
import { setWorkspaceExpanded, useCollapsedWorkspaces } from "@/workspace/collapsed-workspaces";
import { WorkspaceSidebarItem } from "@/workspace/sidebar-item";
import { clashingWorkspaceParents } from "@/workspace/workspace-parents";
import { useProjectIcons } from "@/workspace/use-project-icons";
import { projectIconKey } from "@/workspace/project-icons";
import { SidebarDot, SidebarTabRow, UnavailableChats } from "@/workspace/sidebar-tabs";
import {
  foldRows,
  rowDot,
  sidebarRows,
  stableOrder,
  useMinuteClock,
  type OpenTabRow,
  type SidebarRow,
} from "@/workspace/sidebar-rows";
import { defaultPaneTitle, mainPane } from "@/workspace/tab-title";
import { useAgents } from "@/agents/context";
import { strongestDot } from "@/agents/agent-status";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { BackgroundTerminalsContext } from "@/terminal/background-terminals";
import { useClosedTerminalNames } from "@/terminal/closed-names";
import { useSchedules } from "@/schedules/use-schedules";
import {
  Fragment,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from "react";
import {
  isDefaultTabName,
  CHAT_MOVE_CAPABILITY,
  PANE_RENAME_CAPABILITY,
  PROJECT_CLOSE_CAPABILITY,
  type AgentInfo,
  type WorkspaceProject,
} from "@concors/protocol";
import { PreviewsSidebar } from "@/host/previews-sidebar";
import { SidebarEmpty, SidebarSection } from "./sidebar-section";
import { SearchButton } from "@/components/search-button";
import { ChatLimitBanner, DeleteChatDialog, type ChatToDelete } from "@/agents/chat-limit";
import { chatName, useChatActions } from "@/agents/chat-actions";
import { useChatRowActions } from "@/agents/chat-row-actions";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { cn } from "cn";
import { useWindowChrome } from "@/window/context";
import type { WorkspaceSnapshot, WorkspaceOperation } from "@concors/protocol";
import type { View } from "@/navigation";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { AccountMenu } from "@/components/account-menu";
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

/** The rows' order as `order` (JSON) gives it, keeping the same map when nothing moved. */
function followOrder(previous: ReadonlyMap<string, string[]>, order: string) {
  return JSON.stringify([...previous]) === order
    ? previous
    : new Map(JSON.parse(order) as [string, string[]][]);
}

/** The chat a row stands for, when it stands for one. */
const rowChat = (row: SidebarRow) =>
  row.kind === "tab" ? row.chat : row.kind === "closed" ? row.chat.agent : undefined;
const rowChatId = (row: SidebarRow) => rowChat(row)?.id;

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
                <WorkspaceTree {...props} collapsed={false} />
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
  // The chat stays set while its dialog closes, so it can ease out under the same name.
  const [deleting, setDeleting] = useState<{ chat: ChatToDelete; open: boolean } | null>(null);
  const now = useMinuteClock();
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const closedNames = useClosedTerminalNames();
  const rowActions = useChatRowActions({
    canEdit: props.canEdit,
    execute: props.execute,
    isSelected: (id) => {
      const selection = props.workspace?.selection;
      return !!props.workspace?.projects
        .find((project) => project.id === selection?.projectId)
        ?.tabs.find((tab) => tab.id === selection?.tabId)
        ?.nodes.some((node) => node.kind === "pane" && node.sessionId === id);
    },
    onReopenSelected: props.onSelectAgent,
  });
  const chatActions = rowActions.actions;
  const all = sidebarRows(props.workspace, chats, terminals, closedNames);
  // A chat waiting out its undo is gone from the list already.
  const rows = new Map(
    [...all.rows].map(([id, list]) => [
      id,
      list.filter((row) => !rowActions.hidden.has(rowChatId(row) ?? "")),
    ]),
  );
  const unavailable = all.unavailable.filter((chat) => !rowActions.hidden.has(chat.id));
  const currentProjectId = props.workspace?.selection?.projectId ?? null;
  const selectedTabId =
    props.view === "projects" ? (props.workspace?.selection?.tabId ?? null) : null;
  const collapsedWorkspaces = useCollapsedWorkspaces();
  const isExpanded = (id: string) => !collapsedWorkspaces.has(id);
  const selectWorkspace = (id: string) => {
    if (props.view === "projects" && id === currentProjectId) {
      setWorkspaceExpanded(id, !isExpanded(id));
      return;
    }
    // Switching to a workspace expands it, even one collapsed earlier.
    setWorkspaceExpanded(id, true);
    props.onSelectProject(id);
  };
  const [more, setMore] = useState<ReadonlySet<string>>(new Set());
  // The order rows were last shown in. It follows every change except while the pointer is over
  // the list: rows then keep their places and new ones go after them. Hovering itself changes no
  // state, so it never repaints anything; only a change that arrives meanwhile is held back. The
  // list is asked whether it is hovered rather than told by enter and leave, which a row's menu
  // (outside the list, though its events pass through it) would leave stuck on "hovered".
  const list = useRef<HTMLUListElement>(null);
  const [shownOrder, setShownOrder] = useState<ReadonlyMap<string, string[]>>(new Map());
  const order = JSON.stringify([...rows].map(([id, list]) => [id, list.map((row) => row.key)]));
  // Closed rows whose dot keeps them out of the fold, held still with the order.
  const [shownSurfaced, setShownSurfaced] = useState<ReadonlyMap<string, string[]>>(new Map());
  const surfaced = JSON.stringify(
    [...rows].map(([id, list]) => [
      id,
      list.filter((row) => row.kind !== "tab" && rowDot(row)).map((row) => row.key),
    ]),
  );
  const followRows = () => {
    setShownOrder((previous) => followOrder(previous, order));
    setShownSurfaced((previous) => followOrder(previous, surfaced));
  };
  useLayoutEffect(() => {
    if (!list.current?.matches(":hover")) followRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, surfaced]);
  const canRenamePanes =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PANE_RENAME_CAPABILITY);
  // Chats of a closed workspace come back with its folder, so they are not listed apart. Older
  // daemons remove workspaces instead, and their chats can only be listed as unavailable. Only a
  // daemon that has answered can be called older: one out of reach still has its closed workspaces.
  const removesWorkspaces =
    connection?.state.status === "ready" &&
    !connection.state.daemon.capabilities?.includes(PROJECT_CLOSE_CAPABILITY);
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
  // Every schedule, enabled or not: each is tied to its chat's workspace, so a chat with one stays.
  const hasSchedule = (id: string | undefined) => schedules?.some((s) => s.sessionId === id);
  const canMoveChats =
    props.canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(CHAT_MOVE_CAPABILITY);
  /** Sends a row's chat to another workspace: an open one with its tab, a closed one by itself. */
  const moveRow = (project: WorkspaceProject, row: SidebarRow) => {
    if (!canMoveChats) return undefined;
    if (row.kind === "closed") {
      const { agent } = row.chat;
      if (hasSchedule(agent.id) || !chatActions) return undefined;
      return (projectId: string) => {
        setWorkspaceExpanded(projectId, true);
        void chatActions
          .move(agent, projectId)
          .catch((error: unknown) => console.error("Could not move the chat", error));
      };
    }
    if (row.kind !== "tab") return undefined;
    const panes = project.tabs.find((tab) => tab.id === row.tabId)?.nodes;
    if (
      panes?.some(
        (node) =>
          node.kind === "pane" &&
          (node.profile !== "chat" || hasSchedule(node.sessionId ?? undefined)),
      )
    )
      return undefined;
    return (projectId: string) => {
      setWorkspaceExpanded(projectId, true);
      props.onCommand({
        kind: "tab.transfer",
        projectId: project.id,
        expectedVersion: project.version,
        tabId: row.tabId,
        targetProjectId: projectId,
      });
    };
  };
  // The row being dragged, and the workspace it would land in if dropped now.
  const moveTargets = (projectId: string) =>
    (props.workspace?.projects ?? [])
      .filter((project) => project.id !== projectId)
      .map(({ id, name }) => ({ id, name }));
  const [moving, setMoving] = useState<{
    projectId: string;
    move: (projectId: string) => void;
  } | null>(null);
  const [dropWorkspace, setDropWorkspace] = useState<string | null>(null);
  const endMove = () => {
    setMoving(null);
    setDropWorkspace(null);
  };
  const overWorkspace = (event: ReactDragEvent<HTMLUListElement>) => {
    if (!moving) return;
    const element = (event.target as Element).closest<HTMLElement>("[data-drop-workspace]");
    const id = element?.dataset["dropWorkspace"];
    const target = id && id !== moving.projectId ? id : null;
    setDropWorkspace(target);
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const { fork, pin } = rowActions;
  // Bound to the chat's ID and its name as shown now, never to where its row sits.
  const remove = (chat: AgentInfo | undefined) =>
    rowActions.canDelete && chat
      ? () => setDeleting({ chat: { id: chat.id, name: chatName(chat) }, open: true })
      : undefined;
  return (
    <>
      {rowActions.toast}
      <DeleteChatDialog
        key={deleting?.chat.id}
        chat={deleting?.chat ?? null}
        open={!!deleting?.open}
        canDelete={!!chatActions}
        onConfirm={(chat) => void rowActions.remove(chat)}
        onClose={(id) =>
          setDeleting((current) =>
            current?.chat.id === id ? { chat: current.chat, open: false } : current,
          )
        }
      />
      {props.workspace?.projects.length ? (
        <ul
          ref={list}
          className="mt-1 space-y-0.5"
          onPointerLeave={followRows}
          // Both: the browser sends an "over" only once the pointer rests on one element.
          onDragEnter={overWorkspace}
          onDragOver={overWorkspace}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDropWorkspace(null);
          }}
          onDrop={(event) => {
            if (!moving || !dropWorkspace) return;
            event.preventDefault();
            moving.move(dropWorkspace);
            endMove();
          }}
        >
          {props.workspace.projects.map((project) => {
            const expanded = !props.collapsed && isExpanded(project.id);
            const ordered = stableOrder(rows.get(project.id) ?? [], shownOrder.get(project.id));
            const selectedRow = ordered.find(
              (row) => row.kind === "tab" && row.tabId === selectedTabId,
            );
            const fold = more.has(project.id)
              ? { listed: ordered, folded: [] }
              : foldRows(ordered, new Set(shownSurfaced.get(project.id)));
            // Rendered while collapsed too, so the list can ease open and shut.
            const listed = props.collapsed ? [] : fold.listed;
            const foldedDot = strongestDot(fold.folded.map(rowDot));
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
                  expanded={expanded}
                  canEdit={props.canEdit}
                  dropTarget={dropWorkspace === project.id}
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
                  onToggleExpanded={() => setWorkspaceExpanded(project.id, !expanded)}
                  onOpenPullRequests={props.onOpenPullRequests}
                  execute={props.execute}
                  onCommand={props.onCommand}
                />
                {listed.length > 0 && (
                  <li
                    data-drop-workspace={project.id}
                    className="sidebar-collapse"
                    data-collapsed={!expanded || undefined}
                  >
                    <div>
                      <ul aria-label={`${project.name} tabs`} className="space-y-0.5">
                        {listed.map((row) => {
                          const move = moveRow(project, row);
                          return (
                            <SidebarTabRow
                              key={row.key}
                              row={row}
                              moveTargets={moveTargets(project.id)}
                              onMove={move}
                              onMoveDragStart={
                                move ? () => setMoving({ projectId: project.id, move }) : undefined
                              }
                              onMoveDragEnd={endMove}
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
                              onPin={pin(rowChat(row))}
                              onDelete={remove(rowChat(row))}
                            />
                          );
                        })}
                        {fold.folded.length > 0 && (
                          <li>
                            <button
                              type="button"
                              onClick={() =>
                                setMore((previous) => new Set(previous).add(project.id))
                              }
                              className="flex h-8 w-full items-center gap-2 rounded-md pr-2 pl-2 text-left text-ui text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                            >
                              <span
                                data-show-more-dot={foldedDot}
                                className="flex size-[20px] shrink-0 items-center justify-center"
                              >
                                {foldedDot && <SidebarDot dot={foldedDot} />}
                              </span>
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
          {!props.collapsed && removesWorkspaces && (
            <UnavailableChats chats={unavailable} now={now} />
          )}
        </ul>
      ) : null}
    </>
  );
}

/** The near-limit line, apart from the sidebar so chat updates repaint only it. */
function SidebarChatLimit({ workspace, execute }: Pick<AppSidebarProps, "workspace" | "execute">) {
  const chats = useAgents();
  const actions = useChatActions(execute);
  return <ChatLimitBanner workspace={workspace} chats={chats} actions={actions} />;
}

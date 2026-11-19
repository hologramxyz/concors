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
  PANE_TRANSFER_WORKSPACE_CAPABILITY,
  SCHEDULE_FOLLOWS_CHAT_CAPABILITY,
  PROJECT_CLOSE_CAPABILITY,
  type AgentInfo,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { usePullRequests } from "@/pull-requests/use-pull-requests";
import { pullRequestKey } from "@/pull-requests/store";
import { useAgents } from "@/agents/context";
import { strongestDot } from "@/agents/agent-status";
import { DeleteChatDialog, type ChatToDelete } from "@/agents/chat-limit";
import { chatName } from "@/agents/chat-actions";
import { useChatRowActions } from "@/agents/chat-row-actions";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { BackgroundTerminalsContext } from "@/terminal/background-terminals";
import { useClosedTerminalNames } from "@/terminal/closed-names";
import { useSchedules } from "@/schedules/use-schedules";
import { setWorkspaceExpanded, useCollapsedWorkspaces } from "./collapsed-workspaces";
import { setClosedChatsOpen, useOpenClosedChats } from "./open-closed-chats";
import { WorkspaceSidebarItem } from "./sidebar-item";
import { clashingWorkspaceParents } from "./workspace-parents";
import { useProjectIcons } from "./use-project-icons";
import { projectIconKey } from "./project-icons";
import { ChevronRight } from "lucide-react";
import { SidebarDot, SidebarTabRow, UnavailableChats } from "./sidebar-tabs";
import {
  foldRows,
  rowDot,
  sidebarRows,
  surfacesRow,
  stableOrder,
  useMinuteClock,
  type OpenTabRow,
  type SidebarRow,
} from "./sidebar-rows";
import { defaultPaneTitle, mainPane } from "./tab-title";
import { paneTransfer } from "./pane-transfer";

export interface WorkspaceTreeProps {
  workspace: WorkspaceSnapshot | null;
  canEdit: boolean;
  /** The sidebar's rail: workspace icons only. */
  collapsed: boolean;
  /** The workspace and tab on screen; null while a page such as Schedules covers them. */
  selection: { projectId: string | null; tabId: string | null } | null;
  onSelectAgent: (id: string) => void;
  /** Switches to one tab of a workspace, as clicking it in that workspace's tab bar does. */
  onSelectTab: (projectId: string, tabId: string) => void;
  onSelectProject: (id: string) => void;
  onOpenPullRequests: (projectId?: string, repository?: string) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  /** Like `execute`, but a failure is shown to the user. */
  onCommand: (operation: WorkspaceOperation) => void;
  /**
   * What choosing a workspace row does. Desktop switches to it, or folds it when it is the one on
   * screen; "toggle" only folds it, for a phone, whose tabs open from their own rows.
   */
  workspaceTap?: "select" | "toggle";
  /** Starts a tab in a workspace from its row's menu, which only a phone offers. */
  onNewTab?: ((projectId: string) => void) | undefined;
  /**
   * Chat row actions shared with the app's other menus, so one undo and one toast serve them all;
   * without them the tree keeps its own.
   */
  rowActions?: ReturnType<typeof useChatRowActions> | undefined;
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

/**
 * The workspaces and their tabs. Its state lives here, not in the sidebar, so hovering the list
 * (which freezes its order) repaints only the list and not the controls and tooltips around it.
 */
export function WorkspaceTree(props: WorkspaceTreeProps) {
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
  const ownRowActions = useChatRowActions({
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
  const rowActions = props.rowActions ?? ownRowActions;
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
  const currentProjectId = props.selection?.projectId ?? null;
  const selectedTabId = props.selection?.tabId ?? null;
  const collapsedWorkspaces = useCollapsedWorkspaces();
  const isExpanded = (id: string) => !collapsedWorkspaces.has(id);
  const selectWorkspace = (id: string) => {
    if (props.workspaceTap === "toggle" || id === currentProjectId) {
      setWorkspaceExpanded(id, !isExpanded(id));
      return;
    }
    // Switching to a workspace expands it, even one collapsed earlier.
    setWorkspaceExpanded(id, true);
    props.onSelectProject(id);
  };
  const openClosedChats = useOpenClosedChats();
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
    [...rows].map(([id, list]) => [id, list.filter(surfacesRow).map((row) => row.key)]),
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
  const acrossWorkspaces =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PANE_TRANSFER_WORKSPACE_CAPABILITY);
  // Newer daemons move a chat's schedules with it; older ones would leave them behind.
  const schedulesFollow =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(SCHEDULE_FOLLOWS_CHAT_CAPABILITY);
  const staysForSchedule = (id: string | null | undefined) =>
    !schedulesFollow && !!hasSchedule(id ?? undefined);
  /** Sends a row's chat to another workspace: an open one with its tab, a closed one by itself. */
  const moveRow = (project: WorkspaceProject, row: SidebarRow) => {
    if (!canMoveChats) return undefined;
    if (row.kind === "closed") {
      const { agent } = row.chat;
      if (staysForSchedule(agent.id) || !chatActions) return undefined;
      return (projectId: string) => {
        setWorkspaceExpanded(projectId, true);
        void chatActions
          .move(agent, projectId)
          .catch((error: unknown) => console.error("Could not move the chat", error));
      };
    }
    if (row.kind !== "tab") return undefined;
    const tab = project.tabs.find((item) => item.id === row.tabId);
    if (!tab) return undefined;
    const panes = tab.nodes.filter((node) => node.kind === "pane");
    // A tab holding a terminal cannot leave its workspace, but the chat it is named after can,
    // into a tab of its own there; the terminal stays.
    if (panes.some((node) => node.profile !== "chat" || staysForSchedule(node.sessionId))) {
      const main = mainPane(tab);
      if (main?.profile !== "chat" || staysForSchedule(main.sessionId)) return undefined;
      return (projectId: string) => {
        const move = paneTransfer(
          { project, tab, pane: main },
          { projectId },
          {
            acrossWorkspaces,
            scheduled: false,
            ids: { splitId: crypto.randomUUID(), tabId: crypto.randomUUID() },
          },
        );
        if (!move) return;
        setWorkspaceExpanded(projectId, true);
        props.onCommand(move);
      };
    }
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
  /**
   * Puts a row's chat into another tab, of its workspace or another, beside that tab's panes. Only
   * a tab holding one chat can: dropping a split on a tab would have to merge two layouts.
   */
  const joinRow = (project: WorkspaceProject, row: SidebarRow) => {
    if (!props.canEdit || row.kind !== "tab") return undefined;
    const tab = project.tabs.find((item) => item.id === row.tabId);
    const pane = tab?.nodes.length === 1 ? tab.nodes[0] : undefined;
    // Chats only: a terminal's row stays put, as it cannot leave its workspace either.
    if (!tab || pane?.kind !== "pane" || pane.profile !== "chat") return undefined;
    return (target: { projectId: string; tabId: string }) => {
      const move = paneTransfer({ project, tab, pane }, target, {
        acrossWorkspaces,
        scheduled: staysForSchedule(pane.sessionId),
        ids: { splitId: crypto.randomUUID(), tabId: crypto.randomUUID() },
      });
      if (!move) return false;
      setWorkspaceExpanded(target.projectId, true);
      props.onCommand(move);
      return true;
    };
  };
  // The row being dragged, and the workspace it would land in if dropped now.
  const moveTargets = (projectId: string) =>
    (props.workspace?.projects ?? [])
      .filter((project) => project.id !== projectId)
      .map(({ id, name }) => ({ id, name }));
  const [moving, setMoving] = useState<{
    projectId: string;
    tabId: string | undefined;
    move: ((projectId: string) => void) | undefined;
    join: ((target: { projectId: string; tabId: string }) => boolean) | undefined;
  } | null>(null);
  const [dropWorkspace, setDropWorkspace] = useState<string | null>(null);
  // A tab row the dragged row would join instead; highlighted directly, like the pane drag does.
  const dropTab = useRef<{ element: HTMLElement; projectId: string; tabId: string } | null>(null);
  const setDropTab = (next: typeof dropTab.current) => {
    if (next?.element === dropTab.current?.element) return;
    dropTab.current?.element.removeAttribute("data-drop-target");
    next?.element.setAttribute("data-drop-target", "");
    dropTab.current = next;
  };
  const endMove = () => {
    setMoving(null);
    setDropWorkspace(null);
    setDropTab(null);
  };
  const overWorkspace = (event: ReactDragEvent<HTMLUListElement>) => {
    if (!moving) return;
    const row = (event.target as Element).closest<HTMLElement>("[data-drop-tab]");
    const rowTab = row?.dataset["dropTab"];
    const rowProject = row?.closest<HTMLElement>("[data-drop-workspace]")?.dataset["dropWorkspace"];
    if (moving.join && row && rowTab && rowProject && rowTab !== moving.tabId) {
      setDropTab({ element: row, projectId: rowProject, tabId: rowTab });
      setDropWorkspace(null);
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      return;
    }
    setDropTab(null);
    if (!moving.move) return;
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
      {!props.rowActions && rowActions.toast}
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
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropWorkspace(null);
              setDropTab(null);
            }
          }}
          onDrop={(event) => {
            const tab = dropTab.current;
            if (moving?.join && tab) {
              event.preventDefault();
              moving.join(tab);
            } else if (moving?.move && dropWorkspace) {
              event.preventDefault();
              moving.move(dropWorkspace);
            }
            endMove();
          }}
        >
          {props.workspace.projects.map((project) => {
            const expanded = !props.collapsed && isExpanded(project.id);
            const ordered = stableOrder(rows.get(project.id) ?? [], shownOrder.get(project.id));
            const selectedRow = ordered.find(
              (row) => row.kind === "tab" && row.tabId === selectedTabId,
            );
            const fold = foldRows(ordered, new Set(shownSurfaced.get(project.id)));
            const closedOpen = openClosedChats.has(project.id);
            // Rendered while collapsed too, so the list can ease open and shut.
            const listed = props.collapsed ? [] : fold.listed;
            const folded = props.collapsed ? [] : fold.folded;
            const foldedDot = strongestDot(fold.folded.map(rowDot));
            const shown = expanded ? [...listed, ...(closedOpen ? folded : [])] : [];
            const current = currentProjectId === project.id;
            const renderRow = (row: SidebarRow) => {
              const move = moveRow(project, row);
              const join = joinRow(project, row);
              return (
                <SidebarTabRow
                  key={row.key}
                  row={row}
                  moveTargets={moveTargets(project.id)}
                  onMove={move}
                  draggable={!!move || !!join}
                  onMoveDragStart={
                    move || join
                      ? () =>
                          setMoving({
                            projectId: project.id,
                            tabId: row.kind === "tab" ? row.tabId : undefined,
                            move,
                            join,
                          })
                      : undefined
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
                      row.kind === "tab" ? (row.chat?.id ?? row.terminal?.id) : row.chat.agent.id;
                    if (session) props.onSelectAgent(session);
                    else if (row.kind === "tab") props.onSelectTab(row.projectId, row.tabId);
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
            };
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
                  toggles={props.workspaceTap === "toggle"}
                  onNewTab={props.onNewTab}
                  onToggleExpanded={() => setWorkspaceExpanded(project.id, !expanded)}
                  onOpenPullRequests={props.onOpenPullRequests}
                  execute={props.execute}
                  onCommand={props.onCommand}
                />
                {listed.length + folded.length > 0 && (
                  <li
                    data-drop-workspace={project.id}
                    className="sidebar-collapse"
                    data-collapsed={!expanded || undefined}
                  >
                    <div>
                      <ul aria-label={`${project.name} tabs`} className="space-y-0.5">
                        {listed.map(renderRow)}
                        {folded.length > 0 && (
                          // Closed chats, apart and folded: they are history, not work in hand.
                          <li>
                            <button
                              type="button"
                              aria-expanded={closedOpen}
                              onClick={() => setClosedChatsOpen(project.id, !closedOpen)}
                              className="flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                            >
                              <span
                                data-show-more-dot={closedOpen ? undefined : foldedDot}
                                className="flex size-[20px] shrink-0 items-center justify-center"
                              >
                                {!closedOpen && foldedDot ? (
                                  <SidebarDot dot={foldedDot} />
                                ) : (
                                  <ChevronRight
                                    aria-hidden="true"
                                    className={`size-3.5 transition-transform motion-reduce:transition-none ${closedOpen ? "rotate-90" : ""}`}
                                  />
                                )}
                              </span>
                              <span className="flex-1">Closed chats</span>
                              <span className="tabular-nums">{folded.length}</span>
                            </button>
                            {closedOpen && (
                              <ul
                                aria-label={`${project.name} closed chats`}
                                className="mt-0.5 ml-[17px] space-y-0.5 border-l border-sidebar-border pl-1"
                              >
                                {folded.map(renderRow)}
                              </ul>
                            )}
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

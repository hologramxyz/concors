import { ProjectFileLinks } from "@/files/provider";
import { neighborPane, type Direction } from "./pane-navigation";
import { useTabVisible } from "./tab-visibility";
import { clampRatio, splitRatio } from "./split-ratio";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { paneProfiles, TAB_PROFILES } from "./tab-profiles";
import { StartOptions } from "./start-options";
import { useCommand } from "@/shortcuts/context";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { MenuKeyChips } from "@/shortcuts/key-chips";
import type { PaneFocusRequest } from "./session-pane";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ChatPane } from "@/agents/chat";
import { TerminalPane } from "@/terminal/terminal-pane";
import {
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AgentPaneIcon, AgentStatusIcon } from "@/agents/activity";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { isLiveTerminalAgent, terminalAgentStatus } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { Columns2, Rows2, Ellipsis, Pencil, Plug, Terminal, X } from "lucide-react";
import { McpStatusDialog } from "@/agents/mcp-status-dialog";
import {
  PANE_RENAME_CAPABILITY,
  type LayoutNode,
  type WorkspaceOperation,
  type WorkspaceProject,
  type WorkspaceTab,
} from "@concors/protocol";
import { forgetFocusedPane, publishFocusedPane } from "./focused-panes";
import {
  paneDropTargetAt,
  paneLandingArea,
  paneMoveOperation,
  type PaneArea,
  type PaneDropTarget,
} from "./pane-drop";
import { typingOutsidePanes } from "./typing-outside-panes";
import { defaultPaneTitle, PROFILE_LABELS } from "./tab-title";

interface Props {
  focusRequest?: PaneFocusRequest | null;
  onPaneFocus?: ((paneId: string) => void) | undefined;
  tab: WorkspaceTab;
  project: WorkspaceProject;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
}

/** Overlays that keep focus while pane focus waits; a closing menu or dialog no longer does. */
const OPEN_OVERLAY =
  '[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"][data-state="open"]';
// Queue editing and pending-input forms can also contain textareas; navigation targets the prompt.
const PANE_INPUT =
  "textarea.agent-composer-input:not(:disabled), textarea.xterm-helper-textarea:not(:disabled)";
/** How far a press on a pane header travels before it is a drag and no longer a click. */
const DRAG_THRESHOLD = 4;

export function PaneLayout(props: Props) {
  const visible = useTabVisible();
  const [draggedPaneId, setDraggedPaneId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ target: PaneDropTarget; area: PaneArea } | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const navigationFocus = useRef<MutationObserver | null>(null);
  useEffect(() => {
    if (!visible) navigationFocus.current?.disconnect();
    return () => navigationFocus.current?.disconnect();
  }, [visible]);
  // A drag must not outlive its pane or tab, or the whole app keeps the grabbing cursor.
  const paneCount = props.tab.nodes.filter((node) => node.kind === "pane").length;
  const draggedPaneExists = props.tab.nodes.some((node) => node.id === draggedPaneId);
  useEffect(() => {
    if (!visible || paneCount < 2 || !draggedPaneExists) stopDrag.current?.();
  }, [visible, paneCount, draggedPaneExists]);
  useEffect(() => () => stopDrag.current?.(), []);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const activePane =
    props.tab.nodes.find((node) => node.kind === "pane" && node.id === activePaneId) ??
    props.tab.nodes.find((node) => node.kind === "pane");
  const focusedPaneId = activePane?.id;
  useEffect(() => {
    if (!focusedPaneId) return;
    publishFocusedPane(props.tab.id, focusedPaneId);
    return () => forgetFocusedPane(props.tab.id);
  }, [props.tab.id, focusedPaneId]);
  const split = (axis: "horizontal" | "vertical", before = false) => {
    if (!activePane || activePane.kind !== "pane") return;
    const newPaneId = crypto.randomUUID();
    pendingFocus.current = newPaneId;
    props.onCommand({
      kind: "pane.split",
      projectId: props.project.id,
      expectedVersion: props.project.version,
      tabId: props.tab.id,
      paneId: activePane.id,
      splitId: crypto.randomUUID(),
      newPaneId,
      axis,
      before,
      profile: activePane.profile,
    });
  };
  useEffect(() => {
    if (!visible) return;
    const requested = pendingFocus.current;
    const targetId =
      requested && props.tab.nodes.some((node) => node.id === requested)
        ? requested
        : activePaneId && !props.tab.nodes.some((node) => node.id === activePaneId)
          ? activePane?.id
          : null;
    if (!targetId) return;
    const pane = container.current?.querySelector<HTMLElement>(`[data-pane-id="${targetId}"]`);
    if (!pane) return;
    // Marks where focus is going while this pane's input is still arriving. A split remounts the
    // sibling terminal, and when it re-claims its session it would otherwise take focus in the
    // moment no pane has it, after which this pane would see another pane focused and give up.
    pane.dataset.focusPending = "";
    let initial = true;
    // Focus that moves to another pane meanwhile was asked for, by a click or by a dialog giving it
    // back, so it is kept even before this pane has had its first try.
    const started = document.activeElement;
    const settle = () => {
      pendingFocus.current = null;
      delete pane.dataset.focusPending;
      observer.disconnect();
    };
    const focus = () => {
      const focused = document.activeElement;
      if (focused?.closest(OPEN_OVERLAY)) return;
      if (typingOutsidePanes(focused)) {
        settle();
        return;
      }
      const focusedPane = focused?.closest<HTMLElement>("[data-pane-id]");
      if (
        (!initial || focused !== started) &&
        focusedPane &&
        focusedPane !== pane &&
        focusedPane.getClientRects().length
      ) {
        settle();
        return;
      }
      const input = pane.querySelector<HTMLTextAreaElement>(PANE_INPUT);
      (input ?? pane).focus({ preventScroll: true });
      initial = false;
      if (input) settle();
    };
    // A newly split Agent pane receives its usable composer after the workspace update.
    const observer = new MutationObserver(focus);
    observer.observe(pane, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    const frame = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      delete pane.dataset.focusPending;
    };
  }, [props.tab.nodes, activePaneId, activePane?.id, visible]);
  const connection = useContext(TerminalConnectionContext);
  const canSplitBefore = !!(
    connection?.state.status === "ready" ? connection.state.daemon : null
  )?.capabilities?.includes("directional-pane-split");
  const focusNeighbor = (direction: Direction) => {
    navigationFocus.current?.disconnect();
    pendingFocus.current = null;
    const panes = [...(container.current?.querySelectorAll<HTMLElement>("[data-pane-id]") ?? [])];
    const current =
      panes.find((pane) => pane.contains(document.activeElement))?.dataset.paneId ?? activePane?.id;
    if (!current) return;
    const next = neighborPane(
      panes.map((pane) => {
        const rect = pane.getBoundingClientRect();
        return {
          id: pane.dataset.paneId ?? "",
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        };
      }),
      current,
      direction,
    );
    const pane = panes.find((pane) => pane.dataset.paneId === (next ?? current));
    // Focus the input immediately; both terminal and Agent inputs allow pane shortcuts.
    const input = pane?.querySelector<HTMLElement>(PANE_INPUT);
    // A connecting agent may not have an enabled input yet. Complete navigation when it arrives.
    (input ?? pane)?.focus({ preventScroll: true });
    if (input || !pane) return;
    const observer = new MutationObserver(() => {
      if (!pane.contains(document.activeElement)) {
        observer.disconnect();
        return;
      }
      const input = pane.querySelector<HTMLElement>(PANE_INPUT);
      if (input) {
        input.focus({ preventScroll: true });
        observer.disconnect();
      }
    });
    observer.observe(pane, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    navigationFocus.current = observer;
  };
  useCommand("focus-left", visible && !!activePane, () => focusNeighbor("left"));
  useCommand("focus-right", visible && !!activePane, () => focusNeighbor("right"));
  useCommand("focus-up", visible && !!activePane, () => focusNeighbor("up"));
  useCommand("focus-down", visible && !!activePane, () => focusNeighbor("down"));
  const canSplit = props.canEdit && !!activePane && props.tab.nodes.length < 63;
  useCommand("split-left", canSplit && canSplitBefore, () => split("horizontal", true));
  useCommand("split-up", canSplit && canSplitBefore, () => split("vertical", true));
  useCommand("new-pane", canSplit, () => split("horizontal"));
  useCommand("split-horizontal", canSplit, () => split("horizontal"));
  useCommand("split-vertical", canSplit, () => split("vertical"));
  useCommand("close-pane", props.canEdit && !!activePane, () => {
    if (activePane)
      props.onCommand({
        kind: "pane.close",
        projectId: props.project.id,
        expectedVersion: props.project.version,
        tabId: props.tab.id,
        paneId: activePane.id,
      });
  });
  const rememberPane = (event: React.SyntheticEvent) => {
    if (event.target instanceof Element) {
      const id = event.target.closest("[data-pane-id]")?.getAttribute("data-pane-id");
      if (id) {
        setActivePaneId(id);
        props.onPaneFocus?.(id);
      }
    }
  };

  useEffect(() => {
    const target = props.focusRequest;
    if (!target || target.projectId !== props.project.id || target.tabId !== props.tab.id) return;
    const root = container.current;
    if (!root) return;
    let initial = true;
    // As above: focus moved to another pane meanwhile was asked for, and is kept.
    const started = document.activeElement;
    const focus = () => {
      const pane = container.current?.querySelector<HTMLElement>(
        `[data-pane-id="${target.paneId}"]`,
      );
      const input = pane?.querySelector<HTMLTextAreaElement>(PANE_INPUT);
      const focused = document.activeElement;
      const focusedPane = focused?.closest<HTMLElement>("[data-pane-id]");
      // Only an open menu or dialog keeps focus. The New tab menu is still playing its exit
      // animation when a quick agent's composer arrives; waiting for it then never saw the input
      // again, and a later change in the pane moved focus from whatever had it to the pane.
      if (focused?.closest(OPEN_OVERLAY)) return;
      if (
        typingOutsidePanes(focused) ||
        ((!initial || focused !== started) &&
          focusedPane &&
          focusedPane !== pane &&
          focusedPane.getClientRects().length)
      ) {
        observer.disconnect();
        return;
      }
      (input ?? pane)?.focus({ preventScroll: true });
      initial = false;
      if (input) observer.disconnect();
    };
    // The first Agent composer can arrive after the navigation frame. Complete
    // that focus request when its input is mounted/enabled, instead of losing it.
    const observer = new MutationObserver(focus);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    const frame = requestAnimationFrame(focus);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [props.focusRequest, props.project.id, props.tab.id]);
  const nodes = new Map(props.tab.nodes.map((node) => [node.id, node]));
  const render = (id: string): React.ReactNode => {
    const node = nodes.get(id);
    if (!node) return null;
    if (node.kind === "split")
      return (
        <Split
          key={id}
          node={node}
          canEdit={props.canEdit}
          onResize={(ratio) =>
            props.onCommand({
              kind: "pane.resize",
              projectId: props.project.id,
              expectedVersion: props.project.version,
              tabId: props.tab.id,
              splitId: id,
              ratio,
            })
          }
          first={render(node.first)}
          second={render(node.second)}
        />
      );
    return (
      <Pane
        key={id}
        {...props}
        node={node}
        dragged={draggedPaneId === id}
        onHeaderPress={(event) => startDrag(event, id)}
      />
    );
  };
  // Pointer events, not HTML drag and drop: a native drag ignores CSS, so it could never show the
  // grabbing cursor. Listening on the window sees a quick flick that leaves the header before the
  // threshold; capture starts only past it, because a captured press loses the title's double-click.
  const startDrag = (event: ReactPointerEvent<HTMLElement>, paneId: string) => {
    if (event.pointerType === "touch" || event.button !== 0) return;
    stopDrag.current?.();
    const header = event.currentTarget;
    const { pointerId, clientX: startX, clientY: startY } = event;
    const { project, tab, onCommand } = props;
    let started = false;
    let target: PaneDropTarget | null = null;
    // Generated once, so measuring where a pane lands and moving it are the same operation.
    const splitId = crypto.randomUUID();
    const operationFor = (dropTarget: PaneDropTarget) =>
      paneMoveOperation(project, tab, paneId, dropTarget, splitId);
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        header.setPointerCapture(pointerId);
        document.documentElement.dataset["paneDragging"] = "";
        setDraggedPaneId(paneId);
      }
      const workspace = container.current;
      if (!workspace) return;
      const panes = tab.nodes.flatMap((node) => {
        const element =
          node.kind === "pane" && workspace.querySelector(`[data-pane-id="${node.id}"]`);
        return element ? [{ id: node.id, rect: element.getBoundingClientRect() }] : [];
      });
      const next = paneDropTargetAt(
        moved.clientX,
        moved.clientY,
        workspace.getBoundingClientRect(),
        panes,
        paneId,
      );
      // Pointer moves far outnumber changes of target, and each repaint lays out every pane.
      if (JSON.stringify(next) === JSON.stringify(target)) return;
      const operation = next && operationFor(next);
      const area = operation && paneLandingArea(project, tab, operation);
      target = area ? next : null;
      setDrop(target && area ? { target, area } : null);
    };
    const release = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      const operation = target && operationFor(target);
      stop();
      if (operation) onCommand(operation);
    };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !started) return;
      // The focused terminal or composer would otherwise take this Escape too.
      pressed.preventDefault();
      pressed.stopPropagation();
      stop();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", stop);
      if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId);
      delete document.documentElement.dataset["paneDragging"];
      stopDrag.current = null;
      setDraggedPaneId(null);
      setDrop(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("keydown", key, true);
    window.addEventListener("blur", stop);
    stopDrag.current = stop;
  };
  return (
    <div
      ref={container}
      onFocusCapture={rememberPane}
      onPointerDownCapture={rememberPane}
      data-testid="pane-workspace"
      className="relative h-full min-h-[220px] min-w-[320px]"
    >
      {render(props.tab.root)}
      {draggedPaneId && drop && (
        <div
          aria-hidden="true"
          data-testid="pane-drop-preview"
          data-scope={drop.target.scope}
          data-placement={drop.target.placement}
          data-target-pane={drop.target.scope === "pane" ? drop.target.paneId : undefined}
          className="pointer-events-none absolute z-30 rounded-md border border-(--link) bg-(--link)/10"
          style={{
            left: `calc(${drop.area.left * 100}% + 0.25rem)`,
            top: `calc(${drop.area.top * 100}% + 0.25rem)`,
            width: `calc(${drop.area.width * 100}% - 0.5rem)`,
            height: `calc(${drop.area.height * 100}% - 0.5rem)`,
          }}
        />
      )}
    </div>
  );
}

function Pane({
  node,
  tab,
  project,
  canEdit,
  onCommand,
  dragged,
  onHeaderPress,
}: Props & {
  node: Extract<LayoutNode, { kind: "pane" }>;
  dragged: boolean;
  onHeaderPress: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const canDrag =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes("workspace-pane-rearrangement");
  const canRename =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(PANE_RENAME_CAPABILITY);
  // Mirrors the tab rename: the ref stops blur after Enter/Escape from committing a second time.
  const [renaming, setRenaming] = useState<string | null>(null);
  const movable = canDrag && tab.nodes.length > 1 && renaming === null;
  const renameRef = useRef<string | null>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const setRename = (value: string | null) => {
    renameRef.current = value;
    setRenaming(value);
  };
  // The menu goes with its tab. Opened on the shown tab while a new one launches (when every item
  // is disabled), it otherwise outlived the switch: still disabled, for a pane nobody could see,
  // and with its anchor hidden it jumped to the window's corner.
  const tabVisible = useTabVisible();
  const [menuOpen, setMenuOpen] = useState(false);
  if (menuOpen && !tabVisible) setMenuOpen(false);
  const agent = useAgents().find((agent) => agent.id === node.sessionId);
  const terminal = useTerminalSessions().find((session) => session.id === node.sessionId);
  const terminalAgent =
    node.profile !== "chat" && terminal && isLiveTerminalAgent(terminal) ? terminal : null;
  const [mcpOpen, setMcpOpen] = useState(false);
  const profiles = useTerminalProfiles();
  const options = paneProfiles(profiles.profiles);
  const PaneIcon =
    TAB_PROFILES.find((item) => item.profile === (node.terminalProfile?.id ?? node.profile))
      ?.icon ?? Terminal;
  const label = node.terminalProfile?.name ?? PROFILE_LABELS[node.profile];
  const fallbackTitle = defaultPaneTitle(node, agent ? [agent] : [], terminal ? [terminal] : []);
  const title = node.name ?? fallbackTitle;
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: node.id,
  };
  const startRename = () => {
    if (canRename) setRename(title);
  };
  const commitRename = () => {
    const value = renameRef.current;
    if (value === null) return;
    setRename(null);
    // Clearing the field, or typing the default back, returns to the automatic title.
    const name = value.trim().slice(0, 120);
    const next = name && name !== fallbackTitle ? name : null;
    if (next !== (node.name ?? null)) onCommand({ kind: "pane.rename", ...target, name: next });
  };
  return (
    <section
      data-pane-id={node.id}
      tabIndex={-1}
      aria-label={`${label} pane`}
      className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden outline-none ${dragged ? "opacity-60" : ""} ${node.profile === "chat" ? "bg-background" : "bg-[var(--terminal-background)] text-[var(--terminal-foreground)]"}`}
    >
      <header
        tabIndex={0}
        onPointerDown={(event) => {
          if (movable && !(event.target as HTMLElement).closest("button, input"))
            onHeaderPress(event);
        }}
        className={`flex h-9 shrink-0 items-center gap-1 px-2 outline-none ${movable ? "cursor-grab select-none active:cursor-grabbing" : ""}`}
      >
        {node.profile === "chat" ? (
          <AgentPaneIcon sessionId={node.sessionId} />
        ) : terminalAgent ? (
          // An agent CLI in a terminal is marked as its tab marks it.
          <span className="mx-1 flex shrink-0">
            <AgentStatusIcon
              agent={terminalAgentStatus(terminalAgent)}
              surface="bg-[var(--terminal-background)] ring-[var(--terminal-background)]"
            />
          </span>
        ) : (
          <PaneIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        {renaming !== null ? (
          <input
            ref={renameInput}
            aria-label="Pane name"
            autoFocus
            value={renaming}
            maxLength={120}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setRename(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              // Keep Enter, Escape and pane shortcuts away from the pane's own handlers.
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRename(null);
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 rounded bg-background px-1.5 py-0.5 text-ui text-foreground ring-1 ring-ring outline-none"
          />
        ) : (
          <span
            className="min-w-0 flex-1 truncate text-ui"
            title={canRename ? `${title}. Double-click to rename.` : title}
            onDoubleClick={startRename}
          >
            {title}
          </span>
        )}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <SidebarTooltip place="title-bar" hidden={menuOpen} content="Pane options">
            <DropdownMenuTrigger
              aria-label="Pane actions"
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Ellipsis className="size-4" />
            </DropdownMenuTrigger>
          </SidebarTooltip>
          <DropdownMenuContent
            align="end"
            className="w-max max-w-[calc(100vw-16px)] min-w-[280px]"
            onCloseAutoFocus={(event) => {
              // The menu's focus trap outlives the input's autoFocus, so hand focus over here
              // instead of returning it to the trigger.
              if (renameRef.current === null) return;
              event.preventDefault();
              renameInput.current?.focus();
            }}
          >
            <DropdownMenuItem disabled={!canRename} onSelect={startRename}>
              <Pencil /> <span className="whitespace-nowrap">Rename pane</span>
            </DropdownMenuItem>
            {agent?.controls?.mcpStatus && (
              <DropdownMenuItem onSelect={() => setMcpOpen(true)}>
                <Plug /> <span className="whitespace-nowrap">MCP servers…</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!canEdit || tab.nodes.length >= 63}
              onSelect={() =>
                onCommand({
                  kind: "pane.split",
                  ...target,
                  splitId: crypto.randomUUID(),
                  newPaneId: crypto.randomUUID(),
                  axis: "horizontal",
                  profile: node.profile,
                })
              }
            >
              <Columns2 /> <span className="whitespace-nowrap">Split horizontally</span>
              <MenuKeyChips id="split-horizontal" />
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!canEdit || tab.nodes.length >= 63}
              onSelect={() =>
                onCommand({
                  kind: "pane.split",
                  ...target,
                  splitId: crypto.randomUUID(),
                  newPaneId: crypto.randomUUID(),
                  axis: "vertical",
                  profile: node.profile,
                })
              }
            >
              <Rows2 /> <span className="whitespace-nowrap">Split vertically</span>
              <MenuKeyChips id="split-vertical" />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Pane profile</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={node.terminalProfile?.id ?? node.profile}
              onValueChange={(id) => {
                const option = options.find((item) => item.id === id);
                if (option)
                  onCommand({
                    kind: "pane.configure",
                    ...target,
                    profile: option.profile,
                    ...(profiles.supported && option.terminalProfileId
                      ? { terminalProfileId: option.terminalProfileId }
                      : {}),
                  });
              }}
            >
              {options.map(({ id, profile, label: optionLabel, icon: Icon }) => (
                <Fragment key={id}>
                  <DropdownMenuRadioItem value={id} disabled={!canEdit}>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{optionLabel}</span>
                  </DropdownMenuRadioItem>
                  {profile === "chat" && <DropdownMenuSeparator />}
                </Fragment>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {agent && mcpOpen && (
          <McpStatusDialog agent={agent} open={mcpOpen} onOpenChange={setMcpOpen} />
        )}
        <SidebarTooltip place="title-bar" content="Close pane" shortcut="close-pane">
          <button
            type="button"
            aria-label="Close pane"
            disabled={!canEdit}
            onClick={() => onCommand({ kind: "pane.close", ...target })}
            className="rounded p-1 hover:bg-muted disabled:opacity-40"
          >
            <X className="size-4" />
          </button>
        </SidebarTooltip>
      </header>
      {node.profile !== "chat" ? (
        <TerminalPane
          key={`${node.profile}:${node.terminalProfile?.id ?? ""}:${node.terminalProfile?.version ?? ""}`}
          project={project}
          tab={tab}
          node={node}
          canEdit={canEdit}
        />
      ) : (
        <ProjectFileLinks
          project={{
            ...project,
            directory: agent?.directory ?? node.directory ?? project.directory,
          }}
        >
          <ChatPane
            project={project}
            tab={tab}
            node={node}
            canEdit={canEdit}
            start={
              <StartOptions
                options={options}
                disabled={!canEdit}
                onOpen={(option) =>
                  onCommand({
                    kind: "pane.configure",
                    ...target,
                    profile: option.profile,
                    ...(profiles.supported && option.terminalProfileId
                      ? { terminalProfileId: option.terminalProfileId }
                      : {}),
                  })
                }
              />
            }
          />
        </ProjectFileLinks>
      )}
    </section>
  );
}

function Split({
  node,
  first,
  second,
  canEdit,
  onResize,
}: {
  node: Extract<LayoutNode, { kind: "split" }>;
  first: React.ReactNode;
  second: React.ReactNode;
  canEdit: boolean;
  onResize: (ratio: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ ratio: number; grab: number; frame: number | null } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  // The ratio just committed, shown until the workspace reports it: the resize goes through the
  // daemon (over the network for a cloud machine), and without this the split snapped back to
  // where it was for that round trip.
  const [committed, setCommitted] = useState<{ ratio: number; from: number } | null>(null);
  useEffect(() => {
    if (!committed) return;
    // A rejected resize never comes back; fall back to the workspace's own ratio.
    const timer = setTimeout(() => setCommitted(null), 3000);
    return () => clearTimeout(timer);
  }, [committed]);
  const horizontal = node.axis === "horizontal";
  // Once the workspace's ratio moves, it is the answer, whether it is ours or another client's.
  const pending = committed?.from === node.ratio ? committed.ratio : null;
  const ratio = preview ?? pending ?? node.ratio;
  const resize = (value: number) => {
    if (value === (pending ?? node.ratio)) return;
    setCommitted({ ratio: value, from: node.ratio });
    onResize(value);
  };
  const end = (commit: boolean) => {
    const current = drag.current;
    if (!current) return;
    if (current.frame !== null) cancelAnimationFrame(current.frame);
    drag.current = null;
    delete document.documentElement.dataset["paneResizing"];
    setPreview(null);
    if (commit && canEdit) resize(current.ratio);
  };
  // A drag still running when the split goes away must not leave the whole app unselectable.
  useEffect(
    () => () => {
      if (drag.current?.frame != null) cancelAnimationFrame(drag.current.frame);
      if (drag.current) delete document.documentElement.dataset["paneResizing"];
    },
    [],
  );
  return (
    <div
      ref={container}
      className={`flex h-full min-h-0 min-w-0 ${horizontal ? "flex-row" : "flex-col"}`}
    >
      <div className="min-h-0 min-w-0" style={{ flex: `${ratio} 1 0%` }}>
        {first}
      </div>
      <div
        role="separator"
        aria-label="Resize split"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-disabled={!canEdit}
        data-resizing={preview !== null || undefined}
        tabIndex={canEdit ? 0 : -1}
        className={`pane-resize-handle shrink-0 touch-none bg-border ${horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize"}`}
        onPointerDown={(event) => {
          if (!canEdit || event.button !== 0) return;
          // Otherwise the press starts a text selection that sweeps across both panes as the
          // pointer moves; the handle is still focused for the arrow keys.
          event.preventDefault();
          window.getSelection()?.removeAllRanges();
          event.currentTarget.focus({ preventScroll: true });
          const handle = event.currentTarget.getBoundingClientRect();
          drag.current = {
            ratio: ratio,
            grab: horizontal
              ? event.clientX - (handle.left + handle.width / 2)
              : event.clientY - (handle.top + handle.height / 2),
            frame: null,
          };
          // Keeps the resize cursor and blocks selection everywhere, not only over the handle.
          document.documentElement.dataset["paneResizing"] = horizontal ? "column" : "row";
          setPreview(ratio);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || !container.current) return;
          const split = container.current.getBoundingClientRect();
          const handle = event.currentTarget.getBoundingClientRect();
          current.ratio = splitRatio({
            pointer: horizontal ? event.clientX : event.clientY,
            start: horizontal ? split.left : split.top,
            size: horizontal ? split.width : split.height,
            handle: horizontal ? handle.width : handle.height,
            grab: current.grab,
          });
          // Laying out two chat panes is the expensive part; do it at most once per frame.
          current.frame ??= requestAnimationFrame(() => {
            current.frame = null;
            if (drag.current === current) setPreview(current.ratio);
          });
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          end(true);
        }}
        onPointerCancel={() => end(false)}
        onLostPointerCapture={() => end(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag.current) {
            event.preventDefault();
            end(false);
            return;
          }
          if (!canEdit) return;
          const backward = horizontal ? "ArrowLeft" : "ArrowUp",
            forward = horizontal ? "ArrowRight" : "ArrowDown";
          if (event.key === backward || event.key === forward) {
            event.preventDefault();
            resize(clampRatio(ratio + (event.key === forward ? 0.05 : -0.05)));
          }
        }}
      />
      <div className="min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0%` }}>
        {second}
      </div>
    </div>
  );
}

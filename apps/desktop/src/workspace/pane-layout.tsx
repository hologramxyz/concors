import { ProjectFileLinks } from "@/files/provider";
import { neighborPane, type Direction } from "./pane-navigation";
import { useTabVisible } from "./tab-visibility";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useTerminalProfiles } from "@/terminal/profiles-context";
import { paneProfiles, TAB_PROFILES } from "./tab-profiles";
import { useCommand } from "@/shortcuts/context";
import { useShortcutLabels } from "@/shortcuts/preferences-context";
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
import { useContext, useEffect, useRef, useState } from "react";
import { AgentPaneIcon } from "@/agents/activity";
import { useAgents } from "@/agents/context";
import { Columns2, Rows2, Ellipsis, Terminal, X } from "lucide-react";
import type {
  LayoutNode,
  PaneProfile,
  WorkspaceOperation,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";

const PROFILE_LABELS: Record<PaneProfile, string> = {
  shell: "Terminal",
  chat: "Agent",
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
};
interface Props {
  focusRequest?: PaneFocusRequest | null;
  onPaneFocus?: ((paneId: string) => void) | undefined;
  tab: WorkspaceTab;
  project: WorkspaceProject;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
}

type Placement = "left" | "right" | "top" | "bottom";
interface PaneDrag {
  paneId: string;
  version: number;
}

export function PaneLayout(props: Props) {
  const visible = useTabVisible();
  const [dragging, setDragging] = useState<PaneDrag | null>(null);
  const [drop, setDrop] = useState<Placement | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const activePane =
    props.tab.nodes.find((node) => node.kind === "pane" && node.id === activePaneId) ??
    props.tab.nodes.find((node) => node.kind === "pane");
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
    let initial = true;
    const focus = () => {
      const focused = document.activeElement;
      if (
        focused?.closest(
          '[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"][data-state="open"]',
        )
      )
        return;
      const focusedPane = focused?.closest<HTMLElement>("[data-pane-id]");
      if (!initial && focusedPane && focusedPane !== pane && focusedPane.getClientRects().length) {
        pendingFocus.current = null;
        observer.disconnect();
        return;
      }
      const input = pane.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
      (input ?? pane).focus({ preventScroll: true });
      initial = false;
      if (input) {
        pendingFocus.current = null;
        observer.disconnect();
      }
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
    };
  }, [props.tab.nodes, activePaneId, activePane?.id, visible]);
  const connection = useContext(TerminalConnectionContext);
  const canSplitBefore = !!(
    connection?.state.status === "ready" ? connection.state.daemon : null
  )?.capabilities?.includes("directional-pane-split");
  const focusNeighbor = (direction: Direction) => {
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
    const pane = panes.find((pane) => pane.dataset.paneId === next);
    // Focus the input immediately; both terminal and Agent inputs allow pane shortcuts.
    const target = pane?.querySelector<HTMLElement>("textarea:not(:disabled)") ?? pane;
    target?.focus({ preventScroll: true });
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
    const focus = () => {
      const pane = container.current?.querySelector<HTMLElement>(
        `[data-pane-id="${target.paneId}"]`,
      );
      const input = pane?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
      const focused = document.activeElement;
      const focusedPane = focused?.closest<HTMLElement>("[data-pane-id]");
      if (focused?.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      if (!initial && focusedPane && focusedPane !== pane && focusedPane.getClientRects().length) {
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
    return <Pane key={id} {...props} node={node} onDrag={setDragging} />;
  };
  return (
    <div
      ref={container}
      onFocusCapture={rememberPane}
      onPointerDownCapture={rememberPane}
      data-testid="pane-workspace"
      onDragOver={(event) => {
        if (!dragging) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        setDrop(y < 0.25 ? "top" : y > 0.75 ? "bottom" : x < 0.5 ? "left" : "right");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(event) => {
        const target = props.tab.nodes.find(
          (node) => node.kind === "pane" && node.id !== dragging?.paneId,
        );
        if (!dragging || !drop || !target) return;
        event.preventDefault();
        props.onCommand({
          kind: "pane.move",
          projectId: props.project.id,
          tabId: props.tab.id,
          expectedVersion: dragging.version,
          paneId: dragging.paneId,
          targetPaneId: target.id,
          scope: "workspace",
          placement: drop,
          splitId: crypto.randomUUID(),
        });
        setDragging(null);
        setDrop(null);
      }}
      className="relative h-full min-h-[220px] min-w-[320px] px-2 pb-2"
    >
      {render(props.tab.root)}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30" data-testid="pane-drop-targets">
          {(
            [
              ["top", "inset-x-1 top-1 h-[calc(25%-0.5rem)]"],
              ["bottom", "inset-x-1 bottom-1 h-[calc(25%-0.5rem)]"],
              ["left", "inset-y-1/4 left-1 w-[calc(50%-0.5rem)]"],
              ["right", "inset-y-1/4 right-1 w-[calc(50%-0.5rem)]"],
            ] as const
          ).map(([placement, area]) => (
            <div
              key={placement}
              aria-label={`Move pane ${placement}`}
              data-drop-zone={placement}
              data-active={drop === placement}
              className={`absolute rounded-md border ${area} ${drop === placement ? "border-primary bg-primary/30" : "border-primary/40 bg-primary/10"}`}
            />
          ))}
        </div>
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
  onDrag,
}: Props & {
  node: Extract<LayoutNode, { kind: "pane" }>;
  onDrag: (drag: PaneDrag | null) => void;
}) {
  const shortcutLabel = useShortcutLabels();
  const connection = useContext(TerminalConnectionContext);
  const canDrag =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes("workspace-pane-rearrangement");
  const agent = useAgents().find((agent) => agent.id === node.sessionId);
  const profiles = useTerminalProfiles();
  const options = paneProfiles(profiles.profiles);
  const PaneIcon =
    TAB_PROFILES.find((item) => item.profile === (node.terminalProfile?.id ?? node.profile))
      ?.icon ?? Terminal;
  const label = node.terminalProfile?.name ?? PROFILE_LABELS[node.profile];
  const title = node.profile === "chat" ? (agent?.name ?? "Agent") : label;
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: node.id,
  };
  return (
    <section
      data-pane-id={node.id}
      tabIndex={-1}
      aria-label={`${label} pane`}
      className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border outline-none ${node.profile === "chat" ? "bg-card" : "bg-[var(--terminal-background)] text-[var(--terminal-foreground)]"}`}
    >
      <header
        tabIndex={0}
        draggable={canDrag && tab.nodes.length > 1}
        title="Drag to move pane"
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest("button") || !canDrag) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-concors-pane", node.id);
          onDrag({ paneId: node.id, version: project.version });
        }}
        onDragEnd={() => onDrag(null)}
        className={`flex h-9 shrink-0 items-center gap-1 border-b px-2 outline-none ${canDrag && tab.nodes.length > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {node.profile === "chat" ? (
          <AgentPaneIcon sessionId={node.sessionId} />
        ) : (
          <PaneIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-ui" title={title}>
          {title}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Pane actions"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max max-w-[calc(100vw-16px)] min-w-[280px]">
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
              <span
                aria-hidden="true"
                className="ml-auto shrink-0 pl-4 text-xs whitespace-nowrap text-muted-foreground"
              >
                {shortcutLabel("split-horizontal")}
              </span>
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
              <span
                aria-hidden="true"
                className="ml-auto shrink-0 pl-4 text-xs whitespace-nowrap text-muted-foreground"
              >
                {shortcutLabel("split-vertical")}
              </span>
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
              {options.map(({ id, label: optionLabel, icon: Icon }) => (
                <DropdownMenuRadioItem key={id} value={id} disabled={!canEdit}>
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{optionLabel}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label="Close pane"
          title={`Close pane (${shortcutLabel("close-pane")})`}
          disabled={!canEdit}
          onClick={() => onCommand({ kind: "pane.close", ...target })}
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
        >
          <X className="size-4" />
        </button>
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
          <ChatPane project={project} tab={tab} node={node} canEdit={canEdit} />
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
  const dragging = useRef<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const horizontal = node.axis === "horizontal";
  const ratio = preview ?? node.ratio;
  const clamp = (value: number) => Math.min(0.9, Math.max(0.1, value));
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
        className={`pane-resize-handle shrink-0 touch-none ${horizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"}`}
        onPointerDown={(event) => {
          if (!canEdit) return;
          dragging.current = node.ratio;
          setPreview(node.ratio);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragging.current === null || !container.current) return;
          const rect = container.current.getBoundingClientRect();
          const value = clamp(
            horizontal
              ? (event.clientX - rect.left) / rect.width
              : (event.clientY - rect.top) / rect.height,
          );
          dragging.current = value;
          setPreview(value);
        }}
        onPointerUp={(event) => {
          const value = dragging.current;
          dragging.current = null;
          setPreview(null);
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (value !== null && canEdit) onResize(value);
        }}
        onPointerCancel={() => {
          dragging.current = null;
          setPreview(null);
        }}
        onKeyDown={(event) => {
          if (!canEdit) return;
          const backward = horizontal ? "ArrowLeft" : "ArrowUp",
            forward = horizontal ? "ArrowRight" : "ArrowDown";
          if (event.key === backward || event.key === forward) {
            event.preventDefault();
            onResize(clamp(node.ratio + (event.key === forward ? 0.05 : -0.05)));
          }
        }}
      />
      <div className="min-h-0 min-w-0" style={{ flex: `${1 - ratio} 1 0%` }}>
        {second}
      </div>
    </div>
  );
}

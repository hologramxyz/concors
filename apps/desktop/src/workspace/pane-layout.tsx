import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
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
  tab: WorkspaceTab;
  project: WorkspaceProject;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
}

type Placement = Extract<WorkspaceOperation, { kind: "pane.move" }>["placement"];
interface PaneDrag {
  paneId: string;
  version: number;
}

export function PaneLayout(props: Props) {
  const [dragging, setDragging] = useState<PaneDrag | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const [activePaneId, setActivePaneId] = useState<string | null>(null);
  const activePane =
    props.tab.nodes.find((node) => node.kind === "pane" && node.id === activePaneId) ??
    props.tab.nodes.find((node) => node.kind === "pane");
  const split = (axis: "horizontal" | "vertical") => {
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
      profile: activePane.profile,
    });
  };
  useEffect(() => {
    const requested = pendingFocus.current;
    const targetId =
      requested && props.tab.nodes.some((node) => node.id === requested)
        ? requested
        : activePaneId && !props.tab.nodes.some((node) => node.id === activePaneId)
          ? activePane?.id
          : null;
    if (!targetId) return;
    pendingFocus.current = null;
    const pane = container.current?.querySelector<HTMLElement>(`[data-pane-id="${targetId}"]`);
    (pane?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)") ?? pane)?.focus();
  }, [props.tab.nodes, activePaneId, activePane?.id]);
  const canSplit = props.canEdit && !!activePane && props.tab.nodes.length < 63;
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
      if (id) setActivePaneId(id);
    }
  };

  useEffect(() => {
    const target = props.focusRequest;
    if (!target || target.projectId !== props.project.id || target.tabId !== props.tab.id) return;
    const frame = requestAnimationFrame(() => {
      const pane = container.current?.querySelector<HTMLElement>(
        `[data-pane-id="${target.paneId}"]`,
      );
      const input = pane?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
      (input ?? pane)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
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
    return <Pane key={id} {...props} node={node} dragging={dragging} onDrag={setDragging} />;
  };
  return (
    <div
      ref={container}
      onFocusCapture={rememberPane}
      onPointerDownCapture={rememberPane}
      className="h-full min-h-[220px] min-w-[320px] p-2"
    >
      {render(props.tab.root)}
    </div>
  );
}

function Pane({
  node,
  tab,
  project,
  canEdit,
  onCommand,
  dragging,
  onDrag,
}: Props & {
  node: Extract<LayoutNode, { kind: "pane" }>;
  dragging: PaneDrag | null;
  onDrag: (drag: PaneDrag | null) => void;
}) {
  const [drop, setDrop] = useState<Placement | null>(null);
  const connection = useContext(TerminalConnectionContext);
  const canDrag =
    canEdit &&
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes("pane-rearrangement");
  const canDrop = canDrag && dragging !== null && dragging.paneId !== node.id;
  const agent = useAgents().find((agent) => agent.id === node.sessionId);
  const title = node.profile === "chat" ? (agent?.name ?? "Agent") : PROFILE_LABELS[node.profile];
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: node.id,
  };
  return (
    <section
      data-pane-id={node.id}
      onDragOver={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const edges = [
          ["left", x],
          ["right", 1 - x],
          ["top", y],
          ["bottom", 1 - y],
        ] as const;
        const nearest = edges.reduce((best, edge) => (edge[1] < best[1] ? edge : best));
        setDrop(nearest[1] < 0.25 ? nearest[0] : "center");
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
      }}
      onDrop={(event) => {
        if (!canDrop || !drop || !dragging) return;
        event.preventDefault();
        event.stopPropagation();
        onCommand({
          kind: "pane.move",
          ...target,
          expectedVersion: dragging.version,
          paneId: dragging.paneId,
          targetPaneId: node.id,
          placement: drop,
          splitId: crypto.randomUUID(),
        });
        setDrop(null);
        onDrag(null);
      }}
      tabIndex={-1}
      aria-label={`${PROFILE_LABELS[node.profile]} pane`}
      className={`relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none ${node.profile === "chat" ? "bg-card" : "bg-[var(--terminal-background)] text-[var(--terminal-foreground)]"}`}
    >
      <header
        draggable={canDrag && tab.nodes.length > 1}
        title="Drag to move pane; drop in the center to swap or on an edge to split"
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
        className={`flex h-9 shrink-0 items-center gap-1 border-b px-2 ${canDrag && tab.nodes.length > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
      >
        {node.profile === "chat" ? (
          <AgentPaneIcon sessionId={node.sessionId} />
        ) : (
          <Terminal className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]" title={title}>
          {title}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Pane actions"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Ellipsis className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
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
              <Columns2 /> Split horizontally
              <span
                aria-hidden="true"
                className="ml-auto text-xs whitespace-nowrap text-muted-foreground"
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
              <Rows2 /> Split vertically
              <span
                aria-hidden="true"
                className="ml-auto text-xs whitespace-nowrap text-muted-foreground"
              >
                {shortcutLabel("split-vertical")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Pane profile</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={node.profile}
              onValueChange={(profile) =>
                onCommand({ kind: "pane.configure", ...target, profile: profile as PaneProfile })
              }
            >
              {Object.entries(PROFILE_LABELS).map(([value, label]) => (
                <DropdownMenuRadioItem key={value} value={value} disabled={!canEdit}>
                  {label}
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
          key={node.profile}
          project={project}
          tab={tab}
          node={node}
          canEdit={canEdit}
        />
      ) : (
        <ChatPane project={project} tab={tab} node={node} canEdit={canEdit} />
      )}
      {canDrop && drop && (
        <div
          data-testid="pane-drop-preview"
          data-placement={drop}
          className={`pointer-events-none absolute z-30 flex items-center justify-center rounded border-2 border-primary bg-primary/15 text-sm font-medium text-foreground ${
            drop === "left"
              ? "inset-y-0 left-0 w-1/2"
              : drop === "right"
                ? "inset-y-0 right-0 w-1/2"
                : drop === "top"
                  ? "inset-x-0 top-0 h-1/2"
                  : drop === "bottom"
                    ? "inset-x-0 bottom-0 h-1/2"
                    : "inset-0"
          }`}
        >
          {drop === "center" ? "Swap panes" : "Move into split"}
        </div>
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
        tabIndex={canEdit ? 0 : -1}
        className={`shrink-0 touch-none rounded hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none ${horizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"}`}
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

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
import { useEffect, useRef, useState } from "react";
import { Columns2, Rows2, Ellipsis, Terminal, MessageSquare, X } from "lucide-react";
import type {
  LayoutNode,
  PaneProfile,
  WorkspaceOperation,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";

const PROFILE_LABELS: Record<PaneProfile, string> = {
  shell: "Terminal",
  chat: "Unified chat",
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

export function PaneLayout(props: Props) {
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
    return <Pane key={id} {...props} node={node} />;
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
}: Props & { node: Extract<LayoutNode, { kind: "pane" }> }) {
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
      aria-label={`${PROFILE_LABELS[node.profile]} pane`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-card focus-visible:ring-1 focus-visible:ring-primary focus-visible:outline-none"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
        {node.profile === "chat" ? (
          <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <Terminal className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px]">{PROFILE_LABELS[node.profile]}</span>
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
              <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
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
              <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">
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
                <DropdownMenuRadioItem
                  key={value}
                  value={value}
                  disabled={!canEdit || node.sessionId !== null}
                >
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
        <TerminalPane project={project} tab={tab} node={node} canEdit={canEdit} />
      ) : (
        <ChatPane project={project} tab={tab} node={node} canEdit={canEdit} />
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

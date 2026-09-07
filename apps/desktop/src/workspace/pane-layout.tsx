import { TerminalPane } from "@/terminal/terminal-pane";
import { useRef, useState } from "react";
import { Columns2, Rows2, Terminal, MessageSquare, X } from "lucide-react";
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
  tab: WorkspaceTab;
  project: WorkspaceProject;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
}

export function PaneLayout(props: Props) {
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
  return <div className="h-full min-h-[220px] min-w-[320px] p-2">{render(props.tab.root)}</div>;
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
      aria-label={`${PROFILE_LABELS[node.profile]} pane`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border bg-card"
    >
      <header className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted/30 px-2">
        {node.profile === "chat" ? (
          <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <select
          aria-label="Pane profile"
          value={node.profile}
          disabled={!canEdit || node.sessionId !== null}
          onChange={(event) =>
            onCommand({
              kind: "pane.configure",
              ...target,
              profile: event.target.value as PaneProfile,
            })
          }
          className="min-w-0 flex-1 bg-transparent text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {Object.entries(PROFILE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Split horizontally"
          title="Split side by side"
          disabled={!canEdit || tab.nodes.length >= 63}
          onClick={() =>
            onCommand({
              kind: "pane.split",
              ...target,
              splitId: crypto.randomUUID(),
              newPaneId: crypto.randomUUID(),
              axis: "horizontal",
              profile: node.profile,
            })
          }
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
        >
          <Columns2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Split vertically"
          title="Split above and below"
          disabled={!canEdit || tab.nodes.length >= 63}
          onClick={() =>
            onCommand({
              kind: "pane.split",
              ...target,
              splitId: crypto.randomUUID(),
              newPaneId: crypto.randomUUID(),
              axis: "vertical",
              profile: node.profile,
            })
          }
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
        >
          <Rows2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close pane"
          disabled={!canEdit}
          onClick={() => onCommand({ kind: "pane.close", ...target })}
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
        >
          <X className="size-3.5" />
        </button>
      </header>
      {node.profile !== "chat" ? (
        <TerminalPane project={project} tab={tab} node={node} canEdit={canEdit} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-5 text-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/40">
            {node.profile === "chat" ? (
              <MessageSquare className="size-5 text-muted-foreground" />
            ) : (
              <Terminal className="size-5 text-muted-foreground" />
            )}
          </span>
          <div>
            <p className="text-sm font-medium">{PROFILE_LABELS[node.profile]}</p>
            <p className="mt-1 text-xs text-muted-foreground">Session not started</p>
          </div>
          <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
            Your pane layout and profile are saved.{" "}
            {node.profile === "chat" ? "Agent chat" : "Terminal execution"} is coming in the next
            milestone.
          </p>
          <code
            className="max-w-full truncate text-[10px] text-muted-foreground"
            title={project.directory}
          >
            {project.directory}
          </code>
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

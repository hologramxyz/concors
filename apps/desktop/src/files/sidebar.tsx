import { useContext, useRef, useState, type CSSProperties } from "react";
import { FolderOpen } from "lucide-react";
import type { WorkspaceProject } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useFiles, fileScope } from "./context";
import { FileTree } from "./tree";
import { DEFAULT_FILE_SIDEBAR_WIDTH } from "./sidebar-state";
import { preloadCodeEditor } from "./editor-loader";

export function FilesToggle() {
  const { sidebar } = useFiles();
  const connection = useContext(TerminalConnectionContext);
  const available =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("project-files");
  return (
    <div className="size-7 shrink-0">
      <button
        id="toggle-project-files"
        type="button"
        aria-label="Toggle project files"
        title={available ? "Project files" : "Update or reconnect the machine to browse files"}
        aria-expanded={sidebar.open}
        aria-controls="project-file-tree"
        disabled={!available}
        onPointerEnter={preloadCodeEditor}
        onFocus={preloadCodeEditor}
        onClick={() => {
          preloadCodeEditor();
          sidebar.setOpen(!sidebar.open);
        }}
        style={
          !sidebar.docked
            ? { transform: `translateX(-${sidebar.open ? sidebar.width : 0}px)` }
            : undefined
        }
        className={`files-toggle flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 ${sidebar.open ? "bg-sidebar text-foreground" : ""}`}
      >
        <FolderOpen className="size-4" />
      </button>
    </div>
  );
}
export function FilesSidebar({ project }: { project: WorkspaceProject | undefined }) {
  const { sidebar } = useFiles();
  const connection = useContext(TerminalConnectionContext);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const open = sidebar.open && !!project;
  const [visited, setVisited] = useState(open);
  if (open && !visited) setVisited(true);
  const workspace = connection?.workspace;
  const scope =
    workspace && project ? fileScope(workspace.machineId, workspace.epoch, project.id) : "";
  return (
    <aside
      id="project-file-tree"
      aria-label="Project files"
      aria-hidden={!open}
      inert={!open}
      className="files-sidebar-shell"
      data-open={open}
      data-docked={sidebar.docked}
      data-resizing={dragging}
      style={{ "--files-sidebar-width": `${sidebar.width}px` } as CSSProperties}
    >
      <div className="files-sidebar-content h-full border-l bg-sidebar text-ui text-sidebar-foreground">
        <div
          role="separator"
          aria-label="Resize files sidebar"
          aria-orientation="vertical"
          aria-valuemin={sidebar.minWidth}
          aria-valuemax={sidebar.maxWidth}
          aria-valuenow={sidebar.width}
          aria-valuetext={`${sidebar.width} pixels`}
          tabIndex={open ? 0 : -1}
          title="Drag to resize. Double-click to reset."
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize touch-none hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            drag.current = { x: event.clientX, width: sidebar.width };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (drag.current) sidebar.resize(drag.current.width + drag.current.x - event.clientX);
          }}
          onPointerUp={(event) => {
            drag.current = null;
            setDragging(false);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
          onDoubleClick={() => sidebar.resize(DEFAULT_FILE_SIDEBAR_WIDTH)}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowLeft"
                ? sidebar.width + 16
                : event.key === "ArrowRight"
                  ? sidebar.width - 16
                  : event.key === "Home"
                    ? sidebar.minWidth
                    : event.key === "End"
                      ? sidebar.maxWidth
                      : null;
            if (next === null) return;
            event.preventDefault();
            event.stopPropagation();
            sidebar.resize(next);
          }}
        />
        {project && visited && (
          <FileTree key={scope} project={project} open={open} onClose={sidebar.close} />
        )}
      </div>
    </aside>
  );
}

import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  RefreshCw,
  X,
} from "lucide-react";
import type { FileEntry, WorkspaceProject } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { useFiles } from "./context";
import { CreateEntry } from "./create-entry";

export function FileTree({
  project,
  open,
  onClose,
}: {
  project: WorkspaceProject;
  open: boolean;
  onClose(): void;
}) {
  const files = useFiles();
  const connection = useContext(TerminalConnectionContext);
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<"file" | "directory" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(() => {
    try {
      return localStorage.getItem("concors.files.show-hidden") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("concors.files.show-hidden", String(showHidden));
    } catch {
      /* Keep the current preference when storage is unavailable. */
    }
  }, [showHidden]);
  const canCreate =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("project-file-create");
  const toggle = useCallback(
    (path: string) =>
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      }),
    [],
  );
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open)
      panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div
      ref={panel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="m-2 flex h-9 shrink-0 items-center gap-2 px-1">
        <FolderOpen className="size-4" />
        <h2 className="flex-1 text-ui font-medium">Files</h2>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Close files"
          title="Close files"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div
        role="group"
        aria-label="File actions"
        className="mx-2 flex shrink-0 items-center gap-1 border-b px-1 pb-2 text-muted-foreground"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New file"
          disabled={!canCreate}
          title={canCreate ? "New file" : "Update or reconnect the machine to create files"}
          onClick={() => setCreating("file")}
        >
          <FilePlus2 className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="New folder"
          disabled={!canCreate}
          title={canCreate ? "New folder" : "Update or reconnect the machine to create folders"}
          onClick={() => setCreating("directory")}
        >
          <FolderPlus className="size-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
          aria-pressed={showHidden}
          className={showHidden ? "bg-muted text-foreground" : undefined}
          onClick={() => setShowHidden((value) => !value)}
        >
          {showHidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh file tree"
          title="Refresh file tree"
          onClick={() => setGeneration((value) => value + 1)}
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>
      <div className="shrink-0 p-2">
        <input
          aria-label="Filter loaded files"
          placeholder="Filter loaded files…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-ui outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      {creating && (
        <CreateEntry
          key={creating}
          project={project}
          kind={creating}
          onCancel={() => {
            setCreating(null);
            panel.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
          }}
          onCreated={(entry) => {
            setCreating(null);
            setFilter("");
            if (entry.path.split("/").some((part) => part.startsWith("."))) setShowHidden(true);
            setExpanded((current) => {
              const next = new Set(current);
              const parts = entry.path.split("/");
              if (entry.kind === "file") parts.pop();
              while (parts.length) {
                next.add(parts.join("/"));
                parts.pop();
              }
              return next;
            });
            setGeneration((value) => value + 1);
            if (entry.kind === "file") {
              files.open(project, { path: entry.path });
              if (!files.sidebar.docked) onClose();
            } else
              panel.current
                ?.querySelector<HTMLInputElement>("input")
                ?.focus({ preventScroll: true });
          }}
        />
      )}
      <div className="min-h-0 flex-1 overflow-auto pb-3" aria-label={`${project.name} directory`}>
        <Directory
          project={project}
          path=""
          depth={0}
          filter={filter.toLowerCase()}
          showHidden={showHidden}
          expanded={expanded}
          onToggle={toggle}
          generation={generation}
          onOpen={(entry) => {
            files.open(project, { path: entry.path });
            if (!files.sidebar.docked) onClose();
          }}
        />
      </div>
    </div>
  );
}
function Directory({
  project,
  path,
  depth,
  filter,
  showHidden,
  expanded,
  onToggle,
  generation,
  onOpen,
}: {
  project: WorkspaceProject;
  path: string;
  depth: number;
  filter: string;
  showHidden: boolean;
  expanded: Set<string>;
  onToggle(path: string): void;
  generation: number;
  onOpen(entry: FileEntry): void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const status = connection?.state.status;
  const epoch = connection?.workspace?.epoch;
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const workspace = connection?.workspace;
    if (!workspace || connection.state.status !== "ready") {
      queueMicrotask(() => {
        if (!cancelled) setError("Reconnect to browse files.");
      });
      return () => {
        cancelled = true;
      };
    }
    queueMicrotask(() => {
      if (!cancelled) setError(null);
    });
    void connection
      .requestFile(
        { kind: "list", projectId: project.id, epoch: workspace.epoch, path },
        crypto.randomUUID(),
      )
      .then((result) => {
        if (cancelled) return;
        if (result.outcome.status !== "listed")
          throw new Error(
            "message" in result.outcome ? result.outcome.message : "Could not list this folder.",
          );
        setEntries(result.outcome.entries);
        setTruncated(result.outcome.truncated);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load files.");
      });
    return () => {
      cancelled = true;
    };
  }, [connection, status, epoch, project.id, path, retry, generation]);
  if (error)
    return (
      <div role="alert" className="space-y-2 p-3 text-ui text-muted-foreground">
        {error}
        <Button size="xs" variant="outline" onClick={() => setRetry((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  if (!entries)
    return (
      <p role="status" className="px-3 py-2 text-ui text-muted-foreground">
        Loading files…
      </p>
    );
  return (
    <ul className="m-0 list-none p-0">
      {entries
        .filter((entry) => showHidden || !entry.name.startsWith("."))
        .filter((entry) => entry.kind === "directory" || entry.name.toLowerCase().includes(filter))
        .map((entry) => {
          const directory = entry.kind === "directory",
            open = expanded.has(entry.path),
            supported = directory || entry.kind === "file";
          const Icon = directory
            ? open
              ? FolderOpen
              : Folder
            : entry.kind === "symlink"
              ? Link2
              : FileCode2;
          return (
            <li key={entry.path}>
              <button
                type="button"
                title={
                  supported
                    ? entry.path
                    : `${entry.path} — open links or special files in a terminal`
                }
                disabled={!supported}
                aria-expanded={directory ? open : undefined}
                onClick={() => (directory ? onToggle(entry.path) : onOpen(entry))}
                className="flex w-full items-center gap-1.5 py-1.5 pr-3 text-left text-ui hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-40"
                style={{ paddingLeft: `${12 + Math.min(depth, 12) * 14}px` }}
              >
                {directory ? (
                  <ChevronRight
                    className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
              </button>
              {directory && open && (
                <Directory
                  project={project}
                  path={entry.path}
                  depth={depth + 1}
                  filter={filter}
                  showHidden={showHidden}
                  expanded={expanded}
                  onToggle={onToggle}
                  generation={generation}
                  onOpen={onOpen}
                />
              )}
            </li>
          );
        })}
      {!entries.some(
        (entry) =>
          (showHidden || !entry.name.startsWith(".")) &&
          (entry.kind === "directory" || entry.name.toLowerCase().includes(filter)),
      ) && (
        <li className="px-3 py-2 text-ui text-muted-foreground">
          {filter ? "No matching files" : entries.length ? "No visible files" : "Empty folder"}
        </li>
      )}
      {truncated && (
        <li className="px-3 py-2 text-ui text-muted-foreground">
          Showing the first 2,000 entries. Browse this folder in a terminal to see all entries.
        </li>
      )}
    </ul>
  );
}

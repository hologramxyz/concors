import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronRight, FileCode2, Folder, FolderOpen, Link2, RefreshCw, X } from "lucide-react";
import type { FileEntry, WorkspaceProject } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { useFiles } from "./context";

export function FileTree({ project, onClose }: { project: WorkspaceProject; onClose(): void }) {
  const files = useFiles();
  const [generation, setGeneration] = useState(0);
  const [filter, setFilter] = useState("");
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);
  return (
    <aside
      ref={panel}
      id="project-file-tree"
      aria-label="Project files"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-y-0 right-0 z-20 flex w-[min(320px,100%)] flex-col border-l bg-background shadow-xl lg:relative lg:z-auto lg:w-72 lg:shrink-0 lg:shadow-none"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <FolderOpen className="size-4" />
        <h2 className="flex-1 text-xs font-medium">Files</h2>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Refresh file tree"
          onClick={() => setGeneration((value) => value + 1)}
        >
          <RefreshCw />
        </Button>
        <Button size="icon-xs" variant="ghost" aria-label="Close files" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="p-2">
        <input
          aria-label="Filter loaded files"
          placeholder="Filter loaded files…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pb-3" aria-label={`${project.name} directory`}>
        <Directory
          key={`${project.id}:${generation}`}
          project={project}
          path=""
          depth={0}
          filter={filter.toLowerCase()}
          onOpen={(entry) => {
            files.open(project, { path: entry.path });
            if (window.innerWidth < 1024) onClose();
          }}
        />
      </div>
      <p
        title={project.directory}
        className="truncate border-t px-3 py-2 font-mono text-[10px] text-muted-foreground"
      >
        {project.directory}
      </p>
    </aside>
  );
}
function Directory({
  project,
  path,
  depth,
  filter,
  onOpen,
}: {
  project: WorkspaceProject;
  path: string;
  depth: number;
  filter: string;
  onOpen(entry: FileEntry): void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const status = connection?.state.status;
  const epoch = connection?.workspace?.epoch;
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
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
  }, [connection, status, epoch, project.id, path, retry]);
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
  if (error)
    return (
      <div role="alert" className="space-y-2 p-3 text-xs text-muted-foreground">
        {error}
        <Button size="xs" variant="outline" onClick={() => setRetry((value) => value + 1)}>
          Retry
        </Button>
      </div>
    );
  if (!entries)
    return (
      <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
        Loading files…
      </p>
    );
  return (
    <ul className="m-0 list-none p-0">
      {entries
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
                onClick={() => (directory ? toggle(entry.path) : onOpen(entry))}
                className="flex w-full items-center gap-1.5 py-1.5 pr-3 text-left text-xs hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-40"
                style={{ paddingLeft: `${12 + Math.min(depth, 12) * 14}px` }}
              >
                {directory ? (
                  <ChevronRight
                    className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  />
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.name}</span>
              </button>
              {directory && open && (
                <Directory
                  project={project}
                  path={entry.path}
                  depth={depth + 1}
                  filter={filter}
                  onOpen={onOpen}
                />
              )}
            </li>
          );
        })}
      {!entries.length && <li className="px-3 py-2 text-xs text-muted-foreground">Empty folder</li>}
      {truncated && (
        <li className="px-3 py-2 text-xs text-muted-foreground">
          Showing the first 2,000 entries. Browse this folder in a terminal to see all entries.
        </li>
      )}
    </ul>
  );
}

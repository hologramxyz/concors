import { useContext, useEffect, useRef, useState } from "react";
import { newRequestId } from "@concors/client-core";
import { FolderGit2, HardDrive, RefreshCw, Trash2 } from "lucide-react";
import {
  RESOURCES_CAPABILITY,
  type MachineProcess,
  type ResourceOperation,
  type StorageEntry,
  type StorageSnapshot,
} from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { openExternal } from "@/tauri/open-external";
import { formatMemory } from "./usage-display";
import { useProcesses } from "./use-processes";
import { validPreviewUrl, usePreviewLinks } from "./preview-links";
import { processStore } from "./process-store";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ResourceProcessRow } from "./process-row";

type Action = { kind: "stop"; item: MachineProcess } | { kind: "cleanup"; item: StorageEntry };

export function ResourcesView() {
  const connection = useContext(TerminalConnectionContext);
  // A host switch unmounts pending confirmations and storage data, even while a request resolves.
  return <ResourceContent key={connection ? processStore(connection).scope : "offline"} />;
}

function ResourceContent() {
  const compact = useContext(CompactLayoutContext);
  const { connection, snapshot, error: processError, loading, refresh } = useProcesses();
  const [section, setSection] = useState<"running" | "storage">("running");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("memory");
  const [processLimit, setProcessLimit] = useState(100);
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<MachineProcess | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const previewHref = validPreviewUrl(previewUrl, compact);
  const { links, setLink } = usePreviewLinks(connection);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const supported =
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes(RESOURCES_CAPABILITY);
  const run = async (operation: ResourceOperation) => {
    if (!connection || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await connection.requestResource(operation, newRequestId());
      if (!alive.current) return;
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (result.outcome.status === "storage") setStorage(result.outcome.snapshot);
      if (result.outcome.status === "done") {
        setMessage(result.outcome.message);
        setAction(null);
        setConfirmation("");
        if (operation.kind === "cleanup")
          setStorage((previous) =>
            previous
              ? {
                  ...previous,
                  entries: previous.entries.filter((entry) => entry.id !== operation.id),
                }
              : null,
          );
        void refresh();
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Resource operation failed.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const filtered = (snapshot?.processes ?? [])
    .filter((item) =>
      `${item.name} ${item.pid} ${item.directory ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "cpu"
        ? (b.cpuPercent ?? -1) - (a.cpuPercent ?? -1)
        : sort === "name"
          ? a.name.localeCompare(b.name)
          : (b.memoryBytes ?? -1) - (a.memoryBytes ?? -1),
    );
  const entries = (storage?.entries ?? [])
    .filter((item) =>
      `${item.path} ${item.kind} ${item.branch ?? ""}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
  const openPreview = (item: MachineProcess) => {
    const url = links[item.id];
    if (url) void openExternal(url).catch((cause: unknown) => setError(String(cause)));
    else {
      setPreview(item);
      setPreviewUrl("");
    }
  };
  return (
    <div
      className={
        compact ? "space-y-4 py-2" : "mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6"
      }
    >
      {!compact && <h2 className="text-base font-medium">Resources</h2>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1" aria-label="Resource sections">
          <Button
            variant={section === "running" ? "secondary" : "ghost"}
            aria-pressed={section === "running"}
            onClick={() => {
              setSection("running");
              setQuery("");
            }}
          >
            Processes
          </Button>
          <Button
            variant={section === "storage" ? "secondary" : "ghost"}
            aria-pressed={section === "storage"}
            onClick={() => {
              setSection("storage");
              setQuery("");
            }}
          >
            Storage & cleanup
          </Button>
        </div>
        <Button
          variant="ghost"
          size={section === "running" ? "icon" : "sm"}
          aria-label={section === "running" ? "Refresh" : undefined}
          disabled={!supported || busy || loading}
          onClick={() => (section === "running" ? void refresh() : void run({ kind: "storage" }))}
        >
          <RefreshCw className={busy || loading ? "animate-spin" : ""} />
          {section === "storage" && (busy ? "Scanning…" : "Scan storage")}
        </Button>
      </div>
      {(error || processError) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? processError}
        </p>
      )}
      {message && (
        <p role="status" className="rounded-md border bg-muted/30 p-3 text-sm">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          aria-label="Filter resources"
          placeholder={
            section === "running"
              ? "Filter by process, PID, or folder…"
              : "Filter by path, worktree, or cache…"
          }
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1"
        />
        {section === "running" && (
          <select
            aria-label="Sort processes"
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            className="rounded-md border bg-background px-2 text-sm"
          >
            <option value="memory">RAM usage</option>
            <option value="cpu">CPU usage</option>
            <option value="name">Name</option>
          </select>
        )}
      </div>
      {section === "running" ? (
        <>
          {snapshot?.warnings.map((warning) => (
            <p key={warning} className="text-xs text-muted-foreground">
              {warning}
            </p>
          ))}
          <ul className="space-y-0.5" aria-label="Running processes">
            {filtered.slice(0, processLimit).map((item) => (
              <ResourceProcessRow
                key={item.id}
                item={item}
                hasPreview={!!links[item.id]}
                canStop={!!supported && !busy}
                onPreview={() => openPreview(item)}
                onChangePreview={() => {
                  setPreview(item);
                  setPreviewUrl(links[item.id] ?? "");
                }}
                onStop={() => {
                  setAction({ kind: "stop", item });
                  setError(null);
                }}
              />
            ))}
            {!filtered.length && (
              <li className="p-6 text-center text-sm text-muted-foreground">
                {loading
                  ? "Discovering processes…"
                  : query
                    ? "No matching processes."
                    : "No processes to show."}
              </li>
            )}
          </ul>
          {filtered.length > processLimit && (
            <Button variant="ghost" onClick={() => setProcessLimit((limit) => limit + 100)}>
              Show more processes ({processLimit} of {filtered.length})
            </Button>
          )}
          <details className="text-xs leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer">About resource usage</summary>
            <p className="mt-2">
              Processes visible to the daemon’s OS user. CPU is a share of the whole machine; RAM is
              resident memory and may include shared pages. Sleeping does not mean safe to stop.
              Container and other-user usage may not be fully attributed.
            </p>
          </details>
        </>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Review worktrees, temporary files, and caches. Removal is permanent and always
            confirmed.
          </p>
          {!storage && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Choose Scan storage to inspect disk and RAM-backed temporary files. Scans run only
              when requested.
            </div>
          )}
          {storage && (
            <>
              <div className="space-y-2">
                {storage.volumes.map((volume) => (
                  <div
                    key={volume.path}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-2 text-sm"
                  >
                    <div className="min-w-0 truncate">
                      {volume.path}{" "}
                      {volume.memoryBacked && (
                        <span className="font-normal text-muted-foreground">· RAM-backed</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatMemory(volume.availableBytes)} available /{" "}
                      {formatMemory(volume.totalBytes)} · filesystem capacity
                    </p>
                  </div>
                ))}
              </div>
              {storage.warnings.map((warning) => (
                <p key={warning} className="text-xs text-muted-foreground">
                  {warning}
                </p>
              ))}
              <p className="text-xs text-muted-foreground">
                Scanned {new Date(storage.scannedAt).toLocaleTimeString()}. Sizes use allocated
                blocks; cleanup rechecks for changes.
              </p>
              <ul className="space-y-0.5" aria-label="Storage entries">
                {entries.map((item) => (
                  <li
                    key={item.id}
                    className="flex min-w-0 items-start gap-2 rounded-md px-2 py-3 hover:bg-muted/40"
                  >
                    {item.kind === "worktree" ? (
                      <FolderGit2 className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <HardDrive className="mt-1 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm break-all">{item.path}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.kind}
                        {item.branch ? ` · ${item.branch}` : ""} ·{" "}
                        {item.memoryBacked ? "RAM-backed" : "Disk"} ·{" "}
                        {item.bytes === null ? "Size unavailable" : formatMemory(item.bytes)}
                      </p>
                      {item.cleanupBlocked && (
                        <p className="mt-1 text-xs text-muted-foreground">{item.cleanupBlocked}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!item.cleanupBlocked || !supported || busy}
                      onClick={() => {
                        setAction({ kind: "cleanup", item });
                        setConfirmation("");
                        setError(null);
                      }}
                    >
                      <Trash2 />
                      Review
                    </Button>
                  </li>
                ))}
                {!entries.length && (
                  <li className="py-6 text-sm text-muted-foreground">
                    No matching storage entries.
                  </li>
                )}
              </ul>
            </>
          )}
          <details className="text-xs leading-relaxed text-muted-foreground">
            <summary className="cursor-pointer">About storage cleanup</summary>
            <p className="mt-2">
              Scans cover linked worktrees from open projects, user-owned temporary entries, and
              cache folders. A clean scan does not mean files are unwanted. Review contents before
              removal. No automatic cleanup; processes and Docker volumes are never pruned in bulk.
            </p>
          </details>
        </>
      )}
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setAction(null);
            setConfirmation("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action?.kind === "stop" ? "Stop process?" : "Remove files?"}</DialogTitle>
            <DialogDescription>
              {action?.kind === "stop"
                ? "Send a graceful termination request to this process only. Unsaved in-memory work may be lost. Child processes can remain; no force-kill is sent."
                : "Permanently remove this exact entry after rechecking its contents and active use. There is no undo. Git branches are kept; dirty or unpushed worktrees are blocked."}
            </DialogDescription>
          </DialogHeader>
          {action?.kind === "stop" ? (
            <p className="text-sm break-all">
              {action.item.name} · PID {action.item.pid}
              <br />
              {action.item.directory}
            </p>
          ) : (
            action && (
              <>
                <p className="rounded-md bg-muted p-3 font-mono text-xs break-all">
                  {action.item.path}
                </p>
                <label className="space-y-2 text-sm">
                  Type the full path to confirm
                  <Input
                    value={confirmation}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
                </label>
              </>
            )
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                !supported ||
                busy ||
                (action?.kind === "cleanup" && confirmation !== action.item.path)
              }
              onClick={() => {
                if (action)
                  void run(
                    action.kind === "stop"
                      ? { kind: "stop", id: action.item.id }
                      : { kind: "cleanup", id: action.item.id, confirmation },
                  );
              }}
            >
              {busy ? "Working…" : action?.kind === "stop" ? "Stop process" : "Remove permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview link</DialogTitle>
            <DialogDescription>
              Listening ports: {preview?.ports.join(", ")}. Attach an existing{" "}
              {compact ? "HTTPS" : "HTTP(S)"} preview or tunnel URL. This does not publish a port or
              change network access.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2 text-sm">
            Preview URL
            <Input
              type="url"
              placeholder="https://your-preview.example"
              value={previewUrl}
              onChange={(event) => setPreviewUrl(event.target.value)}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            For a remote machine, use its reachable preview URL—not this device’s localhost. Some
            listening ports are databases or other non-HTTP services.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              disabled={!previewHref}
              onClick={() => {
                const url = previewHref;
                if (preview && url) {
                  setLink(preview.id, url);
                  setPreview(null);
                  void openExternal(url).catch((cause: unknown) => setError(String(cause)));
                }
              }}
            >
              Open preview
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

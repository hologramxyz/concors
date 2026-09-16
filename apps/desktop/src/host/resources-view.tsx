import { useContext, useEffect, useRef, useState } from "react";
import { newRequestId } from "@concors/client-core";
import { RefreshCw } from "lucide-react";
import { RESOURCES_CAPABILITY, type MachineProcess } from "@concors/protocol";
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
import { useProcesses } from "./use-processes";
import { usePreviewLinks } from "./preview-links";
import { PreviewEditor } from "./preview-editor";
import { processStore } from "./process-store";
import { CompactLayoutContext } from "@/components/compact-layout";
import { ResourceProcessRow } from "./process-row";

export function ResourcesView() {
  const connection = useContext(TerminalConnectionContext);
  // Discard confirmations when the selected machine changes.
  return <ResourceContent key={connection ? processStore(connection).scope : "offline"} />;
}

function ResourceContent() {
  const compact = useContext(CompactLayoutContext);
  const { connection, snapshot, error: processError, loading, refresh } = useProcesses();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("memory");
  const [processLimit, setProcessLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<MachineProcess | null>(null);
  const [preview, setPreview] = useState<MachineProcess | null>(null);
  const { links, setLink, removeLink } = usePreviewLinks(connection);
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
  const stop = async (item: MachineProcess) => {
    if (!connection || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await connection.requestResource(
        { kind: "stop", id: item.id },
        newRequestId(),
      );
      if (!alive.current) return;
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
      if (result.outcome.status === "done") {
        setMessage(result.outcome.message);
        setAction(null);
        void refresh();
      }
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : "Could not stop process.");
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const filtered = (snapshot?.processes ?? [])
    .filter((item) =>
      [item.name, item.pid, item.directory ?? ""]
        .join(" ")
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
  const openPreview = (item: MachineProcess) => {
    const link = links[item.id];
    if (link) void openExternal(link.url).catch((cause: unknown) => setError(String(cause)));
    else setPreview(item);
  };
  return (
    <div
      className={
        compact ? "space-y-4 py-2" : "mx-auto w-full max-w-4xl space-y-5 px-4 py-6 sm:px-6"
      }
    >
      {!compact && <h2 className="text-base font-medium">Resources</h2>}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Filter resources"
          placeholder="Filter by process, PID, or folder…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1"
        />
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
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          disabled={!supported || busy || loading}
          onClick={() => void refresh()}
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
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
            onChangePreview={() => setPreview(item)}
            onStop={() => {
              setAction(item);
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
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Stop process?</DialogTitle>
            <DialogDescription>
              Send a graceful termination request to this process only. Unsaved in-memory work may
              be lost. Child processes can remain; no force-kill is sent.
            </DialogDescription>
          </DialogHeader>
          {action && (
            <p className="text-sm break-all">
              {action.name} · PID {action.pid}
              <br />
              {action.directory}
            </p>
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
              disabled={!supported || busy}
              onClick={() => {
                if (action) void stop(action);
              }}
            >
              {busy ? "Working…" : "Stop process"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {preview && (
        <PreviewEditor
          key={preview.id}
          name={links[preview.id]?.name ?? preview.name}
          url={links[preview.id]?.url ?? ""}
          onClose={() => setPreview(null)}
          onSave={(name, url) => {
            setLink(preview.id, url, name);
            setPreview(null);
          }}
          {...(links[preview.id]
            ? {
                onRemove: () => {
                  removeLink(preview.id);
                  setPreview(null);
                },
              }
            : {})}
        />
      )}
    </div>
  );
}

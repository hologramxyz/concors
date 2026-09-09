import { useContext, useEffect, useId, useRef, useState } from "react";
import type { FileEntry, WorkspaceProject } from "@concors/protocol";
import { FilePlus2, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TerminalConnectionContext } from "@/terminal/connection-context";

export function CreateEntry({
  project,
  kind,
  onCreated,
  onCancel,
}: {
  project: WorkspaceProject;
  kind: "file" | "directory";
  onCreated(entry: FileEntry): void;
  onCancel(): void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const id = useId();
  const label = kind === "file" ? "New file path" : "New folder path";
  const Icon = kind === "file" ? FilePlus2 : FolderPlus;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return (
    <form
      className="mx-2 mb-2 space-y-2 rounded-md border p-2"
      aria-label={kind === "file" ? "Create file" : "Create folder"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (!busy) onCancel();
        }
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const workspace = connection?.workspace;
        if (busy || !path.trim()) return;
        if (!workspace || connection.state.status !== "ready") {
          setError("Reconnect to create files and folders.");
          return;
        }
        setBusy(true);
        setError(null);
        try {
          const { outcome } = await connection.requestFile(
            {
              kind: "create",
              projectId: project.id,
              epoch: workspace.epoch,
              path: path.trim(),
              entryKind: kind,
            },
            crypto.randomUUID(),
          );
          if (outcome.status !== "created")
            throw new Error(
              "message" in outcome ? outcome.message : "Could not create this entry.",
            );
          if (active.current) onCreated(outcome.entry);
        } catch (cause) {
          if (active.current)
            setError(cause instanceof Error ? cause.message : "Could not create this entry.");
        } finally {
          if (active.current) setBusy(false);
        }
      }}
    >
      <label htmlFor={id} className="flex items-center gap-2 text-ui">
        <Icon className="size-4 text-muted-foreground" />{" "}
        {kind === "file" ? "New file" : "New folder"}
      </label>
      <input
        id={id}
        aria-label={label}
        autoFocus
        disabled={busy}
        value={path}
        placeholder={kind === "file" ? "src/new-file.ts" : "new-folder"}
        onChange={(event) => {
          setPath(event.target.value);
          setError(null);
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className="h-8 w-full min-w-0 rounded-md border bg-transparent px-2 text-ui outline-none focus-visible:ring-1 focus-visible:ring-primary"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          Path relative to {project.name}.
        </p>
      )}
      <div className="flex justify-end gap-1">
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !path.trim()}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </form>
  );
}

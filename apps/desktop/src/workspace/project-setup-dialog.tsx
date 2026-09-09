import { FolderPicker } from "./folder-picker";
import { useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ProjectSetup } from "@concors/protocol";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ProjectSetupDialog({
  onClose,
  onAdded,
  mode,
}: {
  mode: "open" | "clone";
  onClose: () => void;
  onAdded: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [repository, setRepository] = useState("");
  const [customDirectory, setCustomDirectory] = useState<string | null>(null);
  const folderName =
    repository
      .trim()
      .split(/[/:]/)
      .at(-1)
      ?.replace(/\.git$/, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 100) ?? "";
  const defaultDirectory = mode === "open" ? "" : folderName ? `~/repos/${folderName}` : "";
  const [setups, setSetups] = useState<ProjectSetup[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const connected = useSyncExternalStore(
    (notify) => connection?.subscribe(notify) ?? (() => undefined),
    () => connection?.state.status === "ready",
  );
  useEffect(() => {
    if (!connection) return;
    const a = connection.subscribeProjectSetups(setSetups);
    return () => {
      a();
    };
  }, [connection]);
  const active = setups.find((s) => s.id === activeId);
  useEffect(() => {
    if (active?.status === "done") onAdded();
  }, [active?.status, onAdded]);
  const busy = pending || active?.status === "working";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>{mode === "open" ? "Open folder" : "Clone repository"}</DialogTitle>
          <DialogDescription>
            Choose a folder on the selected machine. Its name becomes your workspace name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connection?.workspace) return;

            const id = crypto.randomUUID();
            setPending(true);
            setError(null);
            setActiveId(id);
            void connection
              .requestProject(
                {
                  kind: "start",
                  epoch: connection.workspace.epoch,
                  id,
                  mode,
                  directory: customDirectory ?? defaultDirectory,
                  repository,
                },
                crypto.randomUUID(),
              )
              .then((result) => {
                if (result.outcome.status === "error") throw new Error(result.outcome.message);
              })
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : "Could not start project setup"),
              )
              .finally(() => setPending(false));
          }}
        >
          {mode === "open" && (
            <FolderPicker disabled={busy || !connected} onChange={setCustomDirectory} />
          )}
          {mode === "clone" && (
            <label className="block space-y-2 text-sm">
              <span>Repository URL or local path</span>
              <Input
                name="repository"
                value={repository}
                onChange={(event) => setRepository(event.target.value)}
                required
                maxLength={4096}
                placeholder="https://github.com/owner/repository.git"
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">
                Uses Git credentials already configured on this machine.
              </span>
            </label>
          )}
          {mode === "clone" && (
            <label className="block space-y-2 text-sm">
              <span>Destination folder</span>
              <Input
                name="directory"
                required
                maxLength={4096}
                value={customDirectory ?? defaultDirectory}
                onChange={(event) => setCustomDirectory(event.target.value)}
                placeholder="~/repos/my-project"
                disabled={busy}
              />
              <span className="text-xs text-muted-foreground">
                A new folder in ~/repos by default. Existing folders are never overwritten.
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={!connection || !connected || busy || !(customDirectory ?? defaultDirectory)}
            >
              {busy ? "Opening…" : mode === "open" ? "Open folder" : "Clone repository"}
            </Button>
          </div>
        </form>
        {active && (
          <section aria-label="Current project setup" className="space-y-2 border-t pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span>
                {active.status === "working" ? "Setting up your project…" : active.status}
              </span>
              {active.status === "working" && (
                <button
                  type="button"
                  className="text-destructive"
                  disabled={!connected}
                  onClick={() => {
                    if (!connection) return;
                    void connection
                      .requestProject({ kind: "cancel", id: active.id }, crypto.randomUUID())
                      .then((result) => {
                        if (result.outcome.status === "error") setError(result.outcome.message);
                      })
                      .catch((cause: unknown) =>
                        setError(cause instanceof Error ? cause.message : "Could not cancel"),
                      );
                  }}
                >
                  Cancel setup
                </button>
              )}
            </div>
            <pre
              className="max-h-32 overflow-auto break-all whitespace-pre-wrap"
              role={active.status === "failed" ? "alert" : undefined}
            >
              {active.progress}
            </pre>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

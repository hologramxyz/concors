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
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [mode, setMode] = useState<ProjectSetup["mode"]>("open");
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
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            Work with folders on the selected machine. Setup continues if you close this window.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!connection?.workspace) return;
            const data = new FormData(event.currentTarget);
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
                  name: String(data.get("name")),
                  directory: String(data.get("directory")),
                  repository: String(data.get("repository") ?? ""),
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
          <label className="block space-y-2 text-sm">
            <span>Project source</span>
            <select
              aria-label="Project source"
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as ProjectSetup["mode"])}
              className="w-full rounded border bg-background px-3 py-2"
            >
              <option value="open">Open existing folder</option>
              <option value="create">Create new folder</option>
              <option value="clone">Clone repository</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm">
            <span>Project name</span>
            <Input name="name" required maxLength={120} disabled={busy} />
          </label>
          {mode === "clone" && (
            <label className="block space-y-2 text-sm">
              <span>Repository URL or local path</span>
              <Input
                name="repository"
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
          <label className="block space-y-2 text-sm">
            <span>Folder on this machine</span>
            <Input
              name="directory"
              required
              maxLength={4096}
              placeholder="/home/me/projects/my-project"
              disabled={busy}
            />
            <span className="text-xs text-muted-foreground">
              {mode === "open"
                ? "Use an existing absolute folder path."
                : "Use a new absolute folder path inside an existing parent. Existing folders are never overwritten."}
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={!connection || !connected || busy}>
              {busy ? "Setting up…" : "Add project"}
            </Button>
          </div>
        </form>
        {setups.length > 0 && (
          <section aria-label="Project setup history" className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-medium">Recent project setups</h3>
            {[...setups].reverse().map((setup) => (
              <div key={setup.id} className="rounded border p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong>
                    {setup.name} · {setup.status}
                  </strong>
                  {setup.status === "working" && (
                    <button
                      className="text-destructive"
                      disabled={!connected}
                      onClick={() => {
                        if (!connection) return;
                        void connection
                          .requestProject({ kind: "cancel", id: setup.id }, crypto.randomUUID())
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
                <p className="mt-1 truncate text-muted-foreground" title={setup.directory}>
                  {setup.directory}
                </p>
                <pre
                  className="mt-2 max-h-32 overflow-auto font-mono break-all whitespace-pre-wrap"
                  role={setup.status === "failed" ? "alert" : undefined}
                >
                  {setup.progress}
                </pre>
              </div>
            ))}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

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
  const [name, setName] = useState("");
  const [customDirectory, setCustomDirectory] = useState<string | null>(null);
  const folderName = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
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
              onChange={(e) => {
                setMode(e.target.value as ProjectSetup["mode"]);
                setCustomDirectory(null);
              }}
              className="w-full rounded border bg-background px-3 py-2"
            >
              <option value="open">Open existing folder</option>
              <option value="create">Create new folder</option>
              <option value="clone">Clone repository</option>
            </select>
          </label>
          <label className="block space-y-2 text-sm">
            <span>Project name</span>
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={120}
              disabled={busy}
            />
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
              value={customDirectory ?? defaultDirectory}
              onChange={(event) => setCustomDirectory(event.target.value)}
              placeholder={
                mode === "open" ? "my-project or ~/repos/my-project" : "~/repos/my-project"
              }
              disabled={busy}
            />
            <span className="text-xs text-muted-foreground">
              {mode === "open"
                ? "Enter a folder name inside repos, or a path to an existing folder on this machine."
                : "Defaults to this machine’s ~/repos folder. You can enter just a folder name, or choose another path."}
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

import { ArrowLeft, ArrowRight, Check, Folder, GitBranch, LoaderCircle } from "lucide-react";
import { prepareClone } from "@/github/prepare-clone";
import { api } from "@/auth/api";
import { GitHubRepositoryPicker } from "@/github/repository-picker";
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
  open = true,
  mode,
  machineId = "local",
  githubEnabled = true,
}: {
  machineId?: string;
  githubEnabled?: boolean;
  mode: "open" | "clone";
  onClose: () => void;
  onAdded: () => void;
  open?: boolean;
}) {
  const connection = useContext(TerminalConnectionContext);
  const [step, setStep] = useState<"repository" | "destination">("repository");
  const [repository, setRepository] = useState("");
  const [source, setSource] = useState<"github" | "url">(githubEnabled ? "github" : "url");
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
    if (open && active?.status === "done") onAdded();
  }, [open, active?.status, onAdded]);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setActiveId(null);
      setStep("repository");
      setSource("github");
      setRepository("");
      setCustomDirectory(null);
      setError(null);
    }
  }
  const busy = pending || active?.status === "working";
  const choosing = mode === "clone" && step === "repository";
  const selectRepository = (value: string) => {
    if (value !== repository) setCustomDirectory(null);
    setRepository(value);
    setError(null);
  };
  const progress = active && (
    <section aria-label="Current project setup" className="space-y-2 rounded-xl border p-4 text-xs">
      <div className="flex items-center justify-between">
        <span>{active.status === "working" ? "Setting up your project…" : active.status}</span>
        {active.status === "working" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
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
          </Button>
        )}
      </div>
      <pre
        className="max-h-32 overflow-auto break-all whitespace-pre-wrap"
        role={active.status === "failed" ? "alert" : undefined}
      >
        {active.progress}
      </pre>
    </section>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent
        size={mode === "clone" ? "wide" : "default"}
        className={
          mode === "clone"
            ? "h-[min(680px,calc(100dvh-2rem))] max-w-4xl gap-0 overflow-hidden p-0"
            : undefined
        }
      >
        <DialogHeader className={mode === "clone" ? "border-b px-6 py-5 pr-14" : undefined}>
          <DialogTitle>{mode === "open" ? "Open folder" : "Clone repository"}</DialogTitle>
          <DialogDescription>
            {mode === "clone"
              ? "Bring a repository into your workspace."
              : "Choose a folder on the selected machine. Its name becomes your workspace name."}
          </DialogDescription>
          {mode === "clone" && (
            <ol aria-label="Clone steps" className="mt-3 flex items-center gap-3 text-xs">
              <li
                aria-current={choosing ? "step" : undefined}
                className={`flex items-center gap-2 ${choosing ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="flex size-5 items-center justify-center rounded-full border">
                  {choosing ? "1" : <Check className="size-3" />}
                </span>
                Repository
              </li>
              <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
              <li
                aria-current={!choosing ? "step" : undefined}
                className={`flex items-center gap-2 ${!choosing ? "text-foreground" : "text-muted-foreground"}`}
              >
                <span className="flex size-5 items-center justify-center rounded-full border">
                  2
                </span>
                Destination
              </li>
            </ol>
          )}
        </DialogHeader>
        <form
          className={mode === "clone" ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            if (choosing) {
              if (repository.trim()) {
                setStep("destination");
                setError(null);
              }
              return;
            }
            if (!connection?.workspace) return;
            const epoch = connection.workspace.epoch;
            const id = crypto.randomUUID();
            setPending(true);
            setError(null);
            setActiveId(id);
            void (async () => {
              const cloneUrl =
                mode === "clone" && githubEnabled
                  ? await prepareClone(api, machineId, repository)
                  : repository;
              return connection.requestProject(
                {
                  kind: "start",
                  epoch,
                  id,
                  mode,
                  directory: customDirectory ?? defaultDirectory,
                  repository: cloneUrl,
                },
                crypto.randomUUID(),
              );
            })()
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
            <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
              {/* Keep the picker mounted while choosing the destination so Back retains rows, search and scroll. */}
              <div className={choosing ? "flex min-h-0 flex-1 flex-col gap-3" : "hidden"}>
                {githubEnabled && (
                  <div className="flex shrink-0 gap-1" aria-label="Repository source">
                    <Button
                      type="button"
                      size="sm"
                      variant={source === "github" ? "secondary" : "ghost"}
                      aria-pressed={source === "github"}
                      onClick={() => setSource("github")}
                    >
                      GitHub repositories
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={source === "url" ? "secondary" : "ghost"}
                      aria-pressed={source === "url"}
                      onClick={() => setSource("url")}
                    >
                      Paste a URL
                    </Button>
                  </div>
                )}
                {githubEnabled && (
                  <div className={source === "github" ? "min-h-0 flex-1" : "hidden"}>
                    <GitHubRepositoryPicker
                      selected={repository}
                      onSelect={selectRepository}
                      disabled={busy || !choosing}
                    />
                  </div>
                )}
                {source === "url" && (
                  <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 rounded-xl border bg-muted/20 p-6">
                    <GitBranch className="size-7 text-muted-foreground" aria-hidden="true" />
                    <label className="block space-y-2 text-sm">
                      <span>Repository URL or local path</span>
                      <Input
                        name="repository"
                        value={repository}
                        onChange={(event) => selectRepository(event.target.value)}
                        maxLength={4096}
                        placeholder="https://github.com/owner/repository.git"
                        disabled={busy || !choosing}
                        className="h-10"
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Paste a Git URL, or a repository path on this machine.
                    </p>
                  </div>
                )}
              </div>
              {!choosing && (
                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-3">
                  <div>
                    <h3 className="text-base font-medium">Where should we clone it?</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Choose a new folder on this machine.
                    </p>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-4">
                    <GitBranch className="size-5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium">
                      {repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")}
                    </span>
                  </div>
                  <label className="block space-y-2 text-sm">
                    <span className="inline-flex items-center gap-2">
                      <Folder className="size-4" />
                      Destination folder
                    </span>
                    <Input
                      name="directory"
                      autoFocus
                      required
                      maxLength={4096}
                      value={customDirectory ?? defaultDirectory}
                      onChange={(event) => setCustomDirectory(event.target.value)}
                      placeholder="~/repos/my-project"
                      disabled={busy}
                      className="h-10 font-mono"
                    />
                    <span className="block text-xs text-muted-foreground">
                      Existing folders are never overwritten.
                    </span>
                  </label>
                  {machineId === "local" && (
                    <p className="text-xs text-muted-foreground">
                      {githubEnabled
                        ? "Cloning on this computer uses its local Git credentials."
                        : "Cloning uses Git credentials on the connected desktop."}
                    </p>
                  )}
                  {progress}
                </div>
              )}
            </div>
          )}
          <div className={mode === "clone" ? "shrink-0 border-t bg-muted/20 px-6 py-4" : ""}>
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-center justify-between gap-2">
              <div>
                {mode === "clone" && !choosing && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setStep("repository");
                      setError(null);
                    }}
                  >
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={
                    busy ||
                    (choosing
                      ? !repository.trim()
                      : !connection || !connected || !(customDirectory ?? defaultDirectory))
                  }
                >
                  {busy && <LoaderCircle className="size-4 animate-spin" />}
                  {busy
                    ? mode === "clone"
                      ? "Cloning…"
                      : "Opening…"
                    : mode === "open"
                      ? "Open folder"
                      : choosing
                        ? "Continue"
                        : "Clone repository"}
                  {choosing && <ArrowRight className="size-4" />}
                </Button>
              </div>
            </div>
          </div>
        </form>
        {mode === "open" && progress}
      </DialogContent>
    </Dialog>
  );
}

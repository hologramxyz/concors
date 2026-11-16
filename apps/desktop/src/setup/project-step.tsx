import { useContext, useEffect, useState } from "react";
import { Check, Folder, FolderOpen, GitBranch, Plus } from "lucide-react";
import {
  RECENT_AGENT_FOLDERS_CAPABILITY,
  agentProviderName,
  folderName,
  type ProjectSetup,
  type RecentAgentFolder,
} from "@concors/protocol";
import type { DaemonConnection } from "@concors/daemon-client";
import { Button } from "@/components/ui/button";
import { shortAge } from "@/lib/format-date";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { StepFrame, WaitingForMachine } from "./frame";

/** Third step: the first project, from folders an agent was already used in, or opened, cloned or new. */
export function ProjectStep({
  banner,
  onOpenFolder,
  onClone,
  onNewWorkspace,
  newWorkspaceBusy,
  onBack,
  onNext,
  onSkip,
}: {
  banner?: React.ReactNode;
  onOpenFolder: () => void;
  onClone: () => void;
  onNewWorkspace: () => void;
  newWorkspaceBusy: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const ready = connection?.state.status === "ready" ? connection : null;
  const projects = ready?.workspace?.projects ?? [];
  const added = new Set(projects.map((project) => project.directory));
  const suggestions = useRecentFolders(ready).filter((folder) => !added.has(folder.directory));
  const [checked, setChecked] = useState<ReadonlySet<string> | null>(null);
  // The most recent folder starts ticked, so the main button already adds something useful.
  const ticked = checked ?? new Set(suggestions.slice(0, 1).map((folder) => folder.directory));
  const chosen = suggestions.filter((folder) => ticked.has(folder.directory));
  const adding = useAddFolders();
  const [now] = useState(() => Date.now());
  const primary = chosen.length
    ? {
        label: `Add ${chosen.length} ${chosen.length === 1 ? "project" : "projects"}`,
        busy: adding.busy,
        onClick: () => void adding.add(chosen.map((folder) => folder.directory)),
      }
    : {
        label: projects.length || !ready ? "Continue" : "Continue without a project",
        onClick: onNext,
      };
  return (
    <StepFrame
      step={2}
      title={projects.length ? "Your projects" : "Add your first project"}
      description={
        suggestions.length
          ? "These are folders where you already used Claude Code or Codex on this machine. Pick the ones your agents should work in, or bring another."
          : "Agents work inside a project folder. Open one on this machine, clone a repository, or start an empty one."
      }
      banner={banner}
      primary={primary}
      onBack={onBack}
      onSkip={onSkip}
    >
      {!ready ? (
        <WaitingForMachine />
      ) : (
        <div className="space-y-4">
          {(projects.length > 0 || suggestions.length > 0) && (
            <ul aria-label="Projects" className="divide-y rounded-xl border">
              {projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-4 py-3">
                  <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{project.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {project.directory}
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Check className="size-3.5 text-emerald-600" aria-hidden="true" />
                    Added
                  </span>
                </li>
              ))}
              {suggestions.map((folder) => {
                const on = ticked.has(folder.directory);
                return (
                  <li key={folder.directory}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/40">
                      <input
                        type="checkbox"
                        className="size-4 accent-foreground"
                        checked={on}
                        disabled={adding.busy}
                        onChange={() => {
                          const next = new Set(ticked);
                          if (on) next.delete(folder.directory);
                          else next.add(folder.directory);
                          setChecked(next);
                        }}
                      />
                      <Folder
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {folderName(folder.directory)}
                        </span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {folder.directory}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {agentProviderName(folder.provider)}, {shortAge(folder.updatedAt, now)} ago
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {adding.error && (
            <p role="alert" className="text-sm text-destructive">
              {adding.error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onOpenFolder}>
              <FolderOpen aria-hidden="true" />
              Open a folder…
            </Button>
            <Button variant="outline" size="sm" onClick={onClone}>
              <GitBranch aria-hidden="true" />
              Clone a repository…
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={newWorkspaceBusy}
              onClick={onNewWorkspace}
            >
              <Plus aria-hidden="true" />
              New empty workspace
            </Button>
          </div>
        </div>
      )}
    </StepFrame>
  );
}

/** Folders the machine's agent CLIs were used in, when its daemon can say. */
function useRecentFolders(connection: DaemonConnection | null) {
  const [folders, setFolders] = useState<RecentAgentFolder[]>([]);
  const supported =
    connection?.state.status === "ready" &&
    !!connection.state.daemon.capabilities?.includes(RECENT_AGENT_FOLDERS_CAPABILITY);
  useEffect(() => {
    if (!connection || !supported) return;
    let current = true;
    void connection
      .requestProvider({ kind: "recent-folders" }, crypto.randomUUID())
      .then((result) => {
        if (current && result.outcome.status === "ok") setFolders(result.outcome.folders ?? []);
      })
      // Suggestions are a convenience: without them the step still offers every other way in.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [connection, supported]);
  return folders;
}

/** Opens folders as workspaces the way Open folder does, waiting until each is set up. */
function useAddFolders() {
  const connection = useContext(TerminalConnectionContext);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (directories: readonly string[]) => {
    const workspace = connection?.workspace;
    if (!connection || !workspace) return;
    setBusy(true);
    setError(null);
    const ids = new Set<string>();
    let stop: () => void = () => undefined;
    const settled = new Promise<ProjectSetup[]>((resolve) => {
      stop = connection.subscribeProjectSetups((setups) => {
        const ours = setups.filter((setup) => ids.has(setup.id));
        if (ours.length === ids.size && ours.every((setup) => setup.status !== "working")) {
          stop();
          resolve(ours);
        }
      });
    });
    try {
      for (const directory of directories) {
        const id = crypto.randomUUID();
        ids.add(id);
        const result = await connection.requestProject(
          { kind: "start", epoch: workspace.epoch, id, mode: "open", directory, repository: "" },
          crypto.randomUUID(),
        );
        if (result.outcome.status === "error") throw new Error(result.outcome.message);
      }
      const failed = (await settled).filter((setup) => setup.status !== "done");
      if (failed.length)
        setError(
          `Could not open ${failed.map((setup) => folderName(setup.directory)).join(", ")}.`,
        );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the projects");
    } finally {
      stop();
      setBusy(false);
    }
  };
  return { add, busy, error };
}

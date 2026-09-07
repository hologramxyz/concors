import { describeDaemonEndpoint, type DaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { Bot, Server } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { ConnectionStatus } from "@/components/connection-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveStartupEndpoint } from "@/daemon/resolve-endpoint";
import { useDaemonConnection } from "@/daemon/use-daemon-connection";
import { navItemFor, type View } from "@/navigation";
import { useTheme } from "@/theme/use-theme";
import { SettingsView } from "@/views/settings-view";
import { FormDialog } from "@/workspace/form-dialog";
import {
  MACHINES_STORAGE_KEY,
  parseMachineConnections,
  type MachineConnection,
} from "@/workspace/machines";
import { ProjectWorkspace } from "@/workspace/project-workspace";

const LOCAL_ID = "00000000-0000-4000-8000-000000000000";
function savedMachines() {
  try {
    return parseMachineConnections(localStorage.getItem(MACHINES_STORAGE_KEY));
  } catch {
    return [];
  }
}

export function App() {
  const [view, setView] = useState<View>("projects");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState<DaemonEndpoint | null>(null);
  const [bookmarks, setBookmarks] = useState<MachineConnection[]>(savedMachines);
  const [selectedMachineId, setSelectedMachineId] = useState(LOCAL_ID);
  const [addingProject, setAddingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [endpoint, setEndpoint] = useState<DaemonEndpoint | null>(null);
  const connection = useDaemonConnection(endpoint);
  const theme = useTheme();
  const machines = localEndpoint
    ? [{ id: LOCAL_ID, name: "This computer", url: localEndpoint.url }, ...bookmarks]
    : bookmarks;
  const workspace = connection.workspace;
  const canEdit = connection.state.status === "ready" && connection.workspaceReady && !pending;

  useEffect(() => {
    let cancelled = false;
    void resolveStartupEndpoint()
      .then((resolved) => {
        if (!cancelled) {
          setLocalEndpoint(resolved);
          setEndpoint(resolved);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not connect to this computer");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const execute = async (operation: WorkspaceOperation) => {
    setPending(true);
    try {
      await connection.execute(operation);
    } finally {
      setPending(false);
    }
  };
  const command = (operation: WorkspaceOperation) => {
    setError(null);
    void execute(operation).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update workspace"),
    );
  };
  const selectMachine = (id: string) => {
    const machine = machines.find((item) => item.id === id);
    if (!machine) return;
    setEndpoint(describeDaemonEndpoint(machine.url));
    setSelectedMachineId(id);
    setView("projects");
    setError(null);
    setAddingProject(false);
  };
  const activeProject = workspace?.projects.find(
    (project) => project.id === workspace.selection?.projectId,
  );

  return (
    <TooltipProvider>
      <div className="flex h-dvh w-full overflow-hidden">
        <AppSidebar
          view={view}
          onNavigate={setView}
          onOpenCommandPalette={openPalette}
          workspace={workspace}
          canEdit={canEdit}
          onSelectProject={(id) => {
            setView("projects");
            const project = workspace?.projects.find((p) => p.id === id);
            command({ kind: "selection.set", projectId: id, tabId: project?.tabs[0]?.id ?? null });
          }}
          onAddProject={() => setAddingProject(true)}
          machines={machines}
          selectedMachineId={selectedMachineId}
          onSelectMachine={selectMachine}
          onAddMachine={(machine) => {
            if (machines.some((existing) => existing.url === machine.url))
              throw new Error("This machine connection is already saved");
            if (bookmarks.length >= 32)
              throw new Error("You can save up to 32 machine connections");
            const next = [...bookmarks, machine];
            localStorage.setItem(MACHINES_STORAGE_KEY, JSON.stringify(next));
            setBookmarks(next);
            setEndpoint(describeDaemonEndpoint(machine.url));
            setSelectedMachineId(machine.id);
            setView("projects");
          }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b px-4">
            <h1 className="truncate text-[13px] font-medium">
              {view === "projects" && activeProject ? activeProject.name : navItemFor(view).label}
            </h1>
            <ConnectionStatus
              state={connection.state}
              endpoint={endpoint}
              onReconnect={connection.reconnectNow}
            />
          </header>
          {error && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
            >
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)}>
                Dismiss
              </button>
            </div>
          )}
          {workspace && !connection.workspaceReady && (
            <div
              role="status"
              className="border-b bg-muted px-4 py-2 text-xs text-muted-foreground"
            >
              Reconnecting… Showing the last saved workspace. Editing resumes when connected.
            </div>
          )}
          <main className="min-h-0 flex-1 overflow-auto">
            {view === "settings" ? (
              <SettingsView
                endpoint={endpoint}
                state={connection.state}
                theme={theme.preference}
                onSetTheme={theme.setPreference}
              />
            ) : view === "projects" ? (
              workspace ? (
                <ProjectWorkspace
                  workspace={workspace}
                  canEdit={canEdit}
                  onCommand={command}
                  execute={execute}
                  onAddProject={() => setAddingProject(true)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <h2 className="text-lg font-medium">Connect to your workspace</h2>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Your projects and layouts will appear when this machine is connected.
                  </p>
                  <button
                    type="button"
                    onClick={connection.reconnectNow}
                    className="text-sm text-primary"
                  >
                    Reconnect
                  </button>
                </div>
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                {view === "agents" ? (
                  <Bot className="size-10 text-muted-foreground/50" />
                ) : (
                  <Server className="size-10 text-muted-foreground/50" />
                )}
                <h2 className="text-lg font-medium">
                  {view === "agents" ? "All your agents" : "Your development servers"}
                </h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {view === "agents"
                    ? "Agent sessions and live status across projects will appear here when agent execution is connected."
                    : "Automatic server discovery and preview links will be available in a later milestone."}
                </p>
              </div>
            )}
          </main>
        </div>
      </div>
      {addingProject && (
        <FormDialog
          title="Add project"
          description="Register an existing folder on this machine. This saves its workspace; it does not create or clone files yet."
          fields={[
            { name: "name", label: "Project name", placeholder: "My project" },
            {
              name: "directory",
              label: "Folder on this machine",
              placeholder: "/home/me/projects/my-project",
            },
          ]}
          submitLabel="Add project"
          onClose={() => setAddingProject(false)}
          onSubmit={async (values) => {
            await execute({
              kind: "project.add",
              projectId: crypto.randomUUID(),
              name: values["name"] ?? "",
              directory: values["directory"] ?? "",
            });
            setView("projects");
          }}
        />
      )}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNavigate={setView}
        onReconnect={connection.reconnectNow}
        canReconnect={
          connection.state.status === "disconnected" || connection.state.status === "error"
        }
        onSetTheme={theme.setPreference}
      />
    </TooltipProvider>
  );
}

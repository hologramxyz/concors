import { FilesSidebar } from "@/files/sidebar";
import { FilesProvider } from "@/files/provider";
import { useCommand } from "@/shortcuts/context";
import { ShortcutProvider } from "@/shortcuts/provider";
import { findSessionPane, type PaneFocusRequest } from "@/workspace/session-pane";
import { NotificationProvider } from "@/notifications/provider";
import { AgentsProvider } from "@/agents/state";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { TerminalProfilesContext } from "@/terminal/profiles-context";
import { DEFAULT_TERMINAL_PROFILES } from "@concors/protocol";
import type { DaemonEndpoint } from "@concors/daemon-client";
import type { WorkspaceOperation } from "@concors/protocol";
import { PanelLeftOpen, Server } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";

import { api } from "@/auth/api";
import { AuthScreen } from "@/auth/auth-screen";
import { activeOrganization, describeAuthError } from "@/auth/auth-state";
import { useAuth } from "@/auth/use-auth";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MachinesView } from "@/machines/machines-view";
import { TooltipProvider } from "@/components/ui/tooltip";
import { resolveStartupEndpoint, resolveHostEndpoint } from "@/daemon/resolve-endpoint";
import { useDaemonConnection } from "@/daemon/use-daemon-connection";
import { navItemFor, type View } from "@/navigation";
import { settingsNavItemFor, type SettingsPage } from "@/settings/navigation";
import { SettingsSidebar } from "@/settings/settings-sidebar";
import { useTheme } from "@/theme/use-theme";
import { useCornerStyle } from "@/theme/use-corner-style";
import { SettingsView } from "@/views/settings-view";
import { useNewWorkspace } from "@/workspace/use-new-workspace";
import { ProjectSetupDialog } from "@/workspace/project-setup-dialog";
import { LOCAL_HOST, saveHost, type Host } from "@/workspace/machines";
import { ProjectWorkspace } from "@/workspace/project-workspace";

export function App() {
  const setup = new URLSearchParams(window.location.search).get("setup");
  if (
    window.location.pathname === "/settings/billing" &&
    (setup === "success" || setup === "cancelled")
  ) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-background p-8 text-center text-foreground">
        <h1 className="text-xl font-semibold">
          {setup === "success" ? "Card setup submitted" : "Card setup cancelled"}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Return to your original Concors window to{" "}
          {setup === "success"
            ? "finish creating your VPS. Concors will verify your card with Stripe."
            : "continue. You can add a card again when you’re ready."}
        </p>
        <p className="text-xs text-muted-foreground">You can close this tab.</p>
      </div>
    );
  }
  return (
    <ShortcutProvider>
      <AppContent />
    </ShortcutProvider>
  );
}
function AppContent() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    requestAnimationFrame(() =>
      document.getElementById(collapsed ? "expand-sidebar" : "collapse-sidebar")?.focus(),
    );
  };
  const lastTabs = useRef(new Map<string, string>());
  const lastPanes = useRef(new Map<string, string>());
  const [paneFocus, setPaneFocus] = useState<PaneFocusRequest | null>(null);
  const [view, setView] = useState<View>(() =>
    window.location.pathname === "/settings/billing" ? "settings" : "projects",
  );
  const [creatingMachine, setCreatingMachine] = useState(false);
  const [focusedCloudMachineId, setFocusedCloudMachineId] = useState<string | null>(null);
  const [creatingTerminalProfile, setCreatingTerminalProfile] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>(() =>
    window.location.pathname === "/settings/billing" ? "billing" : "account",
  );
  const settingsReturnView = useRef<Exclude<View, "settings">>("projects");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [localEndpoint, setLocalEndpoint] = useState<DaemonEndpoint | null>(null);
  const [selectionHost, setSelectionHost] = useState<{ scope: string; host: Host } | null>(null);
  const [addingProject, setAddingProject] = useState<"open" | "clone" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const theme = useTheme();
  const corners = useCornerStyle();
  const auth = useAuth(api);
  const hostScope =
    auth.state.status === "signed-in"
      ? `${auth.state.user.id}:${activeOrganization(auth.state)?.id ?? ""}`
      : "";
  const selectedHost = selectionHost?.scope === hostScope ? selectionHost.host : LOCAL_HOST;
  const selectedMachineId = selectedHost.machineId;
  const endpoint = useMemo(
    () => resolveHostEndpoint(selectedHost, localEndpoint),
    [selectedHost, localEndpoint],
  );
  const connection = useDaemonConnection(hostScope ? endpoint : null, selectedMachineId, hostScope);
  const workspace = connection.workspace;
  const canEdit = connection.state.status === "ready" && connection.workspaceReady && !pending;
  const selection = workspace?.selection;
  const memoryKey = `${selectedMachineId}:${workspace?.epoch}`;
  useEffect(() => {
    if (!selection?.projectId || !selection.tabId) return;
    lastTabs.current.set(`${memoryKey}:${selection.projectId}`, selection.tabId);
    if (view !== "projects") return;
    const tab = workspace?.projects
      .find((p) => p.id === selection.projectId)
      ?.tabs.find((t) => t.id === selection.tabId);
    const remembered = lastPanes.current.get(`${memoryKey}:${selection.tabId}`);
    const pane =
      tab?.nodes.find((n) => n.kind === "pane" && n.id === remembered) ??
      tab?.nodes.find((n) => n.kind === "pane");
    if (pane)
      setPaneFocus({
        projectId: selection.projectId,
        tabId: selection.tabId,
        paneId: pane.id,
        requestId: crypto.randomUUID(),
      });
    // Restore focus only when navigating, not on background layout/session updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryKey, selection?.projectId, selection?.tabId, view]);

  useEffect(() => {
    let cancelled = false;
    void resolveStartupEndpoint()
      .then((resolved) => {
        if (!cancelled) {
          setLocalEndpoint(resolved);
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

  const transport = connection.transport;
  const newWorkspace = useNewWorkspace(transport);
  const startWorkspace = () => {
    setView("projects");
    newWorkspace.start();
  };
  const openAgent = useCallback(
    (id: string) => {
      const target = findSessionPane(transport?.workspace ?? null, id);
      if (!target) {
        setError("This agent's pane has been closed.");
        return;
      }
      if (!transport?.workspace) return;
      lastPanes.current.set(`${memoryKey}:${target.tabId}`, target.paneId);
      setError(null);
      void transport
        .executeWorkspace({
          type: "workspace.command",
          commandId: crypto.randomUUID(),
          epoch: transport.workspace.epoch,
          operation: { kind: "selection.set", projectId: target.projectId, tabId: target.tabId },
        })
        .then((result) => {
          if (result.outcome.status === "rejected") throw new Error(result.outcome.message);
          setView("projects");
          setPaneFocus({ ...target, requestId: crypto.randomUUID() });
        })
        .catch((cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not open agent pane"),
        );
    },
    [transport, memoryKey],
  );
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const beforeLeaveFiles = useRef<(() => boolean | Promise<boolean>) | null>(null);
  const signOut = async () => {
    if ((await beforeLeaveFiles.current?.()) !== false) void auth.signOut();
  };
  const openSettings = (page: SettingsPage) => {
    if (view !== "settings") settingsReturnView.current = view;
    setSettingsPage(page);
    setView("settings");
  };

  const signedIn = auth.state.status === "signed-in";
  useCommand("search", signedIn, () => setPaletteOpen((open) => !open));
  useCommand("new-project", signedIn && canEdit && !newWorkspace.busy, startWorkspace);
  useCommand("settings", signedIn, () => openSettings("account"));
  useCommand("shortcuts", signedIn, () => openSettings("shortcuts"));

  // Nothing but the sign-in screen exists for a signed-out user. All hooks run above this line.
  if (auth.state.status !== "signed-in") {
    return (
      <AuthScreen
        state={auth.state}
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
        onRetry={() => void auth.refresh()}
      />
    );
  }
  const account = auth.state;
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
  const selectProject = (projectId: string) => {
    const project = workspace?.projects.find((p) => p.id === projectId);
    const remembered = lastTabs.current.get(`${memoryKey}:${projectId}`);
    const tabId =
      project?.tabs.find((tab) => tab.id === remembered)?.id ?? project?.tabs[0]?.id ?? null;
    setView("projects");
    command({ kind: "selection.set", projectId, tabId });
  };
  const selectMachine = (host: Host) => {
    if (beforeLeaveFiles.current?.() === false) return;
    saveHost(hostScope, host);
    setSelectionHost({ scope: hostScope, host });
    setView("projects");
    setError(null);
    setAddingProject(null);
  };
  const activeProject = workspace?.projects.find(
    (project) => project.id === workspace.selection?.projectId,
  );

  const appSidebarCollapsed = view !== "settings" && sidebarCollapsed;
  const sidebarToggle = appSidebarCollapsed && (
    <button
      id="expand-sidebar"
      type="button"
      aria-label="Expand sidebar"
      title="Expand sidebar"
      aria-controls="app-sidebar"
      aria-expanded={false}
      onClick={() => toggleSidebar(false)}
      className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <PanelLeftOpen className="size-4" aria-hidden="true" />
    </button>
  );

  return (
    <TerminalConnectionContext value={connection.transport}>
      <TerminalProfilesContext
        value={{
          profiles: workspace?.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES,
          supported:
            connection.state.status === "ready" &&
            !!connection.state.daemon.capabilities?.includes("terminal-profiles"),
          canEdit:
            canEdit &&
            connection.state.status === "ready" &&
            !!connection.state.daemon.capabilities?.includes("terminal-profiles"),
          execute,
          openSettings: (add = false) => {
            if (view !== "settings") settingsReturnView.current = view;
            setCreatingTerminalProfile(add);
            setSettingsPage("terminals");
            setView("settings");
          },
        }}
      >
        <FilesProvider beforeLeaveRef={beforeLeaveFiles}>
          <NotificationProvider connection={connection.transport} onOpen={openAgent}>
            <AgentsProvider connection={connection.transport}>
              <TooltipProvider>
                <div className="flex h-dvh w-full overflow-hidden bg-sidebar">
                  {view === "settings" ? (
                    <SettingsSidebar
                      page={settingsPage}
                      onBack={() => setView(settingsReturnView.current)}
                      onNavigate={setSettingsPage}
                    />
                  ) : (
                    <AppSidebar
                      collapsed={sidebarCollapsed}
                      onCollapse={() => toggleSidebar(true)}
                      execute={execute}
                      onSelectAgent={openAgent}
                      view={view}
                      onOpenSettings={() => openSettings("account")}
                      onOpenCommandPalette={openPalette}
                      workspace={workspace}
                      canEdit={canEdit && !newWorkspace.busy}
                      onSelectProject={selectProject}
                      onAddProject={startWorkspace}
                      onOpenFolder={setAddingProject}
                      hostScope={hostScope}
                      selectedHost={selectedHost}
                      machineConnected={connection.state.status === "ready"}
                      onSelectMachine={selectMachine}
                      onViewCloud={(machineId) => {
                        setFocusedCloudMachineId(machineId ?? null);
                        setCreatingMachine(false);
                        setView("machines");
                      }}
                      auth={account}
                      onSignOut={signOut}
                    />
                  )}
                  <div
                    className={`workspace-surface my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border bg-background shadow-xs ${appSidebarCollapsed ? "ml-2" : ""}`}
                  >
                    {!(view === "projects" && activeProject) && (
                      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
                        {sidebarToggle}
                        <h1 className="truncate text-ui font-medium">
                          {view === "settings"
                            ? settingsNavItemFor(settingsPage).label
                            : navItemFor(view).label}
                        </h1>
                      </header>
                    )}
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
                    {connection.state.status === "error" && (
                      <div
                        role="alert"
                        className="flex items-center justify-between gap-3 border-b bg-destructive/5 px-4 py-2 text-xs text-destructive"
                      >
                        <span>{connection.state.error.message}</span>
                        <button
                          type="button"
                          className="shrink-0 underline"
                          onClick={connection.reconnectNow}
                        >
                          Retry connection
                        </button>
                      </div>
                    )}
                    {workspace && !connection.workspaceReady && (
                      <div
                        role="status"
                        className="border-b bg-muted px-4 py-2 text-xs text-muted-foreground"
                      >
                        Connection lost. Showing the last saved workspace. Editing resumes when
                        connected.
                      </div>
                    )}
                    <main className="min-h-0 flex-1 overflow-auto">
                      {view === "settings" ? (
                        <SettingsView
                          key={workspace?.machineId ?? endpoint?.url}
                          creatingTerminalProfile={creatingTerminalProfile}
                          onCreatingTerminalProfileChange={setCreatingTerminalProfile}
                          page={settingsPage}
                          endpoint={endpoint}
                          state={connection.state}
                          theme={theme.preference}
                          onSetTheme={theme.setPreference}
                          cornerStyle={corners.preference}
                          onSetCornerStyle={corners.setPreference}
                          auth={account}
                          onSignOut={signOut}
                          onSetActiveOrganization={(organizationId) => {
                            setError(null);
                            void auth
                              .setActiveOrganization(organizationId)
                              .catch((cause: unknown) => setError(describeAuthError(cause)));
                          }}
                        />
                      ) : view === "projects" ? (
                        workspace ? (
                          <ProjectWorkspace
                            sidebarToggle={sidebarToggle}
                            onPaneFocus={(paneId) => {
                              if (selection?.tabId)
                                lastPanes.current.set(`${memoryKey}:${selection.tabId}`, paneId);
                            }}
                            focusRequest={paneFocus}
                            workspace={workspace}
                            canEdit={canEdit && !newWorkspace.busy}
                            onCommand={command}
                            execute={execute}
                            onAddProject={startWorkspace}
                            onOpenFolder={setAddingProject}
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
                      ) : view === "machines" ? (
                        <MachinesView
                          key={activeOrganization(account)?.id}
                          auth={account}
                          focusedMachineId={focusedCloudMachineId}
                          creating={creatingMachine}
                          onCreatingChange={setCreatingMachine}
                        />
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                          <Server className="size-10 text-muted-foreground/50" />
                          <h2 className="text-lg font-medium">Your development servers</h2>
                          <p className="max-w-sm text-sm text-muted-foreground">
                            Automatic server discovery and preview links will be available in a
                            later milestone.
                          </p>
                        </div>
                      )}
                    </main>
                  </div>
                  <FilesSidebar project={view === "projects" ? activeProject : undefined} />
                </div>
                {newWorkspace.error && (
                  <div
                    role="alert"
                    className="fixed bottom-4 left-1/2 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border bg-popover p-3 text-ui shadow-md"
                  >
                    <span>{newWorkspace.error}</span>
                    <button type="button" onClick={newWorkspace.dismiss} className="text-primary">
                      Dismiss
                    </button>
                  </div>
                )}
                {addingProject && (
                  <ProjectSetupDialog
                    mode={addingProject}
                    onClose={() => setAddingProject(null)}
                    onAdded={() => {
                      setAddingProject(null);
                      setView("projects");
                    }}
                  />
                )}
                <CommandPalette
                  canSelectProject={canEdit}
                  projects={workspace?.projects ?? []}
                  onSelectProject={selectProject}
                  open={paletteOpen}
                  onOpenChange={setPaletteOpen}
                  onNavigate={setView}
                  onReconnect={connection.reconnectNow}
                  canReconnect={
                    connection.state.status === "disconnected" ||
                    connection.state.status === "error"
                  }
                  onSetTheme={theme.setPreference}
                  onSignOut={signOut}
                />
              </TooltipProvider>
            </AgentsProvider>
          </NotificationProvider>
        </FilesProvider>
      </TerminalProfilesContext>
    </TerminalConnectionContext>
  );
}

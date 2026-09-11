import { ColorThemeProvider } from "@/theme/color-theme-provider";
import { machineAvailability, machineStatusLabel } from "@concors/client-core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { FolderOpen, Menu, Search, Server } from "lucide-react";
import type { DaemonConnection } from "@concors/daemon-client";
import type { MobileState, MobileTarget } from "@concors/client-core";
import type { PaneProfile, WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
import { ShortcutProvider } from "@/shortcuts/provider";
import { useCommand } from "@/shortcuts/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { TerminalProfilesContext } from "@/terminal/profiles-context";
import { DEFAULT_TERMINAL_PROFILES } from "@concors/protocol";
import { AgentsProvider } from "@/agents/state";
import { CompactLayoutContext, PaneVisibilityContext } from "@/components/compact-layout";
import { NotificationProvider } from "@/notifications/provider";
import { setNotificationPreferences } from "@/notifications/preferences";
import { AgentSidebar } from "@/agents/list";
import { ChatPane } from "@/agents/chat";
import { AgentDraftScopeContext } from "@/agents/draft";
import { TerminalPane } from "@/terminal/terminal-pane";
import { ProjectActions } from "@/workspace/project-actions";
import { ProjectSetupDialog } from "@/workspace/project-setup-dialog";
import { NewWorkspaceMenu } from "@/workspace/new-workspace-menu";
import { useNewWorkspace } from "@/workspace/use-new-workspace";
import { ProjectImage } from "@/workspace/project-image";
import { SidebarSection } from "@/components/sidebar-section";
import { NewTabMenu } from "@/workspace/new-tab-menu";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import { CommandPalette } from "@/components/command-palette";
import { AccountMenu } from "@/components/account-menu";
import { Button } from "@/components/ui/button";
import { embeddedConnection, getHostState, hostAction, subscribeHost } from "./bridge";
import { resolveMobileSelection, tabPanes } from "./selection";
import { useSidebarGesture } from "./sidebar-gesture";
import { SettingsDrawer } from "./settings-drawer";
import { WorkspacePicker } from "./workspace-picker";
import { MobileFiles, MobileFilesProvider } from "./files";
import { fileScope, useFiles } from "@/files/context";
import { ProjectFileLinks } from "@/files/provider";
import { preloadCodeEditor } from "@/files/editor-loader";
import { TabVisibility } from "@/workspace/tab-visibility";
import { MobileSelect } from "./select";
import type { SettingsPage } from "@/settings/navigation";
import { NativeSurfaces } from "./native-surfaces";
import { NativeHeaderButton } from "./native-header-button";

const subscribeState = (listener: () => void) =>
  subscribeHost((message) => {
    if (message.type === "state") listener();
  });
export function MobileApp() {
  const host = useSyncExternalStore(subscribeState, getHostState);
  return host ? (
    <ShortcutProvider>
      <TooltipProvider>
        <NativeSurfaces key={host.scope} host={host}>
          <MobileWorkspace host={host} />
        </NativeSurfaces>
      </TooltipProvider>
    </ShortcutProvider>
  ) : (
    <p role="status" className="p-6 text-sm">
      Opening your workspace…
    </p>
  );
}
function MobileWorkspace({ host }: { host: MobileState }) {
  const connection = useMemo(
    () => (host.connectionId ? embeddedConnection(host.connectionId) : null),
    [host.connectionId],
  );
  return (
    <CompactLayoutContext value={true}>
      <TerminalConnectionContext value={connection}>
        <MobileFilesProvider direct={host.direct}>
          <MobileWorkspaceContent host={host} connection={connection} />
        </MobileFilesProvider>
      </TerminalConnectionContext>
    </CompactLayoutContext>
  );
}
function MobileWorkspaceContent({
  host,
  connection,
}: {
  host: MobileState;
  connection: DaemonConnection | null;
}) {
  const files = useFiles();
  const [paneDestination, setPaneDestination] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [creatingTerminalProfile, setCreatingTerminalProfile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | "machines">("account");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addingProject, setAddingProject] = useState<"open" | "clone" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mutating = useRef(false);
  const [replica, setReplica] = useState<{
    machineId: string | null;
    workspace: WorkspaceSnapshot;
  } | null>(null);
  const [, refresh] = useState(0);
  const [local, setLocal] = useState<{ machineId: string | null; target: MobileTarget }>({
    machineId: host.machineId,
    target: host.target,
  });
  const memories = useRef(new Map<string, MobileTarget>());
  const onWorkspaceCreated = useCallback(
    (projectId: string) => {
      setLocal({ machineId: host.machineId, target: { projectId } });
      setSidebarOpen(false);
      setError(null);
    },
    [host.machineId],
  );
  const newWorkspace = useNewWorkspace(connection, onWorkspaceCreated);
  const [width, setWidth] = useState(() => Math.min(320, window.innerWidth * 0.84));
  const sidebar = useRef<HTMLElement>(null);
  const workspace = replica?.machineId === host.machineId ? replica.workspace : null;
  const ready = host.phase === "ready" && connection?.state.status === "ready" && !!workspace;
  const canEdit = !!ready && !pending;
  const draftScope = useMemo(() => ({ machineId: host.machineId }), [host.machineId]);
  const selected = workspace
    ? resolveMobileSelection(workspace, local.machineId === host.machineId ? local.target : {})
    : null;
  const { project, tab, pane } = selected ?? { project: null, tab: null, pane: null };
  const filesAvailable = !!(
    ready &&
    connection?.state.status === "ready" &&
    connection.state.daemon.capabilities?.includes("project-files")
  );
  const scope =
    project && workspace ? fileScope(workspace.machineId, workspace.epoch, project.id) : "";
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const gesture = useSidebarGesture(sidebarOpen, setSidebarOpen, width, {
    direction: 1,
    enabled: !files.sidebar.open,
  });
  const filesGesture = useSidebarGesture(files.sidebar.open, files.sidebar.setOpen, viewportWidth, {
    direction: -1,
    enabled: !sidebarOpen,
    protectInputs: true,
  });
  useEffect(() => {
    const swipe = (event: Event) => {
      const right = (event as CustomEvent<string>).detail === "right";
      if (files.sidebar.open) {
        if (right) files.sidebar.setOpen(false);
      } else if (sidebarOpen) {
        if (!right) setSidebarOpen(false);
      } else if (right) setSidebarOpen(true);
      else files.sidebar.setOpen(true);
    };
    document.addEventListener("concors-native-swipe", swipe);
    return () => document.removeEventListener("concors-native-swipe", swipe);
  }, [files.sidebar, sidebarOpen]);
  useEffect(() => {
    const resize = () => {
      setWidth(Math.min(320, window.innerWidth * 0.84));
      setViewportWidth(window.innerWidth);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const dark =
      host.preferences.theme === "dark" || (host.preferences.theme === "system" && host.systemDark);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.dataset["cornerStyle"] = host.preferences.corners;
    setNotificationPreferences({ sound: host.preferences.sound, desktop: false });
  }, [host.preferences, host.systemDark]);
  useEffect(() => {
    if (!connection) return;
    let current = true;
    const offWorkspace = connection.subscribeWorkspace((snapshot) => {
      if (current) setReplica({ machineId: host.machineId, workspace: snapshot });
    });
    const offState = connection.subscribe(() => {
      if (current) refresh((value) => value + 1);
    });
    void connection.connect().catch((cause: unknown) => {
      if (current) setError(cause instanceof Error ? cause.message : "Could not open workspace");
    });
    return () => {
      current = false;
      offWorkspace();
      offState();
      connection.disconnect();
    };
  }, [connection, host.machineId]);
  const targetKey = JSON.stringify(host.target);
  const handledTarget = useRef<string | null>(null);
  useEffect(() => {
    if (handledTarget.current === targetKey) return;
    const target = JSON.parse(targetKey) as MobileTarget;
    if (!target.machineId) return;
    if (host.direct ? !host.machineId : !host.machines.length) return;
    if (
      host.direct
        ? host.machineId !== target.machineId
        : !host.machines.some((machine) => machine.id === target.machineId)
    ) {
      // An external native notification/deep link is an imperative navigation event.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        host.direct
          ? "This link belongs to a different desktop daemon."
          : "This session's machine is not available in your current organization.",
      );
      return;
    }
    handledTarget.current = targetKey;
    if (host.machineId !== target.machineId)
      void hostAction({ kind: "select-machine", machineId: target.machineId }).catch(
        (cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not open session"),
      );
    setLocal({ machineId: target.machineId, target });
  }, [targetKey, host.machines, host.machineId, host.direct]);
  // One available machine can connect automatically; choosing another always remains explicit.
  useEffect(() => {
    if (
      !host.machineId &&
      host.machines.length === 1 &&
      host.capabilities.remoteAccess &&
      !host.target.machineId
    ) {
      const machine = host.machines[0];
      if (machine && machineAvailability(machine) === "connectable")
        void hostAction({ kind: "select-machine", machineId: machine.id }).catch(() => undefined);
    }
  }, [host.machineId, host.machines, host.capabilities.remoteAccess, host.target.machineId]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const prior = document.activeElement as HTMLElement | null;
    prior?.blur();
    sidebar.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"]:not([aria-label="Workspace sidebar"]), [role="menu"], [role="listbox"]',
        )
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        setSidebarOpen(false);
      }
      if (event.key === "Tab") {
        const items = [
          ...(sidebar.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]',
          ) ?? []),
        ].filter((item) => item.getClientRects().length);
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? index <= 0
            ? items.length - 1
            : index - 1
          : (index + 1) % items.length;
        event.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      requestAnimationFrame(() => {
        if (!document.querySelector('[role="dialog"]'))
          document.getElementById("mobile-sidebar-toggle")?.focus({ preventScroll: true });
      });
    };
  }, [sidebarOpen]);
  const select = (target: MobileTarget) => {
    if (project && tab && pane)
      memories.current.set(`${host.machineId}:${project.id}`, {
        projectId: project.id,
        tabId: tab.id,
        paneId: pane.id,
      });
    setLocal({ machineId: host.machineId, target });
    setSidebarOpen(false);
    setError(null);
  };
  const selectProject = (projectId: string) =>
    select(memories.current.get(`${host.machineId}:${projectId}`) ?? { projectId });
  const openAgent = useCallback(
    (sessionId: string) => {
      setLocal({ machineId: host.machineId, target: { sessionId } });
      setSidebarOpen(false);
      setError(null);
    },
    [host.machineId],
  );
  const execute = async (operation: WorkspaceOperation) => {
    if (!connection?.workspace || !ready || mutating.current)
      throw new Error("Wait for the workspace to be ready");
    mutating.current = true;
    setPending(true);
    try {
      const result = await connection.executeWorkspace({
        type: "workspace.command",
        commandId: crypto.randomUUID(),
        epoch: connection.workspace.epoch,
        operation,
      });
      if (result.outcome.status === "rejected") throw new Error(result.outcome.message);
    } finally {
      mutating.current = false;
      setPending(false);
    }
  };
  const command = (operation: WorkspaceOperation) => {
    setError(null);
    void execute(operation).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Could not update workspace"),
    );
  };
  const createTab = (profile: PaneProfile, name?: string, terminalProfileId?: string) => {
    if (!project) return;
    const tabId = crypto.randomUUID(),
      paneId = crypto.randomUUID();
    setError(null);
    void execute({
      kind: "tab.create",
      projectId: project.id,
      expectedVersion: project.version,
      tabId,
      paneId,
      name: name || TAB_PROFILES.find((item) => item.profile === profile)?.label || "Terminal",
      profile,
      ...(terminalProfileId ? { terminalProfileId } : {}),
    })
      .then(() => select({ projectId: project.id, tabId, paneId }))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not create tab"),
      );
  };
  const createPane = (profile: PaneProfile, terminalProfileId?: string) => {
    const targetTab = project?.tabs.find((item) => item.id === paneDestination) ?? tab;
    const targetPane = targetTab?.id === tab?.id ? pane : targetTab && tabPanes(targetTab)[0];
    if (!project || !targetTab || !targetPane) return;
    const newPaneId = crypto.randomUUID();
    setError(null);
    // Keep the shared layout tree valid; mobile still displays only the selected leaf.
    void execute({
      kind: "pane.split",
      projectId: project.id,
      expectedVersion: project.version,
      tabId: targetTab.id,
      paneId: targetPane.id,
      newPaneId,
      splitId: crypto.randomUUID(),
      axis: "horizontal",
      profile,
      ...(terminalProfileId ? { terminalProfileId } : {}),
    })
      .then(() => select({ projectId: project.id, tabId: targetTab.id, paneId: newPaneId }))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not add pane"),
      );
  };
  const runHost = (action: Parameters<typeof hostAction>[0]) => {
    setError(null);
    void hostAction(action).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : "Request failed"),
    );
  };
  const openSettings = (page: SettingsPage = host.direct ? "appearance" : "account") => {
    setSidebarOpen(false);
    setSettingsPage(page);
    setSettingsOpen(true);
  };
  const unobscured =
    !sidebarOpen && !files.sidebar.open && !settingsOpen && !paletteOpen && !addingProject;
  const cycleTab = (delta: number) => {
    if (!project || !tab) return;
    const next =
      project.tabs[(project.tabs.indexOf(tab) + delta + project.tabs.length) % project.tabs.length];
    if (next) select({ projectId: project.id, tabId: next.id });
  };
  const cyclePane = (delta: number) => {
    if (!project || !tab || !pane) return;
    const panes = tabPanes(tab);
    const next = panes[panes.findIndex((item) => item.id === pane.id) + delta];
    if (next) select({ projectId: project.id, tabId: tab.id, paneId: next.id });
  };
  const commandsAvailable = unobscured || paletteOpen;
  const newPaneTab = project?.tabs.find((item) => item.id === paneDestination) ?? tab;
  useCommand("search", commandsAvailable, () => setPaletteOpen((open) => !open));
  useCommand("settings", commandsAvailable, () => openSettings());
  useCommand("shortcuts", commandsAvailable, () => openSettings("shortcuts"));
  useCommand("new-project", commandsAvailable && canEdit, newWorkspace.start);
  useCommand("previous-tab", commandsAvailable && !!tab, () => cycleTab(-1));
  useCommand("next-tab", commandsAvailable && !!tab, () => cycleTab(1));
  useCommand("focus-left", commandsAvailable && !!pane, () => cyclePane(-1));
  useCommand("focus-up", commandsAvailable && !!pane, () => cyclePane(-1));
  useCommand("focus-right", commandsAvailable && !!pane, () => cyclePane(1));
  useCommand("focus-down", commandsAvailable && !!pane, () => cyclePane(1));
  return (
    <ColorThemeProvider
      connection={connection}
      mode={
        host.preferences.theme === "dark" ||
        (host.preferences.theme === "system" && host.systemDark)
          ? "dark"
          : "light"
      }
      selection={host.preferences.colorTheme ?? { id: "concors" }}
      onSelect={(colorTheme) =>
        runHost({ kind: "preferences", preferences: { ...host.preferences, colorTheme } })
      }
    >
      <TerminalProfilesContext
        value={{
          profiles: workspace?.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES,
          supported:
            connection?.state.status === "ready" &&
            !!connection.state.daemon.capabilities?.includes("terminal-profiles"),
          canEdit:
            canEdit &&
            connection?.state.status === "ready" &&
            !!connection.state.daemon.capabilities?.includes("terminal-profiles"),
          execute,
          openSettings: (add = false) => {
            setSidebarOpen(false);
            setCreatingTerminalProfile(add);
            setSettingsPage("terminals");
            setSettingsOpen(true);
          },
        }}
      >
        <AgentDraftScopeContext value={draftScope}>
          <NotificationProvider connection={connection} onOpen={openAgent} inAppOnly>
            <AgentsProvider connection={connection} onStarted={openAgent}>
              <div
                className="mobile-shell"
                data-sidebar-open={sidebarOpen}
                data-files-open={files.sidebar.open}
                onPointerDownCapture={(event) => {
                  gesture.handlers.onPointerDown(event);
                  filesGesture.handlers.onPointerDown(event);
                }}
                onPointerMoveCapture={(event) => {
                  gesture.handlers.onPointerMove(event);
                  filesGesture.handlers.onPointerMove(event);
                }}
                onPointerUpCapture={(event) => {
                  gesture.handlers.onPointerUp(event);
                  filesGesture.handlers.onPointerUp(event);
                }}
                onPointerCancelCapture={(event) => {
                  gesture.handlers.onPointerCancel(event);
                  filesGesture.handlers.onPointerCancel(event);
                }}
                onClickCapture={(event) => {
                  gesture.handlers.onClickCapture(event);
                  filesGesture.handlers.onClickCapture(event);
                }}
              >
                <aside
                  ref={sidebar}
                  id="mobile-sidebar"
                  role={sidebarOpen ? "dialog" : undefined}
                  aria-label="Workspace sidebar"
                  aria-modal={sidebarOpen || undefined}
                  aria-hidden={!sidebarOpen}
                  inert={!sidebarOpen}
                  className="mobile-sidebar"
                  style={{ width }}
                >
                  <div className="mobile-sidebar-head">
                    <button
                      className="mobile-icon"
                      aria-label="Close sidebar"
                      onClick={() => setSidebarOpen(false)}
                    >
                      <Menu />
                    </button>
                    <button
                      className="mobile-icon ml-auto"
                      aria-label="Search workspace"
                      onClick={() => setPaletteOpen(true)}
                    >
                      <Search />
                    </button>
                  </div>
                  <div className="px-3 pb-3">
                    <MobileSelect
                      label="Machine"
                      presentation="sheet"
                      value={host.machineId ?? ""}
                      placeholder={host.direct ? "Connecting to desktop…" : "Choose a machine"}
                      onValueChange={(machineId) => {
                        setLocal({ machineId, target: {} });
                        runHost({ kind: "select-machine", machineId });
                      }}
                      groups={[
                        {
                          label: host.direct ? "Direct connection" : "Your machines",
                          options: host.direct
                            ? host.machineId
                              ? [
                                  {
                                    value: host.machineId,
                                    label: "Desktop daemon",
                                    icon: <Server />,
                                    description:
                                      host.phase === "ready"
                                        ? "Connected · real workspace"
                                        : host.phase,
                                  },
                                ]
                              : []
                            : host.machines.map((machine) => ({
                                value: machine.id,
                                label: machine.name,
                                icon: <Server />,
                                description: machineStatusLabel(
                                  machineAvailability(machine),
                                  host.machineId === machine.id && host.phase === "ready",
                                ),
                                disabled: machineAvailability(machine) !== "connectable",
                              })),
                        },
                      ]}
                    />
                  </div>
                  <nav aria-label="Primary" className="mobile-sidebar-content">
                    <SidebarSection
                      title="Projects"
                      action={
                        <NewWorkspaceMenu
                          disabled={!canEdit || newWorkspace.busy}
                          onNew={newWorkspace.start}
                          onOpen={setAddingProject}
                        />
                      }
                    >
                      <ul>
                        {workspace?.projects.map((item) => (
                          <li
                            className={`group mobile-project ${project?.id === item.id ? "bg-sidebar-accent" : ""}`}
                            key={item.id}
                          >
                            <button
                              aria-current={project?.id === item.id ? "page" : undefined}
                              title={item.directory}
                              onClick={() => selectProject(item.id)}
                            >
                              <ProjectImage source={null} />
                              <span className="truncate">{item.name}</span>
                            </button>
                            <ProjectActions project={item} canEdit={canEdit} execute={execute} />
                          </li>
                        ))}
                      </ul>
                      {!workspace?.projects.length && (
                        <p className="px-2 py-3 text-sm text-muted-foreground">
                          Open a folder or start a workspace to organize your tabs and panes.
                        </p>
                      )}
                    </SidebarSection>
                    <SidebarSection title="Agents">
                      <AgentSidebar onSelect={openAgent} workspace={workspace} />
                    </SidebarSection>
                    <SidebarSection title="Servers">
                      <p className="px-2 py-3 text-sm text-muted-foreground">
                        No servers discovered.
                      </p>
                    </SidebarSection>
                  </nav>
                  <div className="mobile-sidebar-footer">
                    {host.me ? (
                      <AccountMenu
                        auth={{
                          status: "signed-in",
                          ...host.me,
                          organizations: host.organizations,
                        }}
                        onOpenSettings={() => openSettings()}
                        onSignOut={() => runHost({ kind: "sign-out" })}
                      />
                    ) : (
                      <button
                        className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-sidebar-accent"
                        aria-label="Desktop connection settings"
                        onClick={() => openSettings()}
                      >
                        <Server className="size-5" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">Desktop connection</span>
                          <span className="block text-xs text-muted-foreground">
                            Private test · no cloud account
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                </aside>
                <div
                  className="mobile-workspace"
                  data-testid="mobile-workspace"
                  style={{
                    transform: `translateX(${gesture.offset}px)`,
                    transition: gesture.dragging ? "none" : undefined,
                  }}
                >
                  <div
                    className="mobile-main"
                    inert={sidebarOpen || files.sidebar.open}
                    aria-hidden={sidebarOpen || files.sidebar.open || undefined}
                  >
                    <header className="mobile-header">
                      <NativeHeaderButton
                        icon="menu"
                        id="mobile-sidebar-toggle"
                        className="mobile-icon mobile-glass"
                        aria-label="Open sidebar"
                        aria-controls="mobile-sidebar"
                        aria-expanded={sidebarOpen}
                        onClick={() => setSidebarOpen(true)}
                      >
                        <Menu />
                      </NativeHeaderButton>
                      {project ? (
                        <NewTabMenu
                          keyboard={commandsAvailable}
                          disabled={!canEdit}
                          tabLimitReached={project.tabs.length >= 32}
                          paneTarget={
                            newPaneTab
                              ? {
                                  name: newPaneTab.name,
                                  disabled: tabPanes(newPaneTab).length >= 32,
                                  onCreate: createPane,
                                }
                              : undefined
                          }
                          onCreate={createTab}
                          renderTrigger={(open) => (
                            <WorkspacePicker
                              project={project}
                              tab={tab}
                              pane={pane}
                              canEdit={canEdit}
                              keyboard={commandsAvailable}
                              execute={execute}
                              command={command}
                              onSelect={select}
                              onNewTab={() => {
                                setPaneDestination(null);
                                open("tab");
                              }}
                              onNewPane={(tabId) => {
                                setPaneDestination(tabId);
                                open("pane");
                              }}
                            />
                          )}
                        />
                      ) : (
                        <h1 className="min-w-0 flex-1 truncate text-base font-medium">Workspace</h1>
                      )}
                      <NativeHeaderButton
                        icon="files"
                        id="mobile-files-toggle"
                        className="mobile-icon mobile-glass"
                        aria-label="Project files"
                        aria-controls="mobile-project-files"
                        aria-expanded={files.sidebar.open}
                        title="Browse project files"
                        onPointerEnter={preloadCodeEditor}
                        onFocus={preloadCodeEditor}
                        onClick={() => {
                          preloadCodeEditor();
                          files.select(scope, null);
                          files.sidebar.setOpen(true);
                        }}
                      >
                        <FolderOpen />
                      </NativeHeaderButton>
                    </header>
                    {(error || host.message) && (
                      <div role="alert" className="mobile-notice">
                        <span>{error ?? host.message}</span>
                        <button
                          onClick={() => {
                            setError(null);
                            runHost({ kind: "retry" });
                            runHost({ kind: "refresh" });
                          }}
                        >
                          Retry
                        </button>
                        <button onClick={() => setError(null)} aria-label="Dismiss error">
                          ×
                        </button>
                      </div>
                    )}
                    {workspace && !ready && (
                      <p role="status" className="mobile-notice">
                        Reconnecting… Saved workspace is read-only.
                      </p>
                    )}
                    <TabVisibility value={!files.sidebar.open}>
                      <PaneVisibilityContext value={unobscured}>
                        <main
                          className="mobile-pane"
                          data-pane-id={pane?.id}
                          data-pane-profile={pane?.profile}
                        >
                          {project && tab && pane ? (
                            <ProjectFileLinks project={project}>
                              {pane.profile === "chat" ? (
                                <ChatPane
                                  key={`${host.machineId}:${pane.id}`}
                                  project={project}
                                  tab={tab}
                                  node={pane}
                                  canEdit={canEdit}
                                />
                              ) : (
                                <TerminalPane
                                  key={`${host.machineId}:${pane.id}:${pane.profile}:${pane.terminalProfile?.id}:${pane.terminalProfile?.version}`}
                                  project={project}
                                  tab={tab}
                                  node={pane}
                                  canEdit={canEdit}
                                />
                              )}
                            </ProjectFileLinks>
                          ) : (
                            <div className="mobile-empty">
                              <FolderOpen className="size-8 text-muted-foreground" />
                              <h1>
                                {local.target.sessionId && workspace
                                  ? "Session unavailable"
                                  : project
                                    ? "Start a conversation"
                                    : "Your workspace, wherever you are"}
                              </h1>
                              <p>
                                {!host.capabilities.remoteAccess
                                  ? "Remote access is not available on this Concors server yet."
                                  : host.machineId && !workspace
                                    ? "Connecting to your projects and agents…"
                                    : "Open a project from the sidebar or add one to get started."}
                              </p>
                              {project ? (
                                <NewTabMenu empty disabled={!canEdit} onCreate={createTab} />
                              ) : (
                                <Button variant="outline" onClick={() => setSidebarOpen(true)}>
                                  Open workspace sidebar
                                </Button>
                              )}
                              {ready && !project && (
                                <Button onClick={() => setAddingProject("open")}>
                                  Open folder
                                </Button>
                              )}
                            </div>
                          )}
                        </main>
                      </PaneVisibilityContext>
                    </TabVisibility>
                  </div>
                  {sidebarOpen && (
                    <button
                      className="mobile-scrim"
                      aria-label="Return to workspace"
                      onClick={() => setSidebarOpen(false)}
                      tabIndex={-1}
                    />
                  )}
                </div>
                <MobileFiles
                  project={project}
                  workspace={workspace}
                  available={filesAvailable}
                  connected={ready}
                  demo={host.demo}
                  offset={filesGesture.offset}
                  dragging={filesGesture.dragging}
                />
              </div>
              <SettingsDrawer
                key={host.machineId}
                creatingTerminalProfile={creatingTerminalProfile}
                onCreatingTerminalProfileChange={setCreatingTerminalProfile}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                host={host}
                connectionState={connection?.state ?? { status: "disconnected" }}
                page={settingsPage}
                onPageChange={setSettingsPage}
              />
              {addingProject && (
                <ProjectSetupDialog
                  mode={addingProject}
                  onClose={() => setAddingProject(null)}
                  onAdded={() => {
                    setAddingProject(null);
                    setSidebarOpen(false);
                    if (connection?.workspace?.selection)
                      select({
                        projectId: connection.workspace.selection.projectId,
                        tabId: connection.workspace.selection.tabId ?? undefined,
                      });
                  }}
                />
              )}
              {newWorkspace.error && (
                <p role="alert" className="p-3 text-sm text-destructive">
                  {newWorkspace.error}
                </p>
              )}
              <CommandPalette
                projects={workspace?.projects ?? []}
                canSelectProject={!!workspace}
                onSelectProject={selectProject}
                open={paletteOpen}
                onOpenChange={setPaletteOpen}
                onNavigate={(view) => {
                  if (view === "settings") openSettings();
                  else if (view === "machines") {
                    setSidebarOpen(false);
                    setSettingsPage(host.direct ? "advanced" : "machines");
                    setSettingsOpen(true);
                  } else setSidebarOpen(true);
                }}
                onReconnect={() => runHost({ kind: "retry" })}
                canReconnect={!ready}
                onSetTheme={(theme) =>
                  runHost({ kind: "preferences", preferences: { ...host.preferences, theme } })
                }
                onSignOut={() => runHost({ kind: "sign-out" })}
              />
            </AgentsProvider>
          </NotificationProvider>
        </AgentDraftScopeContext>
      </TerminalProfilesContext>
    </ColorThemeProvider>
  );
}

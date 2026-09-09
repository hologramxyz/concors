import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Ellipsis, FolderOpen, Menu, Plus, Search, Server } from "lucide-react";
import type { MobileState, MobileTarget } from "@concors/client-core";
import type { PaneProfile, WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
import { ShortcutProvider } from "@/shortcuts/provider";
import { useCommand } from "@/shortcuts/context";
import { ShortcutGuide } from "@/shortcuts/guide";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TerminalConnectionContext } from "@/terminal/connection-context";
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
import { ProjectImage } from "@/workspace/project-image";
import { SidebarSection } from "@/components/sidebar-section";
import { NewTabMenu } from "@/workspace/new-tab-menu";
import { PaneProfileIcon } from "@/workspace/profile-icon";
import { TAB_PROFILES } from "@/workspace/tab-profiles";
import { CommandPalette } from "@/components/command-palette";
import { AccountMenu } from "@/components/account-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { embeddedConnection, getHostState, hostAction, subscribeHost } from "./bridge";
import { resolveMobileSelection, tabPanes, PROFILE_LABELS } from "./selection";
import { useSidebarGesture } from "./sidebar-gesture";
import { SettingsDrawer } from "./settings-drawer";
import { WorkspaceActions } from "./workspace-actions";
import { MobileSelect } from "./select";
import type { SettingsPage } from "@/settings/navigation";

const subscribeState = (listener: () => void) =>
  subscribeHost((message) => {
    if (message.type === "state") listener();
  });
export function MobileApp() {
  const host = useSyncExternalStore(subscribeState, getHostState);
  return host ? (
    <ShortcutProvider>
      <TooltipProvider>
        <MobileWorkspace key={host.scope} host={host} />
      </TooltipProvider>
    </ShortcutProvider>
  ) : (
    <p role="status" className="p-6 text-sm">
      Opening your workspace…
    </p>
  );
}
function MobileWorkspace({ host }: { host: MobileState }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | "machines">("account");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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
  const [width, setWidth] = useState(() => Math.min(320, window.innerWidth * 0.84));
  const sidebar = useRef<HTMLElement>(null);
  const connection = useMemo(
    () => (host.connectionId ? embeddedConnection(host.connectionId) : null),
    [host.connectionId],
  );
  const workspace = replica?.machineId === host.machineId ? replica.workspace : null;
  const ready = host.phase === "ready" && connection?.state.status === "ready" && !!workspace;
  const canEdit = !!ready && !pending;
  const draftScope = useMemo(() => ({ machineId: host.machineId }), [host.machineId]);
  const selected = workspace
    ? resolveMobileSelection(workspace, local.machineId === host.machineId ? local.target : {})
    : null;
  const { project, tab, pane } = selected ?? { project: null, tab: null, pane: null };
  const gesture = useSidebarGesture(sidebarOpen, setSidebarOpen, width);
  useEffect(() => {
    const resize = () => setWidth(Math.min(320, window.innerWidth * 0.84));
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
    if (!host.machines.length) return;
    if (!host.machines.some((machine) => machine.id === target.machineId)) {
      // An external native notification/deep link is an imperative navigation event.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("This session's machine is not available in your current organization.");
      return;
    }
    handledTarget.current = targetKey;
    if (host.machineId !== target.machineId)
      void hostAction({ kind: "select-machine", machineId: target.machineId }).catch(
        (cause: unknown) =>
          setError(cause instanceof Error ? cause.message : "Could not open session"),
      );
    setLocal({ machineId: target.machineId, target });
  }, [targetKey, host.machines, host.machineId]);
  // One available machine can connect automatically; choosing another always remains explicit.
  useEffect(() => {
    if (
      !host.machineId &&
      host.machines.length === 1 &&
      host.capabilities.remoteAccess &&
      !host.target.machineId
    ) {
      const machine = host.machines[0];
      if (machine)
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
  const createTab = (profile: PaneProfile, name?: string) => {
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
    })
      .then(() => select({ projectId: project.id, tabId, paneId }))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not create tab"),
      );
  };
  const createPane = (profile: PaneProfile) => {
    if (!project || !tab || !pane) return;
    const newPaneId = crypto.randomUUID();
    setError(null);
    // Keep the shared layout tree valid; mobile still displays only the selected leaf.
    void execute({
      kind: "pane.split",
      projectId: project.id,
      expectedVersion: project.version,
      tabId: tab.id,
      paneId: pane.id,
      newPaneId,
      splitId: crypto.randomUUID(),
      axis: "horizontal",
      profile,
    })
      .then(() => select({ projectId: project.id, tabId: tab.id, paneId: newPaneId }))
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
  const openSettings = () => {
    setSidebarOpen(false);
    setSettingsPage("account");
    setSettingsOpen(true);
  };
  const unobscured =
    !sidebarOpen && !settingsOpen && !paletteOpen && !addingProject && !shortcutsOpen;
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
  useCommand("search", commandsAvailable, () => setPaletteOpen((open) => !open));
  useCommand("settings", commandsAvailable, openSettings);
  useCommand("shortcuts", commandsAvailable, () => setShortcutsOpen(true));
  useCommand("new-project", commandsAvailable && canEdit, () => setAddingProject(true));
  useCommand("previous-tab", commandsAvailable && !!tab, () => cycleTab(-1));
  useCommand("next-tab", commandsAvailable && !!tab, () => cycleTab(1));
  useCommand("focus-left", commandsAvailable && !!pane, () => cyclePane(-1));
  useCommand("focus-up", commandsAvailable && !!pane, () => cyclePane(-1));
  useCommand("focus-right", commandsAvailable && !!pane, () => cyclePane(1));
  useCommand("focus-down", commandsAvailable && !!pane, () => cyclePane(1));
  return (
    <AgentDraftScopeContext value={draftScope}>
      <CompactLayoutContext value={true}>
        <TerminalConnectionContext value={connection}>
          <NotificationProvider connection={connection} onOpen={openAgent} inAppOnly>
            <AgentsProvider connection={connection}>
              <div className="mobile-shell" {...gesture.handlers} data-sidebar-open={sidebarOpen}>
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
                      placeholder="Choose a machine"
                      onValueChange={(machineId) => {
                        setLocal({ machineId, target: {} });
                        runHost({ kind: "select-machine", machineId });
                      }}
                      groups={[
                        {
                          label: "Your machines",
                          options: host.machines.map((machine) => ({
                            value: machine.id,
                            label: machine.name,
                            icon: <Server />,
                            description: machine.status,
                          })),
                        },
                      ]}
                    />
                  </div>
                  <nav aria-label="Primary" className="mobile-sidebar-content">
                    <SidebarSection
                      title="Projects"
                      action={
                        <button
                          className="mobile-icon"
                          aria-label="Add project"
                          disabled={!canEdit}
                          onClick={() => setAddingProject(true)}
                        >
                          <Plus />
                        </button>
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
                          Add a project to organize your tabs and panes.
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
                    <AccountMenu
                      auth={{ status: "signed-in", ...host.me, organizations: host.organizations }}
                      onOpenSettings={openSettings}
                      onSignOut={() => runHost({ kind: "sign-out" })}
                    />
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
                    inert={sidebarOpen}
                    aria-hidden={sidebarOpen || undefined}
                  >
                    <header className="mobile-header">
                      <button
                        id="mobile-sidebar-toggle"
                        className="mobile-icon mobile-glass"
                        aria-label="Open sidebar"
                        aria-controls="mobile-sidebar"
                        aria-expanded={sidebarOpen}
                        onClick={() => setSidebarOpen(true)}
                      >
                        <Menu />
                      </button>
                      {project && tab && pane ? (
                        <MobileSelect
                          className="mobile-picker mobile-glass"
                          label="Tabs and panes"
                          presentation="sheet"
                          hierarchy
                          selectedLabel={
                            <span className="mobile-picker-breadcrumb">
                              <span>{tab.name}</span>
                              <span>
                                {PROFILE_LABELS[pane.profile]} · Pane{" "}
                                {tabPanes(tab).findIndex((item) => item.id === pane.id) + 1}
                              </span>
                            </span>
                          }
                          value={`${tab.id}:${pane.id}`}
                          onValueChange={(value) => {
                            const [tabId, paneId] = value.split(":");
                            select({ projectId: project.id, tabId, paneId });
                          }}
                          groups={project.tabs.map((item) => ({
                            label: item.name,
                            options: tabPanes(item).map((node, index) => ({
                              value: `${item.id}:${node.id}`,
                              label: `${PROFILE_LABELS[node.profile]} · Pane ${index + 1}`,
                              icon: <PaneProfileIcon profile={node.profile} />,
                            })),
                          }))}
                        />
                      ) : (
                        <h1 className="min-w-0 flex-1 truncate text-base font-medium">
                          {project?.name ?? "Concors"}
                        </h1>
                      )}
                      {project && (
                        <NewTabMenu
                          keyboard={commandsAvailable}
                          disabled={!canEdit}
                          tabLimitReached={project.tabs.length >= 32}
                          paneTarget={
                            tab && pane
                              ? {
                                  name: tab.name,
                                  disabled: tabPanes(tab).length >= 32,
                                  onCreate: createPane,
                                }
                              : undefined
                          }
                          onCreate={createTab}
                          renderTrigger={(open) =>
                            tab && pane ? (
                              <WorkspaceActions
                                project={project}
                                tab={tab}
                                pane={pane}
                                canEdit={canEdit}
                                execute={execute}
                                command={command}
                                onSelect={select}
                                onNewTab={() => open("tab")}
                                onNewPane={() => open("pane")}
                              />
                            ) : (
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  className="mobile-icon mobile-glass"
                                  aria-label="Tab and pane actions"
                                >
                                  <Ellipsis />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    disabled={!canEdit}
                                    onSelect={() => open("tab")}
                                  >
                                    <Plus /> New tab
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )
                          }
                        />
                      )}
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
                    <PaneVisibilityContext value={unobscured}>
                      <main
                        className="mobile-pane"
                        data-pane-id={pane?.id}
                        data-pane-profile={pane?.profile}
                      >
                        {project && tab && pane ? (
                          pane.profile === "chat" ? (
                            <ChatPane
                              key={`${host.machineId}:${pane.id}`}
                              project={project}
                              tab={tab}
                              node={pane}
                              canEdit={canEdit}
                            />
                          ) : (
                            <TerminalPane
                              key={`${host.machineId}:${pane.id}`}
                              project={project}
                              tab={tab}
                              node={pane}
                              canEdit={canEdit}
                            />
                          )
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
                              <Button onClick={() => setAddingProject(true)}>Add project</Button>
                            )}
                          </div>
                        )}
                      </main>
                    </PaneVisibilityContext>
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
              </div>
              <SettingsDrawer
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                host={host}
                connectionState={connection?.state ?? { status: "disconnected" }}
                page={settingsPage}
                onPageChange={setSettingsPage}
              />
              <ShortcutGuide open={shortcutsOpen} onOpenChange={setShortcutsOpen} compact />
              <ProjectSetupDialog
                open={addingProject}
                onClose={() => setAddingProject(false)}
                onAdded={() => {
                  setAddingProject(false);
                  setSidebarOpen(false);
                  if (connection?.workspace?.selection)
                    select({
                      projectId: connection.workspace.selection.projectId,
                      tabId: connection.workspace.selection.tabId ?? undefined,
                    });
                }}
              />
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
                    setSettingsPage("machines");
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
        </TerminalConnectionContext>
      </CompactLayoutContext>
    </AgentDraftScopeContext>
  );
}

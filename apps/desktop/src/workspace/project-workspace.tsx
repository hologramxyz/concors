import { WindowControls } from "@/window/controls";
import { useWindowChrome } from "@/window/context";
import { FilesToggle } from "@/files/sidebar";
import { FileTab, FileTabLabel } from "@/files/file-tab";
import { useFiles, fileScope } from "@/files/context";
import { ProjectFileLinks } from "@/files/provider";
import { useCommand } from "@/shortcuts/context";
import { useShortcutLabels } from "@/shortcuts/preferences-context";
import type { PaneFocusRequest } from "./session-pane";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { NewTabMenu } from "./new-tab-menu";
import { ResumeChatDialog } from "@/agents/resume-chat";
import { nextWorkspaceTabName } from "@concors/protocol";
import { ContextMenu } from "radix-ui";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FolderOpen, Pencil, Plus, X } from "lucide-react";
import type {
  AgentInfo,
  PaneProfile,
  WorkspaceOperation,
  WorkspaceSnapshot,
  WorkspaceTab,
} from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { PaneLayout } from "./pane-layout";
import { VisitedTab } from "./visited-tab";
import { useRetainedProjects } from "./retained-projects";
import { CloseTabButton, LatestAgents, TabButton } from "./tab-button";
import { tabTitle } from "./tab-title";

/** How long a tab takes to shrink away; matches `tab-close` in styles.css. */
const TAB_CLOSE_MS = 180;

interface TabDrag {
  projectId: string;
  tabId: string;
  from: number;
  /** The index the tab lands at, counted after it is taken out, as `tab.move` expects. */
  to: number;
  /** Where each tab sat in the tab list when the drag began. */
  slots: { left: number; width: number }[];
  gap: number;
  /** Sent to the daemon; the tabs hold still until the reordered workspace arrives. */
  dropped: boolean;
}

function tabListX(list: HTMLElement, clientX: number) {
  return clientX - list.getBoundingClientRect().left + list.scrollLeft;
}

function tabDropIndex(drag: TabDrag, x: number) {
  return drag.slots.filter((slot, i) => i !== drag.from && slot.left + slot.width / 2 < x).length;
}

function tabShift({ from, to, slots, gap }: TabDrag, index: number) {
  const source = slots[from];
  const target = slots[to];
  if (!source || !target) return 0;
  if (index === from) {
    return to > from
      ? target.left + target.width - (source.left + source.width)
      : target.left - source.left;
  }
  if (from < index && index <= to) return -(source.width + gap);
  if (to <= index && index < from) return source.width + gap;
  return 0;
}

export function ProjectWorkspace({
  workspace,
  sidebarToggle,
  focusRequest,
  onPaneFocus,
  connected,
  canEdit,
  onCommand,
  execute,
  onAddProject,
  onOpenFolder,
}: {
  workspace: WorkspaceSnapshot;
  sidebarToggle?: ReactNode;
  focusRequest?: PaneFocusRequest | null;
  onPaneFocus?: (paneId: string) => void;
  /** The daemon is reachable. Selection and renaming only need this, not a quiet command queue. */
  connected: boolean;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  onAddProject: () => void;
  onOpenFolder: (mode: "open" | "clone", trigger?: HTMLElement | null) => void;
}) {
  const shortcutLabel = useShortcutLabels();
  const connection = useContext(TerminalConnectionContext);
  const files = useFiles();
  const windowChrome = useWindowChrome();
  // Read by rename, which names the tab after what it shows; kept out of render on purpose.
  const agentsRef = useRef<readonly AgentInfo[]>([]);
  // The tab row is the window's title bar when the native one is hidden.
  const titleBar = windowChrome.enabled || windowChrome.inset;
  const scope = fileScope(
    workspace.machineId,
    workspace.epoch,
    workspace.selection?.projectId ?? "",
  );
  const projectFiles = files.files.filter((file) => file.scope === scope);
  const activeFile = projectFiles.find((file) => file.id === files.active[scope]);
  useEffect(() => {
    files.select(scope, null);
    // Session navigation should reveal the session; background snapshots should not close files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.selection?.tabId, scope, focusRequest?.requestId]);
  const creating = useRef(false);
  const lastFocusedPane = useRef<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // A dragged tab leaves a grey slot that slides to where it will land while the others make room.
  // Tabs only move by transform until the daemon's reordered workspace arrives.
  const [tabDrag, setTabDrag] = useState<TabDrag | null>(null);
  const tabDragStart = useRef<number | null>(null);
  // Inline tab rename: double-click, F2 or the context menu turn the label into an input. The ref
  // mirrors the state so blur after Enter/Escape cannot commit twice or resurrect a cancelled edit.
  const [renaming, setRenaming] = useState<{ tabId: string; value: string } | null>(null);
  const renameRef = useRef<{ tabId: string; value: string } | null>(null);
  const setRename = (next: { tabId: string; value: string } | null) => {
    renameRef.current = next;
    setRenaming(next);
  };
  const project = workspace.projects.find((p) => p.id === workspace.selection?.projectId);
  const retained = useRetainedProjects(
    project?.id ?? null,
    workspace.projects.map((p) => p.id),
  );
  const selected = project?.tabs.find((tab) => tab.id === workspace.selection?.tabId);
  // The reordered tabs are drawn in place of the shifted ones in the same frame, without sliding.
  const tabOrder = project?.tabs.map((tab) => tab.id).join();
  const [shownTabOrder, setShownTabOrder] = useState(tabOrder);
  if (tabOrder !== shownTabOrder) {
    setShownTabOrder(tabOrder);
    if (tabDrag?.dropped) setTabDrag(null);
  }
  // A move the daemon refused slides the tabs back.
  useEffect(() => {
    if (!tabDrag?.dropped) return;
    const timer = setTimeout(() => setTabDrag(null), 1000);
    return () => clearTimeout(timer);
  }, [tabDrag?.dropped]);
  const tabCount = (project?.tabs.length ?? 0) + projectFiles.length;
  const cycleTab = (delta: number) => {
    if (!project || tabCount < 2) return;
    const targets = [
      ...project.tabs.map((tab) => ({ id: tab.id, file: false })),
      ...projectFiles.map((file) => ({ id: file.id, file: true })),
    ];
    const index = targets.findIndex((target) => target.id === (activeFile?.id ?? selected?.id));
    const next = targets[(index + delta + targets.length) % targets.length];
    if (!next) return;
    files.select(scope, next.file ? next.id : null);
    if (!next.file) onCommand({ kind: "selection.set", projectId: project.id, tabId: next.id });
  };
  useCommand("previous-tab", tabCount > 1 && canEdit, () => cycleTab(-1));
  useCommand("next-tab", tabCount > 1 && canEdit, () => cycleTab(1));
  // A tab shrinks away before it closes. The command goes out once the animation has ended, so the
  // tabs after it never jump, and it reads the workspace as it is then.
  const tabList = useRef<HTMLDivElement>(null);
  const [closingTabs, setClosingTabs] = useState<ReadonlyMap<string, number>>(new Map());
  const closeSent = useRef(new Set<string>());
  const latestProject = useRef(project);
  useEffect(() => {
    latestProject.current = project;
  });
  const sendClose = (tabId: string) => {
    if (closeSent.current.has(tabId)) return;
    closeSent.current.add(tabId);
    const current = latestProject.current;
    if (current?.tabs.some((tab) => tab.id === tabId))
      onCommand({
        kind: "tab.close",
        projectId: current.id,
        expectedVersion: current.version,
        tabId,
      });
    // A close the daemon refused brings the tab back.
    setTimeout(() => {
      closeSent.current.delete(tabId);
      setClosingTabs((previous) => {
        const next = new Map(previous);
        next.delete(tabId);
        return next;
      });
    }, 1000);
  };
  const closeTab = (tabId: string) => {
    const element = tabList.current?.querySelector(`[data-tab-id="${tabId}"]`);
    if (!element || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      closeSent.current.delete(tabId);
      return sendClose(tabId);
    }
    closeSent.current.delete(tabId);
    setClosingTabs((previous) =>
      new Map(previous).set(tabId, element.getBoundingClientRect().width),
    );
    // In case the animation never runs, as in a window that is not being drawn.
    setTimeout(() => sendClose(tabId), TAB_CLOSE_MS * 3);
  };
  useCommand(
    "close-tab",
    !!project && (!!activeFile || (!!selected && canEdit)) && !launching,
    () => {
      if (activeFile) {
        files.close(activeFile);
        return;
      }
      if (selected) closeTab(selected.id);
    },
  );
  const shortcutTab = () => {
    const focused = document.activeElement
      ?.closest("[data-shortcut-tab-id]")
      ?.getAttribute("data-shortcut-tab-id");
    return project?.tabs.find((tab) => tab.id === focused) ?? selected;
  };
  const moveTab = (delta: number) => {
    const tab = shortcutTab();
    if (!project || !tab) return;
    const index = project.tabs.findIndex((item) => item.id === tab.id) + delta;
    if (index >= 0 && index < project.tabs.length)
      onCommand({
        kind: "tab.move",
        projectId: project.id,
        expectedVersion: project.version,
        tabId: tab.id,
        index,
      });
  };
  useCommand("rename-tab", !!project && connected && !activeFile, () => {
    const tab = shortcutTab();
    if (tab)
      setRename({ tabId: tab.id, value: tabTitle(tab, agentsRef.current, connection?.terminals) });
  });
  useCommand("move-tab-left", !!project && canEdit && !activeFile, () => moveTab(-1));
  useCommand("move-tab-right", !!project && canEdit && !activeFile, () => moveTab(1));
  const [resuming, setResuming] = useState(false);
  const canResume = !!project && canEdit && !launching && project.tabs.length < 32;
  useCommand("resume-chat", canResume, () => setResuming(true));
  if (!project)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FolderOpen className="size-10 text-muted-foreground/50" />
        <h2 className="text-lg font-medium">Start working on this machine</h2>
        <Button onClick={onAddProject} disabled={!canEdit}>
          <Plus />
          New workspace
        </Button>
        <Button
          variant="ghost"
          onClick={(event) => onOpenFolder("open", event.currentTarget)}
          disabled={!canEdit}
        >
          Open folder…
        </Button>
      </div>
    );
  const createTab = (profile: PaneProfile, terminalProfileId?: string) => {
    files.select(scope, null);
    if (!connection?.workspace || !canEdit || creating.current) return;
    const sourcePane =
      selected?.nodes.find((node) => node.kind === "pane" && node.id === lastFocusedPane.current) ??
      selected?.nodes.find((node) => node.kind === "pane");
    const tabId = crypto.randomUUID();
    const paneId = crypto.randomUUID();
    creating.current = true;
    setLaunching(true);
    setLaunchError(null);
    void (async () => {
      await execute({
        kind: "tab.create",
        projectId: project.id,
        expectedVersion: project.version,
        tabId,
        paneId,
        name: nextWorkspaceTabName(project.tabs),
        profile,
        ...(terminalProfileId ? { terminalProfileId } : {}),
        ...(sourcePane ? { sourcePaneId: sourcePane.id } : {}),
      });
      // Each mounted pane starts its own session, including split and converted panes.
    })()
      .catch((cause: unknown) => {
        setLaunchError(cause instanceof Error ? cause.message : "Could not start session");
      })
      .finally(() => {
        creating.current = false;
        setLaunching(false);
      });
  };
  // Not gated on `canEdit`: a double-click's first click selects the tab, which briefly marks a
  // command as pending, and the second click must still open the editor.
  const startRename = (tab: WorkspaceTab) => {
    if (connected)
      setRename({ tabId: tab.id, value: tabTitle(tab, agentsRef.current, connection?.terminals) });
  };
  const commitRename = () => {
    const current = renameRef.current;
    if (!current) return;
    setRename(null);
    const tab = project.tabs.find((item) => item.id === current.tabId);
    const name = current.value.trim().slice(0, 120);
    // Keeping the title it already shows leaves an unnamed tab following its pane.
    if (!tab || !name || name === tabTitle(tab, agentsRef.current, connection?.terminals)) return;
    onCommand({
      kind: "tab.rename",
      projectId: project.id,
      expectedVersion: project.version,
      tabId: tab.id,
      name,
    });
  };
  return (
    <ProjectFileLinks project={project}>
      <div className="flex h-full min-h-0 flex-col">
        <h1 className="sr-only">{project.name}</h1>
        <LatestAgents targetRef={agentsRef} />
        <div
          data-tour="tabs"
          data-tauri-drag-region={titleBar ? "true" : undefined}
          className={cn(
            "flex shrink-0 items-center gap-2 border-b px-2 select-none",
            windowChrome.inset ? "title-bar-row h-11" : "min-h-9 py-1",
          )}
        >
          {sidebarToggle}
          <div
            ref={tabList}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            data-tauri-drag-region={titleBar ? "true" : undefined}
            aria-label="Project tabs"
            onDragOver={(event) => {
              const drag = tabDrag;
              if (!canEdit || !drag || drag.dropped || drag.projectId !== project.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const to = tabDropIndex(drag, tabListX(event.currentTarget, event.clientX));
              if (to !== drag.to) setTabDrag({ ...drag, to });
            }}
            onDrop={(event) => {
              const drag = tabDrag;
              if (!drag || drag.dropped || drag.projectId !== project.id) return;
              event.preventDefault();
              if (!canEdit || drag.to === drag.from) return setTabDrag(null);
              setTabDrag({ ...drag, dropped: true });
              onCommand({
                kind: "tab.move",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: drag.tabId,
                index: drag.to,
              });
            }}
          >
            {project.tabs.map((tab, index) => (
              <ContextMenu.Root key={tab.id}>
                <ContextMenu.Trigger asChild>
                  <div
                    data-tab-id={tab.id}
                    onAnimationEnd={(event) => {
                      if (event.animationName === "tab-close") sendClose(tab.id);
                    }}
                    draggable={canEdit && renaming?.tabId !== tab.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", tab.id);
                      const list = tabList.current;
                      if (!list) return;
                      const slots = [...list.querySelectorAll("[data-tab-id]")].map((element) => {
                        const rect = element.getBoundingClientRect();
                        return { left: tabListX(list, rect.left), width: rect.width };
                      });
                      const drag: TabDrag = {
                        projectId: project.id,
                        tabId: tab.id,
                        from: index,
                        to: index,
                        slots,
                        gap: parseFloat(getComputedStyle(list).columnGap) || 0,
                        dropped: false,
                      };
                      // Next frame, so the drag image is the tab and not its grey slot.
                      tabDragStart.current = requestAnimationFrame(() => {
                        tabDragStart.current = null;
                        setTabDrag(drag);
                      });
                    }}
                    onDragEnd={() => {
                      if (tabDragStart.current != null) cancelAnimationFrame(tabDragStart.current);
                      tabDragStart.current = null;
                      setTabDrag((drag) => (drag?.dropped ? drag : null));
                    }}
                    style={
                      {
                        transform:
                          tabDrag?.projectId === project.id
                            ? `translateX(${tabShift(tabDrag, index)}px)`
                            : undefined,
                        "--tab-width": `${closingTabs.get(tab.id) ?? 0}px`,
                      } as React.CSSProperties
                    }
                    className={cn(
                      "project-tab group flex shrink-0 items-center rounded-md border",
                      !activeFile && selected?.id === tab.id
                        ? "border-transparent bg-muted"
                        : "border-transparent",
                      closingTabs.has(tab.id) && "tab-closing",
                      tabDrag && !tabDrag.dropped && "tab-sliding",
                      tabDrag?.tabId === tab.id && "bg-muted-foreground/20 *:invisible",
                    )}
                  >
                    {renaming?.tabId === tab.id ? (
                      <input
                        aria-label="Tab name"
                        autoFocus
                        value={renaming.value}
                        maxLength={120}
                        size={Math.max(4, Math.min(40, renaming.value.length + 1))}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) =>
                          setRename({ tabId: tab.id, value: event.target.value })
                        }
                        onBlur={commitRename}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitRename();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            setRename(null);
                          }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        className="max-w-44 rounded bg-background px-2 py-0.5 text-ui ring-1 ring-ring outline-none"
                      />
                    ) : (
                      <TabButton
                        tab={tab}
                        selected={!activeFile && selected?.id === tab.id}
                        data-shortcut-tab-id={tab.id}
                        title={`Drag to reorder. Double-click to rename. Rename: ${shortcutLabel("rename-tab")}. Move left: ${shortcutLabel("move-tab-left")}. Move right: ${shortcutLabel("move-tab-right")}.`}
                        onDoubleClick={() => startRename(tab)}
                        disabled={!connected}
                        onClick={() => {
                          files.select(scope, null);
                          if (!activeFile && selected?.id === tab.id) return;
                          onCommand({
                            kind: "selection.set",
                            projectId: project.id,
                            tabId: tab.id,
                          });
                        }}
                      />
                    )}
                    <CloseTabButton
                      tab={tab}
                      disabled={!canEdit}
                      onClick={() => closeTab(tab.id)}
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground [@media(hover:none)]:opacity-100"
                    >
                      <X className="size-3" />
                    </CloseTabButton>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content
                    className="z-50 min-w-40 rounded-[calc(var(--radius)+(0.25rem+1px)*var(--concentric))] border bg-popover p-1 text-ui text-popover-foreground shadow-md"
                    onCloseAutoFocus={(event) => {
                      // Keep focus on the rename input instead of returning it to the tab.
                      if (renameRef.current?.tabId === tab.id) event.preventDefault();
                    }}
                  >
                    <ContextMenu.Item
                      disabled={!connected}
                      onSelect={() => startRename(tab)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-disabled:opacity-40"
                    >
                      <Pencil className="size-4" /> Rename tab
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={!canEdit}
                      onSelect={() => closeTab(tab.id)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-disabled:opacity-40"
                    >
                      <X className="size-4" /> Close tab
                      <span aria-hidden="true" className="ml-auto text-xs text-muted-foreground">
                        {shortcutLabel("close-tab")}
                      </span>
                    </ContextMenu.Item>
                  </ContextMenu.Content>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            ))}
            {projectFiles.map((file) => (
              <FileTabLabel key={file.id} file={file} />
            ))}
            <NewTabMenu
              keyboard
              disabled={!canEdit || launching || project.tabs.length >= 32}
              onCreate={createTab}
              onResume={() => setResuming(true)}
            />
          </div>
          {titleBar && <div data-tauri-drag-region className="h-7 w-8 shrink-0" />}
          <FilesToggle />
          {!files.sidebar.open && <WindowControls />}
        </div>
        {launchError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs text-destructive"
          >
            <span>{launchError}</span>
            <Button variant="ghost" type="button" onClick={() => setLaunchError(null)}>
              Dismiss
            </Button>
          </div>
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {activeFile && (
              <ProjectFileLinks project={{ ...project, directory: activeFile.directory }}>
                <FileTab key={activeFile.id} file={activeFile} />
              </ProjectFileLinks>
            )}
            {/* Recent projects' visited tabs stay mounted, so switching back to one is instant. */}
            {workspace.projects
              .filter((owner) => retained.has(owner.id))
              .flatMap((owner) =>
                owner.tabs.map((tab) => {
                  const active = !activeFile && owner.id === project.id && tab.id === selected?.id;
                  return (
                    <VisitedTab key={tab.id} active={active}>
                      <ProjectFileLinks project={owner}>
                        <PaneLayout
                          focusRequest={active ? (focusRequest ?? null) : null}
                          onPaneFocus={(paneId) => {
                            lastFocusedPane.current = paneId;
                            onPaneFocus?.(paneId);
                          }}
                          tab={tab}
                          project={owner}
                          canEdit={canEdit && !launching && active}
                          onCommand={onCommand}
                        />
                      </ProjectFileLinks>
                    </VisitedTab>
                  );
                }),
              )}
            {!activeFile && !selected && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <p>No tabs in this project yet.</p>
                <NewTabMenu
                  empty
                  disabled={!canEdit || launching}
                  onCreate={createTab}
                  onResume={() => setResuming(true)}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <ResumeChatDialog
        open={resuming && canResume}
        onOpenChange={setResuming}
        workspace={workspace}
        projectId={project.id}
        execute={execute}
      />
    </ProjectFileLinks>
  );
}

import { FilesToggle } from "@/files/sidebar";
import { FileTab, FileTabLabel } from "@/files/file-tab";
import { useFiles, fileScope } from "@/files/context";
import { ProjectFileLinks } from "@/files/provider";
import { useCommand } from "@/shortcuts/context";
import { shortcutLabel } from "@/shortcuts/bindings";
import type { PaneFocusRequest } from "./session-pane";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { NewTabMenu } from "./new-tab-menu";
import { TAB_PROFILES } from "./tab-profiles";
import { ContextMenu } from "radix-ui";
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { FolderOpen, Pencil, Plus, X } from "lucide-react";
import type { PaneProfile, WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { FormDialog } from "./form-dialog";
import { PaneLayout } from "./pane-layout";
import { VisitedTab } from "./visited-tab";

export function ProjectWorkspace({
  workspace,
  sidebarToggle,
  focusRequest,
  onPaneFocus,
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
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  onAddProject: () => void;
  onOpenFolder: (mode: "open" | "clone") => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const files = useFiles();
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
  const [dragging, setDragging] = useState<{ projectId: string; tabId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const project = workspace.projects.find((p) => p.id === workspace.selection?.projectId);
  const selected = project?.tabs.find((tab) => tab.id === workspace.selection?.tabId);
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
  useCommand(
    "close-tab",
    !!project && (!!activeFile || (!!selected && canEdit)) && !launching,
    () => {
      if (activeFile) {
        files.close(activeFile);
        return;
      }
      if (project && selected)
        onCommand({
          kind: "tab.close",
          projectId: project.id,
          expectedVersion: project.version,
          tabId: selected.id,
        });
    },
  );
  if (!project)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FolderOpen className="size-10 text-muted-foreground/50" />
        <div>
          <h2 className="text-lg font-medium">Start working on this machine</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Open a terminal and navigate to your code. Your workspace follows its folder.
          </p>
        </div>
        <Button onClick={onAddProject} disabled={!canEdit}>
          <Plus />
          New workspace
        </Button>
        <Button variant="ghost" onClick={() => onOpenFolder("open")} disabled={!canEdit}>
          Open folder…
        </Button>
      </div>
    );
  const createTab = (profile: PaneProfile, name?: string) => {
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
        name: name || (TAB_PROFILES.find((item) => item.profile === profile)?.label ?? "Terminal"),
        profile,
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
  const renameTab = project.tabs.find((tab) => tab.id === renaming);
  return (
    <ProjectFileLinks project={project}>
      <div className="flex h-full min-h-0 flex-col">
        <h1 className="sr-only">{project.name}</h1>
        <div className="flex min-h-9 shrink-0 items-center gap-2 px-2 py-1">
          {sidebarToggle}
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
            aria-label="Project tabs"
          >
            {project.tabs.map((tab, index) => (
              <ContextMenu.Root key={tab.id}>
                <ContextMenu.Trigger asChild>
                  <div
                    data-tab-id={tab.id}
                    draggable={canEdit}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", tab.id);
                      setDragging({ projectId: project.id, tabId: tab.id });
                    }}
                    onDragOver={(event) => {
                      if (!canEdit || dragging?.projectId !== project.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDropTarget(tab.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDropTarget(null);
                      setDragging(null);
                      if (
                        !canEdit ||
                        dragging?.projectId !== project.id ||
                        dragging.tabId === tab.id
                      )
                        return;
                      onCommand({
                        kind: "tab.move",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: dragging.tabId,
                        index,
                      });
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropTarget(null);
                    }}
                    style={{
                      opacity: dragging?.tabId === tab.id ? 0.5 : 1,
                      outline: dropTarget === tab.id ? "2px solid var(--primary)" : undefined,
                    }}
                    className={`group flex shrink-0 items-center rounded-md border ${!activeFile && selected?.id === tab.id ? "border-border bg-background shadow-xs" : "border-transparent"}`}
                  >
                    <button
                      type="button"
                      aria-pressed={!activeFile && selected?.id === tab.id}
                      title="Drag to reorder. Alt+Shift+Arrow keys also move this tab."
                      onKeyDown={(event) => {
                        if (
                          !canEdit ||
                          !event.altKey ||
                          !event.shiftKey ||
                          !["ArrowLeft", "ArrowRight"].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        const next = index + (event.key === "ArrowLeft" ? -1 : 1);
                        if (next >= 0 && next < project.tabs.length)
                          onCommand({
                            kind: "tab.move",
                            projectId: project.id,
                            expectedVersion: project.version,
                            tabId: tab.id,
                            index: next,
                          });
                      }}
                      disabled={!canEdit}
                      onClick={() => {
                        files.select(scope, null);
                        onCommand({ kind: "selection.set", projectId: project.id, tabId: tab.id });
                      }}
                      className="max-w-44 truncate px-2 py-0.5 text-ui"
                    >
                      {tab.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Close ${tab.name} tab`}
                      disabled={!canEdit}
                      onClick={() =>
                        onCommand({
                          kind: "tab.close",
                          projectId: project.id,
                          expectedVersion: project.version,
                          tabId: tab.id,
                        })
                      }
                      className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:text-foreground [@media(hover:none)]:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Content className="z-50 min-w-40 rounded-lg border bg-popover p-1 text-ui text-popover-foreground shadow-md">
                    <ContextMenu.Item
                      disabled={!canEdit}
                      onSelect={() => setRenaming(tab.id)}
                      className="flex items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent data-disabled:opacity-40"
                    >
                      <Pencil className="size-4" /> Rename tab
                    </ContextMenu.Item>
                    <ContextMenu.Item
                      disabled={!canEdit}
                      onSelect={() =>
                        onCommand({
                          kind: "tab.close",
                          projectId: project.id,
                          expectedVersion: project.version,
                          tabId: tab.id,
                        })
                      }
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
            />
          </div>
          <FilesToggle />
        </div>
        {launchError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs text-destructive"
          >
            <span>{launchError}</span>
            <button type="button" onClick={() => setLaunchError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {activeFile && (
              <ProjectFileLinks project={{ ...project, directory: activeFile.directory }}>
                <FileTab key={activeFile.id} file={activeFile} />
              </ProjectFileLinks>
            )}
            {project.tabs.map((tab) => {
              const active = !activeFile && tab.id === selected?.id;
              return (
                <VisitedTab key={tab.id} active={active}>
                  <PaneLayout
                    focusRequest={active ? (focusRequest ?? null) : null}
                    onPaneFocus={(paneId) => {
                      lastFocusedPane.current = paneId;
                      onPaneFocus?.(paneId);
                    }}
                    tab={tab}
                    project={project}
                    canEdit={canEdit && !launching && active}
                    onCommand={onCommand}
                  />
                </VisitedTab>
              );
            })}
            {!activeFile && !selected && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <p>No tabs in this project yet.</p>
                <NewTabMenu empty disabled={!canEdit || launching} onCreate={createTab} />
              </div>
            )}
          </div>
        </div>
        {renameTab && (
          <FormDialog
            title="Rename tab"
            description="The name updates on every connected client."
            fields={[{ name: "name", label: "Tab name", value: renameTab.name }]}
            onClose={() => setRenaming(null)}
            onSubmit={(values) =>
              execute({
                kind: "tab.rename",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: renameTab.id,
                name: values["name"] ?? "",
              })
            }
          />
        )}
      </div>
    </ProjectFileLinks>
  );
}

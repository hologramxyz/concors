import { TerminalConnectionContext } from "@/terminal/connection-context";
import { NewTabMenu } from "./new-tab-menu";
import { TAB_PROFILES } from "./tab-profiles";
import { ContextMenu } from "radix-ui";
import { useContext, useRef, useState } from "react";
import { FolderOpen, Pencil, Plus, X } from "lucide-react";
import type { PaneProfile, WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { FormDialog } from "./form-dialog";
import { PaneLayout } from "./pane-layout";

export function ProjectWorkspace({
  workspace,
  canEdit,
  onCommand,
  execute,
  onAddProject,
}: {
  workspace: WorkspaceSnapshot;
  canEdit: boolean;
  onCommand: (operation: WorkspaceOperation) => void;
  execute: (operation: WorkspaceOperation) => Promise<void>;
  onAddProject: () => void;
}) {
  const connection = useContext(TerminalConnectionContext);
  const creating = useRef(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ projectId: string; tabId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const project = workspace.projects.find((p) => p.id === workspace.selection?.projectId);
  if (!project)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <FolderOpen className="size-10 text-muted-foreground/50" />
        <div>
          <h2 className="text-lg font-medium">Your projects, in one place</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Add a project folder, then organize your work in tabs and split panes. Your layout stays
            with the machine.
          </p>
        </div>
        <Button onClick={onAddProject} disabled={!canEdit}>
          <Plus />
          Add project
        </Button>
      </div>
    );
  const createTab = (profile: PaneProfile, name?: string) => {
    if (!connection?.workspace || !canEdit || creating.current) return;
    const epoch = connection.workspace.epoch;
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
      });
      const current = connection.workspace;
      const updated = current?.projects.find((item) => item.id === project.id);
      if (current?.epoch !== epoch || !updated || connection.state.status !== "ready")
        throw new Error(
          "The tab was created, but the machine disconnected before its session started.",
        );
      const target = {
        kind: "start" as const,
        epoch,
        projectId: project.id,
        tabId,
        paneId,
        expectedVersion: updated.version,
      };
      const result =
        profile === "chat"
          ? await connection.requestAgent(target, crypto.randomUUID())
          : await connection.requestTerminal(
              { ...target, expectedSessionId: null, cols: 80, rows: 24 },
              crypto.randomUUID(),
            );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    })()
      .catch((cause: unknown) => {
        setLaunchError(cause instanceof Error ? cause.message : "Could not start session");
      })
      .finally(() => {
        creating.current = false;
        setLaunching(false);
      });
  };
  const selected = project.tabs.find((tab) => tab.id === workspace.selection?.tabId);
  const renameTab = project.tabs.find((tab) => tab.id === renaming);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center bg-muted/20 px-2">
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
                    if (!canEdit || dragging?.projectId !== project.id || dragging.tabId === tab.id)
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
                  className={`group flex shrink-0 items-center rounded-md border ${selected?.id === tab.id ? "border-border bg-background shadow-xs" : "border-transparent"}`}
                >
                  <button
                    type="button"
                    aria-pressed={selected?.id === tab.id}
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
                    onClick={() =>
                      onCommand({ kind: "selection.set", projectId: project.id, tabId: tab.id })
                    }
                    className="max-w-44 truncate px-2 py-0.5 text-[12px]"
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
                <ContextMenu.Content className="z-50 min-w-40 rounded-lg border bg-popover p-1 text-[13px] text-popover-foreground shadow-md">
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
                  </ContextMenu.Item>
                </ContextMenu.Content>
              </ContextMenu.Portal>
            </ContextMenu.Root>
          ))}
          <NewTabMenu
            disabled={!canEdit || launching || project.tabs.length >= 32}
            onCreate={createTab}
          />
        </div>
      </div>
      {launching && (
        <p role="status" className="border-b px-3 py-1 text-xs text-muted-foreground">
          Starting session…
        </p>
      )}
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
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {selected ? (
          <PaneLayout
            key={selected.id}
            tab={selected}
            project={project}
            canEdit={canEdit && !launching}
            onCommand={onCommand}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>No tabs in this project yet.</p>
            <NewTabMenu empty disabled={!canEdit || launching} onCreate={createTab} />
          </div>
        )}
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
  );
}

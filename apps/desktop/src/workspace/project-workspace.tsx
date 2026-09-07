import { useState } from "react";
import { ArrowLeft, ArrowRight, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";
import type { WorkspaceOperation, WorkspaceSnapshot } from "@concors/protocol";
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
  const selected = project.tabs.find((tab) => tab.id === workspace.selection?.tabId);
  const renameTab = project.tabs.find((tab) => tab.id === renaming);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center border-b bg-muted/20 px-2">
        <div
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          aria-label="Project tabs"
        >
          {project.tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`group flex shrink-0 items-center rounded-md border ${selected?.id === tab.id ? "border-border bg-background shadow-xs" : "border-transparent"}`}
            >
              <button
                type="button"
                aria-pressed={selected?.id === tab.id}
                disabled={!canEdit}
                onClick={() =>
                  onCommand({ kind: "selection.set", projectId: project.id, tabId: tab.id })
                }
                className="max-w-44 truncate px-3 py-1.5 text-xs"
              >
                {tab.name}
              </button>
              {selected?.id === tab.id && (
                <>
                  <button
                    type="button"
                    aria-label="Move tab left"
                    title="Move tab left"
                    disabled={!canEdit || index === 0}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    onClick={() =>
                      onCommand({
                        kind: "tab.move",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: tab.id,
                        index: index - 1,
                      })
                    }
                  >
                    <ArrowLeft className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move tab right"
                    title="Move tab right"
                    disabled={!canEdit || index === project.tabs.length - 1}
                    className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-20"
                    onClick={() =>
                      onCommand({
                        kind: "tab.move",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: tab.id,
                        index: index + 1,
                      })
                    }
                  >
                    <ArrowRight className="size-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Rename tab"
                    title="Rename tab"
                    disabled={!canEdit}
                    onClick={() => setRenaming(tab.id)}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3" />
                  </button>
                </>
              )}
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
                className="p-1.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            aria-label="New tab"
            disabled={!canEdit || project.tabs.length >= 32}
            onClick={() =>
              onCommand({
                kind: "tab.create",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: crypto.randomUUID(),
                paneId: crypto.randomUUID(),
                name: `Tab ${project.tabs.length + 1}`,
                profile: "shell",
              })
            }
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
        <button
          type="button"
          aria-label="Remove project from workspace"
          title="Remove project from workspace (keeps files)"
          disabled={!canEdit}
          onClick={() => {
            if (
              window.confirm(
                `Remove ${project.name} and its saved tabs from this workspace? Files will be kept.`,
              )
            )
              onCommand({
                kind: "project.remove",
                projectId: project.id,
                expectedVersion: project.version,
              });
          }}
          className="ml-2 rounded p-1.5 text-muted-foreground hover:bg-muted"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {selected ? (
          <PaneLayout
            key={selected.id}
            tab={selected}
            project={project}
            canEdit={canEdit}
            onCommand={onCommand}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <p>No tabs in this project yet.</p>
            <Button
              variant="outline"
              disabled={!canEdit}
              onClick={() =>
                onCommand({
                  kind: "tab.create",
                  projectId: project.id,
                  expectedVersion: project.version,
                  tabId: crypto.randomUUID(),
                  paneId: crypto.randomUUID(),
                  name: "Tab 1",
                  profile: "shell",
                })
              }
            >
              <Plus />
              Create a tab
            </Button>
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

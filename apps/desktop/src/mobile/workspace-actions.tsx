import { useContext, useState } from "react";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { useCommand } from "@/shortcuts/context";
import { Columns2, Rows2, Ellipsis, Pencil, X, ArrowLeft, ArrowRight, Move } from "lucide-react";
import type {
  PaneProfile,
  WorkspaceOperation,
  WorkspaceProject,
  WorkspaceTab,
} from "@concors/protocol";
import type { MobileTarget } from "@concors/client-core";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { FormDialog } from "@/workspace/form-dialog";
import { Button } from "@/components/ui/button";
import { PROFILE_LABELS, tabPanes, type PaneNode } from "./selection";

export function WorkspaceActions({
  project,
  tab,
  pane,
  canEdit,
  execute,
  command,
  onSelect,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab;
  pane: PaneNode;
  canEdit: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
}) {
  const [rename, setRename] = useState(false);
  const [layout, setLayout] = useState(false);
  const [closing, setClosing] = useState<"pane" | "tab" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connection = useContext(TerminalConnectionContext);
  const capabilities =
    connection?.state.status === "ready" ? (connection.state.daemon.capabilities ?? []) : [];
  const directional = capabilities.includes("directional-pane-split");
  const rearrange = capabilities.includes("workspace-pane-rearrangement");
  const target = {
    projectId: project.id,
    expectedVersion: project.version,
    tabId: tab.id,
    paneId: pane.id,
  };
  const split = (axis: "horizontal" | "vertical", before = false) => {
    const newPaneId = crypto.randomUUID();
    void execute({
      kind: "pane.split",
      ...target,
      splitId: crypto.randomUUID(),
      newPaneId,
      axis,
      ...(before ? { before } : {}),
      profile: pane.profile,
    })
      .then(() => onSelect({ projectId: project.id, tabId: tab.id, paneId: newPaneId }))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not split pane"),
      );
  };
  const index = project.tabs.findIndex((item) => item.id === tab.id);
  const canSplit = canEdit && tab.nodes.length < 63;
  useCommand("new-pane", canSplit, () => split("horizontal"));
  useCommand("split-horizontal", canSplit, () => split("horizontal"));
  useCommand("split-vertical", canSplit, () => split("vertical"));
  useCommand("split-left", canSplit && directional, () => split("horizontal", true));
  useCommand("split-up", canSplit && directional, () => split("vertical", true));
  useCommand("close-pane", canEdit, () => setClosing("pane"));
  useCommand("close-tab", canEdit, () => setClosing("tab"));
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="mobile-icon" aria-label="Tab and pane actions">
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel>{tab.name}</DropdownMenuLabel>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setRename(true)}>
            <Pencil />
            Rename tab
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canEdit || index <= 0}
            onSelect={() =>
              command({
                kind: "tab.move",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: tab.id,
                index: index - 1,
              })
            }
          >
            <ArrowLeft />
            Move tab left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canEdit || index >= project.tabs.length - 1}
            onSelect={() =>
              command({
                kind: "tab.move",
                projectId: project.id,
                expectedVersion: project.version,
                tabId: tab.id,
                index: index + 1,
              })
            }
          >
            <ArrowRight />
            Move tab right
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing("tab")}>
            <X />
            Close tab…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Current pane</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!canEdit || tab.nodes.length >= 63}
            onSelect={() => split("horizontal")}
          >
            <Columns2 />
            Split horizontally
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canEdit || tab.nodes.length >= 63}
            onSelect={() => split("vertical")}
          >
            <Rows2 />
            Split vertically
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canSplit || !directional}
            onSelect={() => split("horizontal", true)}
          >
            <Columns2 /> New pane to the left
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canSplit || !directional}
            onSelect={() => split("vertical", true)}
          >
            <Rows2 /> New pane above
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!canEdit || !rearrange || tab.nodes.length < 3}
            onSelect={() => setLayout(true)}
          >
            <Move />
            Arrange panes…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!canEdit} onSelect={() => setClosing("pane")}>
            <X />
            Close pane…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Pane profile</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={pane.profile}
            onValueChange={(profile) =>
              command({ kind: "pane.configure", ...target, profile: profile as PaneProfile })
            }
          >
            {Object.entries(PROFILE_LABELS).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value} disabled={!canEdit}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <Dialog open onOpenChange={() => setError(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Workspace action failed</DialogTitle>
              <DialogDescription>{error}</DialogDescription>
            </DialogHeader>
          </DialogContent>
        </Dialog>
      )}
      {rename && (
        <FormDialog
          title="Rename tab"
          description="The name updates on every connected client."
          fields={[{ name: "name", label: "Tab name", value: tab.name }]}
          onClose={() => setRename(false)}
          onSubmit={(values) =>
            execute({
              kind: "tab.rename",
              projectId: project.id,
              expectedVersion: project.version,
              tabId: tab.id,
              name: values["name"] ?? "",
            })
          }
        />
      )}
      <Dialog
        open={!!closing}
        onOpenChange={(open) => {
          if (!open && !busy) setClosing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {closing}?</DialogTitle>
            <DialogDescription>
              This removes the saved {closing} on all connected devices. Machine processes remain
              governed by the daemon's session lifecycle.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setClosing(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!canEdit || busy}
              onClick={() => {
                setBusy(true);
                void execute(
                  closing === "tab"
                    ? {
                        kind: "tab.close",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: tab.id,
                      }
                    : { kind: "pane.close", ...target },
                )
                  .then(() => {
                    setClosing(null);
                    onSelect({
                      projectId: project.id,
                      ...(closing === "pane" ? { tabId: tab.id } : {}),
                    });
                  })
                  .catch((cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : "Could not close"),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              Close {closing}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={layout} onOpenChange={setLayout}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Arrange panes</DialogTitle>
            <DialogDescription>
              These explicit changes update the desktop layout too. Selecting a pane does not.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              command({
                kind: "pane.move",
                ...target,
                targetPaneId: String(data.get("target")),
                placement: data.get("placement") as "left" | "right" | "top" | "bottom",
                scope: data.get("scope") as "pane" | "workspace",
                splitId: crypto.randomUUID(),
              });
            }}
          >
            <label className="block space-y-2">
              Move current pane next to
              <select name="target" className="mobile-select">
                {tabPanes(tab)
                  .filter((node) => node.id !== pane.id)
                  .map((node, i) => (
                    <option key={node.id} value={node.id}>
                      {PROFILE_LABELS[node.profile]} {i + 1}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-2">
              Placement
              <select name="placement" className="mobile-select">
                {["left", "right", "top", "bottom", "center"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-2">
              Layout scope
              <select name="scope" className="mobile-select">
                <option value="pane">Next to selected pane</option>
                <option value="workspace">Edge of the whole tab</option>
              </select>
            </label>
            <Button disabled={!canEdit || !rearrange}>Move pane</Button>
          </form>
          {tab.nodes
            .filter((node) => node.kind === "split")
            .map((node, index) => (
              <label key={node.id} className="block space-y-2">
                Split {index + 1} · {node.axis}
                <input
                  aria-label={`Split ${index + 1} ratio`}
                  type="range"
                  min="10"
                  max="90"
                  defaultValue={Math.round(node.ratio * 100)}
                  disabled={!canEdit}
                  className="w-full"
                  onPointerUp={(event) =>
                    command({
                      kind: "pane.resize",
                      projectId: project.id,
                      expectedVersion: project.version,
                      tabId: tab.id,
                      splitId: node.id,
                      ratio: Number(event.currentTarget.value) / 100,
                    })
                  }
                  onKeyUp={(event) => {
                    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
                      command({
                        kind: "pane.resize",
                        projectId: project.id,
                        expectedVersion: project.version,
                        tabId: tab.id,
                        splitId: node.id,
                        ratio: Number(event.currentTarget.value) / 100,
                      });
                  }}
                />
              </label>
            ))}
        </DialogContent>
      </Dialog>
    </>
  );
}

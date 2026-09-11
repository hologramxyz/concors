import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import type { MobileTarget } from "@concors/client-core";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PaneProfileIcon } from "@/workspace/profile-icon";
import { projectPanes, type PaneNode } from "./selection";
import { WorkspaceActions } from "./workspace-actions";
import { useNativeSurface } from "@/components/native-surface";

/** Navigation and management share a drawer, with separate buttons (never nested option actions). */
export function WorkspacePicker({
  project,
  tab,
  pane,
  canEdit,
  keyboard,
  execute,
  command,
  onSelect,
  onNewTab,
}: {
  project: WorkspaceProject;
  tab: WorkspaceTab | null;
  pane: PaneNode | null;
  canEdit: boolean;
  keyboard: boolean;
  execute(operation: WorkspaceOperation): Promise<void>;
  command(operation: WorkspaceOperation): void;
  onSelect(target: MobileTarget): void;
  onNewTab(): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const entries = projectPanes(project);
  const selected = entries.find((entry) => entry.tab.id === tab?.id && entry.pane.id === pane?.id);
  const title = selected?.label ?? project.name;
  const subtitle = selected?.profileLabel ?? "Tabs";
  const native = useNativeSurface(
    trigger,
    {
      kind: "button",
      icon: "chevron",
      label: "Tabs",
      title,
      subtitle,
      disabled: false,
    },
    (event) => {
      if (event.kind === "press" && event.control === "activate") setOpen((value) => !value);
    },
  );
  const choose = (tabId: string, paneId?: string) => {
    setOpen(false);
    onSelect({ projectId: project.id, tabId, paneId });
  };
  return (
    <>
      {/* Keep active-pane shortcuts registered when the drawer's contents are unmounted. */}
      {tab && pane && (
        <WorkspaceActions
          key={`${tab.id}:${pane.id}`}
          label="Active tab actions"
          project={project}
          tab={tab}
          pane={pane}
          canEdit={canEdit}
          execute={execute}
          command={command}
          onSelect={onSelect}
          selected
          keyboard={keyboard && !open}
          showTrigger={false}
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button
            ref={trigger}
            data-native-surface={native || undefined}
            aria-hidden={native || undefined}
            tabIndex={native ? -1 : undefined}
            className="mobile-select-trigger mobile-picker mobile-glass"
            type="button"
            role="combobox"
            aria-label="Tabs"
            aria-haspopup="dialog"
            aria-controls={id}
            aria-expanded={open}
            data-value={tab && pane ? `${tab.id}:${pane.id}` : ""}
            onKeyDown={(event) => {
              if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                setOpen(true);
              }
            }}
          >
            <span className="mobile-picker-breadcrumb">
              <span>{title}</span>
              <span>{subtitle}</span>
            </span>
            <span className="mobile-select-chevron">
              <ChevronDown />
            </span>
          </button>
        </DialogTrigger>
        <DialogContent
          id={id}
          className="mobile-select-sheet mobile-workspace-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (
              content.current?.querySelector<HTMLElement>(
                '[data-pane-choice][aria-pressed="true"]',
              ) ?? content.current?.querySelector<HTMLElement>("button")
            )?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => {
              if (!document.querySelector('[data-slot="dialog-content"][data-state="open"]'))
                trigger.current?.focus({ preventScroll: true });
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Tabs</DialogTitle>
          </DialogHeader>
          <div
            ref={content}
            className="mobile-workspace-list"
            onKeyDown={(event) => {
              if (
                !(event.target instanceof HTMLElement) ||
                !event.target.matches("[data-pane-choice]")
              )
                return;
              const items = [
                ...(content.current?.querySelectorAll<HTMLButtonElement>("[data-pane-choice]") ??
                  []),
              ];
              const index = items.indexOf(event.target as HTMLButtonElement);
              const next =
                event.key === "ArrowDown"
                  ? items[(index + 1) % items.length]
                  : event.key === "ArrowUp"
                    ? items[(index - 1 + items.length) % items.length]
                    : event.key === "Home"
                      ? items[0]
                      : event.key === "End"
                        ? items.at(-1)
                        : null;
              if (next) {
                event.preventDefault();
                next.focus();
              }
            }}
          >
            {entries.map(({ tab: item, pane: node, label, profileLabel }) => {
              const active = tab?.id === item.id && pane?.id === node.id;
              return (
                <div key={`${item.id}:${node.id}`} className="mobile-pane-row">
                  <button
                    type="button"
                    data-pane-choice
                    data-value={`${item.id}:${node.id}`}
                    aria-pressed={active}
                    className="mobile-pane-choice"
                    onClick={() => choose(item.id, node.id)}
                  >
                    <PaneProfileIcon profile={node.profile} />
                    <span>
                      <span className="block truncate">{label}</span>
                      <small className="truncate">{profileLabel}</small>
                    </span>
                    {active && <Check className="mobile-pane-selected" />}
                  </button>
                  <WorkspaceActions
                    label={`Actions for tab ${label}`}
                    project={project}
                    tab={item}
                    pane={node}
                    selected={active}
                    canEdit={canEdit}
                    execute={execute}
                    command={command}
                    onSelect={onSelect}
                    onComplete={() => setOpen(false)}
                  />
                </div>
              );
            })}
            {!project.tabs.length && (
              <p className="p-3 text-sm text-muted-foreground">
                Create your first tab to start a conversation.
              </p>
            )}
          </div>
          <button
            type="button"
            className="mobile-new-tab-button"
            disabled={!canEdit || project.tabs.length >= 32}
            onClick={() => {
              setOpen(false);
              onNewTab();
            }}
          >
            <Plus />
            New tab
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}

import { useId, useRef, useState } from "react";
import { Check, ChevronDown, PanelsTopLeft, Plus } from "lucide-react";
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
import { PROFILE_LABELS, tabPanes, type PaneNode } from "./selection";
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
  onNewPane,
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
  onNewPane(tabId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const subtitle =
    pane && tab
      ? `${pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile]} · Pane ${tabPanes(tab).findIndex((item) => item.id === pane.id) + 1}`
      : "Tabs and panes";
  const native = useNativeSurface(
    trigger,
    {
      kind: "button",
      icon: "chevron",
      label: "Tabs and panes",
      title: tab?.name ?? project.name,
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
  const createPane = (tabId: string) => {
    setOpen(false);
    onNewPane(tabId);
  };
  return (
    <>
      {/* Keep active-pane shortcuts registered when the drawer's contents are unmounted. */}
      {tab &&
        pane &&
        (["tab", "pane"] as const).map((kind) => (
          <WorkspaceActions
            key={kind}
            kind={kind}
            label={`Active ${kind} actions`}
            project={project}
            tab={tab}
            pane={pane}
            canEdit={canEdit}
            execute={execute}
            command={command}
            onSelect={onSelect}
            onNewPane={() => createPane(tab.id)}
            keyboard={keyboard && !open}
            showTrigger={false}
          />
        ))}
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
            aria-label="Tabs and panes"
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
              <span>{tab?.name ?? project.name}</span>
              <span>
                {pane && tab
                  ? `${pane.terminalProfile?.name ?? PROFILE_LABELS[pane.profile]} · Pane ${tabPanes(tab).findIndex((item) => item.id === pane.id) + 1}`
                  : "Tabs and panes"}
              </span>
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
            <DialogTitle>Tabs and panes</DialogTitle>
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
            {project.tabs.map((item) => {
              const panes = tabPanes(item),
                first = panes[0];
              return (
                <section
                  key={item.id}
                  aria-label={`${item.name} tab`}
                  className="mobile-tab-card"
                  data-active={tab?.id === item.id}
                >
                  <div className="mobile-tab-card-heading">
                    <button
                      type="button"
                      className="mobile-tab-choice"
                      onClick={() => choose(item.id, item.id === tab?.id ? pane?.id : first?.id)}
                      aria-label={`Open tab ${item.name}`}
                    >
                      <PanelsTopLeft />
                      <span>{item.name}</span>
                      <span className="mobile-pane-count">{panes.length}</span>
                    </button>
                    {first && (
                      <WorkspaceActions
                        kind="tab"
                        label={`Actions for tab ${item.name}`}
                        project={project}
                        tab={item}
                        pane={first}
                        canEdit={canEdit}
                        execute={execute}
                        command={command}
                        onSelect={(target) => {
                          setOpen(false);
                          onSelect(target);
                        }}
                        onComplete={() => setOpen(false)}
                        onNewPane={() => createPane(item.id)}
                      />
                    )}
                  </div>
                  <div className="mobile-tab-panes">
                    {panes.map((node, index) => (
                      <div key={node.id} className="mobile-pane-row">
                        <button
                          type="button"
                          data-pane-choice
                          data-value={`${item.id}:${node.id}`}
                          aria-pressed={tab?.id === item.id && pane?.id === node.id}
                          className="mobile-pane-choice"
                          onClick={() => choose(item.id, node.id)}
                        >
                          <PaneProfileIcon profile={node.profile} />
                          <span>
                            {node.terminalProfile?.name ?? PROFILE_LABELS[node.profile]}
                            <small>Pane {index + 1}</small>
                          </span>
                          {tab?.id === item.id && pane?.id === node.id && (
                            <Check className="mobile-pane-selected" />
                          )}
                        </button>
                        <WorkspaceActions
                          kind="pane"
                          label={`Actions for pane ${index + 1} in ${item.name}`}
                          project={project}
                          tab={item}
                          pane={node}
                          canEdit={canEdit}
                          execute={execute}
                          command={command}
                          onSelect={(target) => {
                            setOpen(false);
                            onSelect(target);
                          }}
                          onComplete={() => setOpen(false)}
                          onNewPane={() => createPane(item.id)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
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

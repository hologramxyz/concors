import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Pin, Plus } from "lucide-react";
import type { MobileTarget } from "@concors/client-core";
import type { WorkspaceOperation, WorkspaceProject, WorkspaceTab } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RowDot, RowWorking } from "@/workspace/sidebar-tabs";
import { paneState } from "@/workspace/sidebar-rows";
import { paneAgentStatus } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { projectPanes, type PaneNode } from "./selection";
import { WorkspaceActions, type TabStep } from "./workspace-actions";
import { useNativeSurface } from "@/components/native-surface";

interface Handoff {
  tabId: string;
  paneId: string;
  step: TabStep;
  count: number;
}

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
  // A row's dialog opens once this sheet has gone, so it shows alone; the count remounts it.
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const pendingHandoff = useRef<Handoff | null>(null);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const entries = projectPanes(project);
  const handoffEntry =
    handoff &&
    entries.find((entry) => entry.tab.id === handoff.tabId && entry.pane.id === handoff.paneId);
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const selected = entries.find((entry) => entry.tab.id === tab?.id && entry.pane.id === pane?.id);
  // The tab's name alone, as the sidebar names it; what kind of tab it is shows on the tab itself.
  const title = selected?.label ?? project.name;
  const native = useNativeSurface(
    trigger,
    {
      kind: "button",
      icon: "chevron",
      label: "Tabs",
      title,
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
          title={selected?.label ?? tab.name}
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
      {handoff && handoffEntry && (
        <WorkspaceActions
          key={handoff.count}
          label={`Actions for tab ${handoffEntry.label}`}
          title={handoffEntry.label}
          project={project}
          tab={handoffEntry.tab}
          pane={handoffEntry.pane}
          selected={tab?.id === handoff.tabId && pane?.id === handoff.paneId}
          canEdit={canEdit}
          execute={execute}
          command={command}
          onSelect={onSelect}
          step={handoff.step}
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
            const next = pendingHandoff.current;
            pendingHandoff.current = null;
            if (next) {
              setHandoff(next);
              return;
            }
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
            {entries.map(({ tab: item, pane: node, label }) => {
              const active = tab?.id === item.id && pane?.id === node.id;
              // Drawn as the sidebar draws a tab: its dot before the name, a spinner while replying.
              const status = paneAgentStatus(node, chats, terminals);
              const state = paneState(node, chats, terminals);
              // Marked as desktop's sidebar marks it; the sheet keeps the tab strip's order.
              const pinned = !!chats.find((chat) => chat.id === node.sessionId)?.pinned;
              return (
                <div key={`${item.id}:${node.id}`} className="mobile-pane-row">
                  <button
                    type="button"
                    data-pane-choice
                    data-value={`${item.id}:${node.id}`}
                    aria-pressed={active}
                    // Read out beside the tab's name, which stays the button's name.
                    aria-description={
                      status ? `${status.providerName}: ${status.status}` : undefined
                    }
                    className="mobile-pane-choice"
                    onClick={() => choose(item.id, node.id)}
                  >
                    <RowDot state={state} status={status} />
                    <span className="block min-w-0 flex-1 truncate">{label}</span>
                    {pinned && <Pin className="mobile-pane-pinned" aria-label="Pinned" />}
                    {state === "working" && <RowWorking />}
                    {active && <Check className="mobile-pane-selected" />}
                  </button>
                  <WorkspaceActions
                    label={`Actions for tab ${label}`}
                    title={label}
                    project={project}
                    tab={item}
                    pane={node}
                    selected={active}
                    canEdit={canEdit}
                    execute={execute}
                    command={command}
                    onSelect={onSelect}
                    onComplete={() => setOpen(false)}
                    onStep={(step) => {
                      pendingHandoff.current = {
                        tabId: item.id,
                        paneId: node.id,
                        step,
                        count: (handoff?.count ?? 0) + 1,
                      };
                      setOpen(false);
                    }}
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

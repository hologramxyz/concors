import { useId, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen } from "lucide-react";
import type { WorkspaceProject, WorkspaceSnapshot } from "@concors/protocol";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useNativeSurface } from "@/components/native-surface";
import { useAgents } from "@/agents/context";
import { useTerminalSessions } from "@/terminal/use-terminal-sessions";
import { workspaceAttention, workspaceAttentionLabel } from "@/agents/agent-status";
import { ProjectImage } from "@/workspace/project-image";
import { AttentionBadge } from "@/workspace/sidebar-item";
import { clashingWorkspaceParents } from "@/workspace/workspace-parents";
import { projectIconKey } from "@/workspace/project-icons";
import { useProjectIcons } from "@/workspace/use-project-icons";

/**
 * The header's workspace name, which switches workspaces: a sheet of the open ones as the sidebar
 * draws them (icon, name, the parent folder when two share a name, a dot when a chat wants a look),
 * then "Open workspace…" for the sidebar's "+" sheet. Work in progress has no dot here; the strip
 * already shows it for this workspace, and a spinner on every row would only be noise.
 */
export function WorkspaceSwitcher({
  workspace,
  project,
  onSelectProject,
  onOpenWorkspace,
  canOpenWorkspace,
}: {
  workspace: WorkspaceSnapshot;
  project: WorkspaceProject;
  canOpenWorkspace: boolean;
  onSelectProject(projectId: string): void;
  onOpenWorkspace(): void;
}) {
  const [open, setOpen] = useState(false);
  // "Open workspace…" opens its sheet once this one has gone, so the two never stack.
  const opening = useRef(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const icons = useProjectIcons(workspace);
  const parents = clashingWorkspaceParents(workspace.projects);
  const chats = useAgents();
  const terminals = useTerminalSessions();
  const native = useNativeSurface(
    trigger,
    { kind: "button", icon: "chevron", label: "Workspace", title: project.name, disabled: false },
    (event) => {
      if (event.kind === "press" && event.control === "activate") setOpen((value) => !value);
    },
  );
  const choose = (projectId: string) => {
    setOpen(false);
    if (projectId !== project.id) onSelectProject(projectId);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          ref={trigger}
          data-native-surface={native || undefined}
          aria-hidden={native || undefined}
          tabIndex={native ? -1 : undefined}
          type="button"
          className="mobile-select-trigger mobile-picker mobile-glass"
          aria-label={`Workspace: ${project.name}`}
          aria-haspopup="dialog"
          aria-controls={id}
          aria-expanded={open}
        >
          <span className="mobile-picker-breadcrumb">
            <span>{project.name}</span>
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
            list.current?.querySelector<HTMLElement>('[aria-current="page"]') ??
            list.current?.querySelector<HTMLElement>("button")
          )?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opening.current) {
            opening.current = false;
            onOpenWorkspace();
            return;
          }
          requestAnimationFrame(() => {
            if (!document.querySelector('[data-slot="dialog-content"][data-state="open"]'))
              trigger.current?.focus({ preventScroll: true });
          });
        }}
      >
        <DialogHeader>
          <DialogTitle>Workspaces</DialogTitle>
        </DialogHeader>
        <div
          ref={list}
          className="mobile-workspace-list"
          onKeyDown={(event) => {
            const items = [...(list.current?.querySelectorAll<HTMLElement>("button") ?? [])];
            const index = items.indexOf(document.activeElement as HTMLElement);
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
          {workspace.projects.map((item) => {
            const current = item.id === project.id;
            const summed = workspaceAttention(item, chats, terminals);
            const attention = summed.kind === "working" ? { ...summed, kind: null } : summed;
            const attentionLabel = attention.kind ? workspaceAttentionLabel(attention) : "";
            const icon = icons.get(projectIconKey(workspace.epoch, item));
            const parent = parents.get(item.id);
            return (
              <div key={item.id} className="mobile-pane-row">
                <button
                  type="button"
                  data-workspace-choice={item.id}
                  aria-current={current ? "page" : undefined}
                  aria-label={attentionLabel ? `${item.name}, ${attentionLabel}` : undefined}
                  className="mobile-pane-choice"
                  onClick={() => choose(item.id)}
                >
                  <span className="relative flex shrink-0">
                    <ProjectImage
                      key={icon?.source ?? "fallback"}
                      source={icon?.source ?? null}
                      isGit={icon?.isGit ?? false}
                      name={item.name}
                    />
                    <AttentionBadge attention={attention} label={attentionLabel} />
                  </span>
                  <span className="block min-w-0 truncate">{item.name}</span>
                  {parent && (
                    <span className="block min-w-0 shrink-[2] truncate text-muted-foreground">
                      {parent}
                    </span>
                  )}
                  <span className="flex-1" />
                  {current && <Check className="mobile-pane-selected" />}
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="mobile-new-tab-button"
          disabled={!canOpenWorkspace}
          onClick={() => {
            opening.current = true;
            setOpen(false);
          }}
        >
          <FolderOpen />
          Open workspace…
        </button>
      </DialogContent>
    </Dialog>
  );
}

import { useRef } from "react";
import { ListChecks, MessageCircle, X } from "lucide-react";
import type { AgentInfo, AgentPending, WorkspaceSnapshot } from "@concors/protocol";
import { cn } from "cn";
import { useAgents } from "@/agents/context";
import { AgentLoadingIcon } from "@/agents/activity";
import { Button } from "@/components/ui/button";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortAge } from "@/lib/format-date";
import { SidebarDot } from "@/workspace/sidebar-tabs";
import { chatState, useMinuteClock } from "@/workspace/sidebar-rows";
import { activityGroups, activityRows, type ActivityRow } from "./activity-model";
import { supervisorAgentName } from "./reference-context";
import { useSupervisorDeliveries } from "./use-activity";

const needsYou = (agent: AgentInfo) =>
  !agent.supervisor && (agent.pending.length > 0 || chatState(agent) === "attention");

/**
 * Opens Activity. It counts what needs you, in the destructive colour the sidebar's dots use; a
 * finish nobody has seen is only a dot, since it can wait. On a phone it is the icon alone.
 */
export function SupervisorActivityButton({
  open,
  compact = false,
  onClick,
}: {
  open: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const agents = useAgents();
  const blockers = agents.filter(needsYou).length;
  const unseen = agents.some((agent) => !agent.supervisor && chatState(agent) === "done");
  const label = blockers ? `Activity, ${blockers} need you` : unseen ? "Activity, new" : "Activity";
  return (
    <SidebarTooltip place="title-bar" content={compact ? null : "Agents by status"}>
      <Button
        type="button"
        variant={open ? "secondary" : "ghost"}
        size={compact ? "icon" : "sm"}
        aria-expanded={open}
        aria-label={label}
        onClick={onClick}
        className="relative text-muted-foreground hover:text-foreground"
      >
        <ListChecks className="size-4" />
        {!compact && "Activity"}
        {blockers > 0 ? (
          <span
            className={cn(
              "rounded-full bg-destructive px-1.5 text-[11px] leading-4 font-medium text-white tabular-nums",
              compact && "absolute -top-0.5 -right-0.5",
            )}
          >
            {blockers}
          </span>
        ) : (
          unseen && (
            <span className={cn(compact && "absolute top-1 right-1")}>
              <SidebarDot dot="done" />
            </span>
          )
        )}
      </Button>
    </SidebarTooltip>
  );
}

/**
 * Agents by what they need from you, beside the Supervisor chat on desktop and in a drawer on a
 * phone. Rows look and read like the sidebar's: the same dots and spinner, a name, an age, and one
 * line of detail. A row opens its agent's chat, where approvals are answered; an approval also
 * offers to ask Supervisor about it first.
 */
export function SupervisorActivity({
  workspace,
  compact,
  onClose,
  onOpenAgent,
  supervisorId,
  canAsk,
  onAsk,
  focusComposer,
}: {
  workspace: WorkspaceSnapshot | null;
  compact: boolean;
  onClose: () => void;
  onOpenAgent: (sessionId: string) => void;
  supervisorId: string | null;
  canAsk: boolean;
  /** Drafts a question about the request in the Supervisor's message. */
  onAsk: (agent: AgentInfo, request: AgentPending) => void;
  focusComposer: () => void;
}) {
  // A phone's drawer returns focus to its button as it closes; after asking, the message takes it.
  const asked = useRef(false);
  const ask = (agent: AgentInfo, request: AgentPending) => {
    onAsk(agent, request);
    if (!compact) return requestAnimationFrame(focusComposer);
    asked.current = true;
    onClose();
  };
  const agents = useAgents();
  const { deliveries, warning } = useSupervisorDeliveries(supervisorId);
  const projects = [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])];
  const names = new Map(projects.map((project) => [project.id, project.name]));
  const rows = activityRows(
    agents.filter((agent) => names.has(agent.projectId)),
    deliveries,
  );
  const now = useMinuteClock();
  const open = (agent: AgentInfo) => {
    // On a phone the drawer covers the chat being opened; beside a desktop chat it stays.
    if (compact) onClose();
    onOpenAgent(agent.id);
  };
  const list = (
    <div className="space-y-3">
      {warning && (
        <p role="status" className="px-2 text-xs text-destructive">
          {warning}
        </p>
      )}
      {!rows.length && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          Nothing needs you. Agents Supervisor sends work to appear here.
        </p>
      )}
      {activityGroups.map((group) => {
        const shown = rows.filter((row) => row.group === group);
        return (
          shown.length > 0 && (
            <section key={group} aria-label={group}>
              <h3 className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground">
                {group}
                <span className="tabular-nums">{shown.length}</span>
              </h3>
              <ul>
                {shown.map((row) => (
                  <ActivityItem
                    key={row.agent.id}
                    row={row}
                    workspace={names.get(row.agent.projectId) ?? ""}
                    now={now}
                    onOpen={() => open(row.agent)}
                    onAsk={
                      row.agent.pending[0]?.kind === "approval"
                        ? () => {
                            const request = row.agent.pending[0];
                            if (request) ask(row.agent, request);
                          }
                        : undefined
                    }
                    canAsk={canAsk}
                  />
                ))}
              </ul>
            </section>
          )
        );
      })}
    </div>
  );

  if (compact)
    return (
      <Dialog open onOpenChange={(next) => !next && onClose()}>
        <DialogContent
          className="gap-3"
          onCloseAutoFocus={(event) => {
            if (!asked.current) return;
            event.preventDefault();
            focusComposer();
          }}
        >
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription className="sr-only">Your agents by status</DialogDescription>
          </DialogHeader>
          <div className="-mx-2">{list}</div>
        </DialogContent>
      </Dialog>
    );

  return (
    <aside
      aria-label="Activity"
      className="flex w-[272px] shrink-0 flex-col border-l bg-sidebar text-ui text-sidebar-foreground"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 px-3">
        <h2 className="min-w-0 flex-1 truncate font-medium">Activity</h2>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close activity"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-3">{list}</div>
    </aside>
  );
}

function ActivityItem({
  row,
  workspace,
  now,
  onOpen,
  onAsk,
  canAsk,
}: {
  row: ActivityRow;
  workspace: string;
  now: number;
  onOpen: () => void;
  onAsk: (() => void) | undefined;
  canAsk: boolean;
}) {
  const name = supervisorAgentName(row.agent);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${name}`}
        className="flex w-full min-w-0 items-start gap-1.5 rounded-md px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent/70 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
          {row.group === "Needs you" ? (
            <SidebarDot dot="attention" />
          ) : row.group === "Working" ? (
            <AgentLoadingIcon className="size-3.5" />
          ) : (
            row.unseen && <SidebarDot dot="done" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {shortAge(row.updatedAt, now)}
            </span>
          </span>
          <span className="flex min-w-0 gap-1 text-xs text-muted-foreground">
            <span className="min-w-0 truncate">
              {[workspace, row.detail].filter(Boolean).join(" · ")}
            </span>
            {row.queued > 0 && <span className="shrink-0">· {row.queued} queued</span>}
          </span>
        </span>
      </button>
      {onAsk && (
        <button
          type="button"
          disabled={!canAsk}
          onClick={onAsk}
          className="mb-1 ml-7 flex items-center gap-1 rounded px-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <MessageCircle className="size-3" />
          Ask Supervisor
        </button>
      )}
    </li>
  );
}

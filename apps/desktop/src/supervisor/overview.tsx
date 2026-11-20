import { useRef, useState } from "react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  CircleX,
  ListChecks,
  MessageCircle,
  X,
} from "lucide-react";
import {
  agentProviderName,
  type AgentInfo,
  type AgentPending,
  type WorkspaceSnapshot,
} from "@concors/protocol";
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
import { briefLine } from "./brief";
import {
  overviewGroups,
  overviewRows,
  type OverviewGroup,
  type OverviewRow,
} from "./overview-model";
import { supervisorAgentName } from "./reference-context";
import { useSupervisorBriefs, useSupervisorDeliveries } from "./use-overview";

const needsYou = (agent: AgentInfo) =>
  !agent.supervisor && (agent.pending.length > 0 || chatState(agent) === "attention");

/**
 * Opens Overview. It counts what needs you, in the destructive colour the sidebar's dots use; a
 * finish nobody has seen is only a dot, since it can wait. On a phone it is the icon alone.
 */
export function SupervisorOverviewButton({
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
  const label = blockers ? `Overview, ${blockers} need you` : unseen ? "Overview, new" : "Overview";
  return (
    <SidebarTooltip place="title-bar" content={compact ? null : "Your sessions at a glance"}>
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
        {!compact && "Overview"}
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
 * Every session at a glance, beside the Supervisor chat on desktop and in a drawer on a phone: what
 * needs you, what is in progress and what is done, each saying in full what it needs and what it
 * last said, so sessions need not be opened one by one to know where they stand. A row opens its
 * session, where approvals are answered; an approval also offers to ask Supervisor about it.
 */
export function SupervisorOverview({
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
  const [folded, setFolded] = useState<ReadonlySet<OverviewGroup>>(new Set());
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
  const shown = new Set(
    (workspace?.projects ?? []).flatMap((project) =>
      project.tabs.flatMap((tab) =>
        tab.nodes.flatMap((node) =>
          node.kind === "pane" && node.profile === "chat" && node.sessionId ? [node.sessionId] : [],
        ),
      ),
    ),
  );
  const known = agents.filter((agent) => names.has(agent.projectId));
  const listed = overviewRows(known, deliveries, shown);
  const briefs = useSupervisorBriefs(listed.map((row) => row.agent));
  const rows = overviewRows(known, deliveries, shown, briefs);
  const now = useMinuteClock();
  const open = (agent: AgentInfo) => {
    // On a phone the drawer covers the session being opened; beside a desktop chat it stays.
    if (compact) onClose();
    onOpenAgent(agent.id);
  };
  const list = (
    <div className="space-y-2">
      {warning && (
        <p role="status" className="px-2 text-xs text-destructive">
          {warning}
        </p>
      )}
      {!rows.length && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">
          Sessions appear here once they reply.
        </p>
      )}
      {overviewGroups.map((group) => {
        const grouped = rows.filter((row) => row.group === group);
        if (!grouped.length) return null;
        const isFolded = folded.has(group);
        return (
          <section key={group} aria-label={group}>
            <button
              type="button"
              aria-expanded={!isFolded}
              onClick={() =>
                setFolded((current) => {
                  const next = new Set(current);
                  if (isFolded) next.delete(group);
                  else next.add(group);
                  return next;
                })
              }
              className="flex w-full items-center gap-1.5 rounded-md bg-muted/70 px-2 py-1.5 text-left text-xs font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {group}
              <span className="text-muted-foreground tabular-nums">{grouped.length}</span>
              <ChevronDown
                className={cn(
                  "size-3.5 text-muted-foreground transition-transform",
                  isFolded && "-rotate-90",
                )}
              />
            </button>
            {!isFolded && (
              <ul className="mt-1 space-y-0.5">
                {grouped.map((row) => (
                  <OverviewItem
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
            )}
          </section>
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
            <DialogTitle>Overview</DialogTitle>
            <DialogDescription className="sr-only">Your sessions by status</DialogDescription>
          </DialogHeader>
          <div className="-mx-2">{list}</div>
        </DialogContent>
      </Dialog>
    );

  return (
    <aside
      aria-label="Overview"
      className="flex w-[340px] shrink-0 flex-col border-l bg-sidebar text-ui text-sidebar-foreground"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3">
        <ListChecks className="size-4 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate font-medium">Overview</h2>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Close overview"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">{list}</div>
    </aside>
  );
}

/** What a row's icon says: the same states the sidebar shows, told apart at a glance. */
function StatusIcon({ row }: { row: OverviewRow }) {
  if (row.group === "Needs you") return <CircleAlert className="size-4 text-destructive" />;
  if (row.group === "In progress") return <AgentLoadingIcon className="size-4" />;
  if (row.agent.status === "failed") return <CircleX className="size-4 text-muted-foreground" />;
  if (row.agent.status === "interrupted")
    return <CircleSlash className="size-4 text-muted-foreground" />;
  return (
    <CircleCheck className={cn("size-4", row.unseen ? "text-primary" : "text-muted-foreground")} />
  );
}

/**
 * One session: its name and age, where it runs, then its one-liners in full, never truncated,
 * because they are the reason to look: what it needs from you, what it is doing, what it did.
 */
function OverviewItem({
  row,
  workspace,
  now,
  onOpen,
  onAsk,
  canAsk,
}: {
  row: OverviewRow;
  workspace: string;
  now: number;
  onOpen: () => void;
  onAsk: (() => void) | undefined;
  canAsk: boolean;
}) {
  const name = supervisorAgentName(row.agent);
  const task = briefLine(row.task);
  const meta = [
    workspace,
    row.agent.providerLabel ?? agentProviderName(row.agent.provider),
    row.queued ? `${row.queued} queued` : "",
  ].filter(Boolean);
  // The update leads; before a session has said anything, what it was asked stands in.
  const said =
    row.update ||
    (row.group === "Done"
      ? row.agent.status === "interrupted"
        ? "Stopped before it replied."
        : ""
      : task);
  return (
    <li className="rounded-md hover:bg-sidebar-accent/60">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <StatusIcon row={row} />
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {shortAge(row.updatedAt, now)}
            </span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{meta.join(" · ")}</span>
          {row.needs && (
            <span className="block text-ui break-words">
              <span className="font-medium text-destructive">{row.needs.action}:</span>{" "}
              {row.needs.text}
            </span>
          )}
          {said && (
            <span
              className={cn(
                "block break-words",
                row.needs ? "text-xs text-muted-foreground" : "text-ui text-foreground/90",
              )}
            >
              {said}
            </span>
          )}
        </span>
      </button>
      {onAsk && (
        <button
          type="button"
          disabled={!canAsk}
          onClick={onAsk}
          className="mb-1 ml-8 flex items-center gap-1 rounded px-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <MessageCircle className="size-3" />
          Ask Supervisor
        </button>
      )}
    </li>
  );
}

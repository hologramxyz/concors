import { useCallback, useRef, useState } from "react";
import { ChevronRight, Folder, ListChecks, MessageCircle, X } from "lucide-react";
import {
  agentProviderName,
  modelName,
  type AgentInfo,
  type AgentPending,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { cn } from "cn";
import { chatAgentStatus } from "@/agents/agent-status";
import { useAgents } from "@/agents/context";
import { useListedAgents } from "@/notifications/context";
import { ProviderIcon } from "@/agents/provider-icon";
import { Button } from "@/components/ui/button";
import { SidebarEmpty, SidebarSection } from "@/components/sidebar-section";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { shortAge } from "@/lib/format-date";
import { RowDot, RowWorking, SidebarDot } from "@/workspace/sidebar-tabs";
import { chatState, useMinuteClock } from "@/workspace/sidebar-rows";
import { briefLine } from "./brief";
import {
  needsYou,
  overviewGroups,
  overviewRows,
  workspaceAgents,
  type OverviewRow,
} from "./overview-model";
import { ApprovalAction, QuickApproval } from "./quick-approval";
import { shortPath } from "@/agents/short-path";
import { useHomePath } from "@/workspace/home-path";
import { supervisorAgentName } from "./reference-context";
import { useSupervisorBriefs, useSupervisorDeliveries } from "./use-overview";

/**
 * Opens Overview. It counts what needs you, in the destructive colour the sidebar's dots use; a
 * finish nobody has seen is only a dot, since it can wait. On a phone it is the icon alone.
 */
export function SupervisorOverviewButton({
  workspace,
  open,
  compact = false,
  onClick,
}: {
  workspace: WorkspaceSnapshot | null;
  open: boolean;
  compact?: boolean;
  onClick: () => void;
}) {
  const agents = workspaceAgents(useAgents(), workspace);
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
 * needs you, what is in progress and what is done, each saying what it needs and what it last said,
 * so sessions need not be opened one by one to know where they stand. It is drawn with
 * the sidebar's own parts (sections, rows, dots, spinner), so the two read as one product. A row
 * opens its session, where approvals are answered; an approval also offers to ask Supervisor.
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
  const ask = (agent: AgentInfo, request: AgentPending) => {
    onAsk(agent, request);
    if (!compact) return requestAnimationFrame(focusComposer);
    asked.current = true;
    onClose();
  };
  const known = workspaceAgents(useAgents(), workspace);
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
  const now = useMinuteClock();
  const [earlierOpen, setEarlierOpen] = useState(false);
  const listed = overviewRows(known, deliveries, shown, null, now);
  // Folded rows need no gist until Earlier is opened.
  const briefs = useSupervisorBriefs(
    listed.filter((row) => earlierOpen || !row.earlier).map((row) => row.agent),
  );
  const rows = overviewRows(known, deliveries, shown, briefs, now);
  // While the panel is open, what it lists needs no card on top of it.
  useListedAgents(rows.map((row) => row.agent.id).sort());
  const open = (agent: AgentInfo) => {
    // On a phone the drawer covers the session being opened; beside a desktop chat it stays.
    if (compact) onClose();
    onOpenAgent(agent.id);
  };
  const list = (
    <div className="space-y-1">
      {warning && <SidebarEmpty tone="alert">{warning}</SidebarEmpty>}
      {!rows.length && (
        <SidebarEmpty>
          Sessions appear here once they reply, grouped by what they need.
        </SidebarEmpty>
      )}
      {overviewGroups.map((group) => {
        const grouped = rows.filter((row) => row.group === group);
        const recent = grouped.filter((row) => !row.earlier);
        const earlier = grouped.filter((row) => row.earlier);
        const item = (row: OverviewRow) => (
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
        );
        return (
          grouped.length > 0 && (
            <SidebarSection
              key={group}
              title={group}
              action={
                recent.length > 0 && (
                  <span className="shrink-0 pr-2 text-xs text-muted-foreground tabular-nums">
                    {recent.length}
                  </span>
                )
              }
            >
              <ul className="space-y-0.5">
                {recent.map(item)}
                {earlier.length > 0 && (
                  // Finishes from past days, folded as the sidebar folds closed chats: history,
                  // not work in hand.
                  <li>
                    <button
                      type="button"
                      aria-expanded={earlierOpen}
                      onClick={() => setEarlierOpen(!earlierOpen)}
                      className="flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-2 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                    >
                      <span className="flex size-[20px] shrink-0 items-center justify-center">
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            "size-3.5 transition-transform motion-reduce:transition-none",
                            earlierOpen && "rotate-90",
                          )}
                        />
                      </span>
                      <span className="flex-1">Earlier</span>
                    </button>
                    {earlierOpen && (
                      <ul aria-label="Earlier" className="mt-0.5 space-y-0.5">
                        {earlier.map(item)}
                      </ul>
                    )}
                  </li>
                )}
              </ul>
            </SidebarSection>
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
      {/* The Files panel's header: icon, title, and a close button with its tooltip. */}
      <div className="m-2 flex h-9 shrink-0 items-center gap-2 px-1 select-none">
        <ListChecks className="size-4" />
        <h2 className="min-w-0 flex-1 truncate font-medium">Overview</h2>
        <SidebarTooltip place="title-bar" content="Close overview">
          <Button size="icon-sm" variant="ghost" aria-label="Close overview" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </SidebarTooltip>
      </div>
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">{list}</div>
    </aside>
  );
}

/**
 * One session, laid out as a sidebar row that goes on: its dot, name and age (a spinner while it
 * works), then which model in which workspace, then its one-liners, because they are the reason to
 * look: what it needs from you, what it is doing or what it did. A paused queue offers "Review
 * queue", which opens the session where it is resumed. An approval says only what it
 * would do, in at most two lines so several fit at once; a longer one unfolds in place, as Earlier
 * does, since nobody should approve what they cannot read in full.
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
  const { agent } = row;
  const home = useHomePath();
  // A file the request names, written from the session's folder, else with "~" for home.
  const short = (path: string) => {
    const relative = shortPath(path, [agent.directory], null);
    return relative === path ? home(path) : relative;
  };
  // An approval is answered here as in its chat; anything else is answered by opening it.
  const request = agent.pending[0]?.kind === "approval" ? agent.pending[0] : undefined;
  const approval = request && row.needs ? row.needs : null;
  const [unfolded, setUnfolded] = useState(false);
  const [clamped, setClamped] = useState(false);
  // Whether two lines cut the action short, measured again as the panel or the text changes.
  const measure = useCallback(
    (text: HTMLElement | null) => {
      if (!text || unfolded) return;
      const check = () => setClamped(text.scrollHeight > text.clientHeight + 1);
      check();
      const observer = new ResizeObserver(check);
      observer.observe(text);
      return () => observer.disconnect();
    },
    [unfolded],
  );
  const foldable = !!approval && (clamped || unfolded);
  const name = supervisorAgentName(agent);
  const task = briefLine(row.task);
  const state = chatState(agent);
  const outcome =
    row.group === "Done" && agent.status === "failed"
      ? "Failed"
      : row.group === "Done" && agent.status === "interrupted"
        ? "Stopped"
        : "";
  const model = agent.model
    ? modelName(agent.model)
    : (agent.providerLabel ?? agentProviderName(agent.provider));
  // A paused queue says what waits in its own line, with the action that resumes it.
  const paused = row.needs?.action === "Queue paused";
  const extras = [row.queued && !paused ? `${row.queued} queued` : "", outcome].filter(Boolean);
  // The latest update leads; before a session has said anything, what it was asked stands in,
  // quieter, since it is the request rather than anything the session said.
  const said = approval ? "" : row.update || (row.group === "Done" ? "" : task);
  const asked = !row.update;
  return (
    <li className="group/row rounded-md hover:bg-sidebar-accent/70 has-[:focus-visible]:bg-sidebar-accent/70">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        data-overview-row={row.group}
        className={cn(
          "flex w-full min-w-0 items-start gap-2 rounded-md py-1.5 pr-2 pl-2 text-left text-ui outline-none",
          foldable && "pb-0",
        )}
      >
        <span className="flex h-5 shrink-0 items-center">
          <RowDot state={state === "working" ? undefined : state} status={chatAgentStatus(agent)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex h-5 min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            {row.group === "In progress" && state === "working" ? (
              <RowWorking />
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {shortAge(row.updatedAt, now)}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex size-3.5 shrink-0 items-center justify-center opacity-80">
              <ProviderIcon provider={agent.provider} size={12} />
            </span>
            <span className="min-w-0 truncate">{model}</span>
            {/* The workspace behind the sidebar's folder icon, so it does not run into the model. */}
            {workspace && (
              <>
                <span className="flex size-3.5 shrink-0 items-center justify-center opacity-80">
                  <Folder className="size-3" aria-hidden="true" />
                </span>
                <span className="min-w-0 truncate">{workspace}</span>
              </>
            )}
            {extras.map((part) => (
              <span key={part} className="shrink-0">
                {part}
              </span>
            ))}
          </span>
          {row.needs && !foldable && (
            <span
              ref={approval ? measure : undefined}
              className={cn(
                "mt-1 block leading-5 break-words text-muted-foreground",
                approval && "line-clamp-2",
              )}
            >
              <NeedsText needs={row.needs} short={short} />
            </span>
          )}
          {said && (
            <span
              className={cn(
                "block leading-5 break-words",
                row.needs ? "text-xs" : "mt-1",
                row.needs || asked ? "text-muted-foreground" : "text-sidebar-foreground/90",
              )}
            >
              {said}
            </span>
          )}
        </span>
      </button>
      {approval && foldable && (
        // A disclosure laid out as the Earlier fold: its chevron in the dot's column.
        <div className="pt-1 pr-2 pb-1.5 pl-2">
          <button
            type="button"
            aria-expanded={unfolded}
            onClick={() => setUnfolded(!unfolded)}
            className="mobile-hit-area flex w-full min-w-0 items-start gap-2 rounded text-left text-ui outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex size-[20px] shrink-0 items-center justify-center text-muted-foreground">
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  "size-3.5 transition-transform motion-reduce:transition-none",
                  unfolded && "rotate-90",
                )}
              />
            </span>
            <span
              ref={measure}
              className={cn(
                "min-w-0 flex-1 leading-5 break-words text-muted-foreground",
                !unfolded && "line-clamp-2",
              )}
            >
              <NeedsText needs={approval} short={short} />
            </span>
          </button>
        </div>
      )}
      {paused && (
        <div className="flex pr-2 pb-2 pl-9">
          <Button size="xs" variant="secondary" onClick={onOpen}>
            Review queue
          </Button>
        </div>
      )}
      {onAsk && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pr-2 pb-2 pl-9">
          {request && <QuickApproval agent={agent} pending={request} />}
          <button
            type="button"
            disabled={!canAsk}
            onClick={onAsk}
            className="flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <MessageCircle className="size-3.5" />
            Ask Supervisor
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * What a session needs. The action leads in full ink and what it is about follows a step quieter;
 * only a failure keeps the error colour, since a request is not an error. A command reads as code
 * by its font alone: a highlight would turn a long one into a block, and a clamped one would show
 * the next line's edge.
 */
function NeedsText({
  needs,
  short,
}: {
  needs: NonNullable<OverviewRow["needs"]>;
  short: (path: string) => string;
}) {
  return (
    <>
      <span
        className={
          needs.action === "Failed"
            ? "font-medium text-destructive"
            : "font-semibold text-sidebar-foreground"
        }
      >
        {needs.action}:
      </span>{" "}
      <ApprovalAction needs={needs} short={short} />
    </>
  );
}

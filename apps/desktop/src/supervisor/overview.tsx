import { useCallback, useRef, useState } from "react";
import { ChevronRight, ListChecks, MessageCircle, X } from "lucide-react";
import {
  agentProviderName,
  modelName,
  type AgentInfo,
  type AgentPending,
  type WorkspaceSnapshot,
} from "@concors/protocol";
import { cn } from "cn";
import { useAgents } from "@/agents/context";
import { useListedAgents } from "@/notifications/context";
import { NoticeChat, RowWorkspace } from "@/agents/timeline-item";
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
import { RowWorking, SidebarDot } from "@/workspace/sidebar-tabs";
import { chatState, useMinuteClock } from "@/workspace/sidebar-rows";
import { briefLine } from "./brief";
import {
  doneInView,
  needsYou,
  overviewGroups,
  overviewRows,
  workspaceAgents,
  unseenDone,
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

/** Whether Done lists every row: kept while the app is open, as the panel opens and closes. */
let doneAllKept = false;

/**
 * Pins each group's header to the top of the scroll area while its rows scroll under it, over the
 * panel's own background (`ground`) so rows do not show through; the header's hover and focus tint
 * is laid over that ground as an image, since the tint alone is see-through.
 */
const pinnedHeaders = (ground: "bg-sidebar" | "bg-popover") =>
  cn(
    "[&>section>div:first-child]:sticky [&>section>div:first-child]:top-0 [&>section>div:first-child]:z-10",
    ground === "bg-sidebar"
      ? "[--header-tint:color-mix(in_oklab,var(--sidebar-accent)_70%,transparent)] [&>section>div:first-child]:bg-sidebar [&>section>div:first-child:has(:focus-visible:not([data-pointer-focus]))]:[background-image:linear-gradient(var(--header-tint),var(--header-tint))] [&>section>div:first-child:hover]:[background-image:linear-gradient(var(--header-tint),var(--header-tint))]"
      : // Square on a phone, where it has no hover tint, so rows do not show at its corners.
        "[&>section>div:first-child]:rounded-none [&>section>div:first-child]:bg-popover",
  );

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
  const [doneAll, setDoneAllState] = useState(doneAllKept);
  const setDoneAll = (next: boolean) => {
    doneAllKept = next;
    setDoneAllState(next);
  };
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
    // Rows stand apart by space alone, and groups further apart than rows.
    <div className={cn("space-y-3", pinnedHeaders(compact ? "bg-popover" : "bg-sidebar"))}>
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
        // Done shows its latest few and every unopened finish until it is asked for all; the rest,
        // Earlier included, wait behind "Show all", which then reads "Show fewer".
        const folded = group === "Done" ? doneInView(recent, false) : { shown: recent, hidden: 0 };
        const more = folded.hidden > 0;
        const inView = more && doneAll ? recent : folded.shown;
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
              label
              action={
                recent.length > 0 && (
                  <span className="shrink-0 pr-2 text-xs text-muted-foreground tabular-nums">
                    {recent.length}
                  </span>
                )
              }
            >
              <ul className="space-y-2">
                {inView.map(item)}
                {earlier.length > 0 && (!more || doneAll) && (
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
                      <ul aria-label="Earlier" className="mt-1 space-y-1">
                        {earlier.map(item)}
                      </ul>
                    )}
                  </li>
                )}
                {more && (
                  <li>
                    {/* Quiet as the Earlier fold, in the rows' text column; a full tap on a phone. */}
                    <button
                      type="button"
                      aria-expanded={doneAll}
                      onClick={() => setDoneAll(!doneAll)}
                      className={cn(
                        "flex w-full items-center rounded-md pr-2 pl-8 text-left text-xs text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                        compact ? "min-h-[44px]" : "h-7",
                      )}
                    >
                      {doneAll ? "Show fewer" : "Show all"}
                    </button>
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
          // The close button stays above the strip that keeps rows out of the drawer's top padding.
          className="gap-3 [&>[data-slot=dialog-actions]]:z-30"
          onCloseAutoFocus={(event) => {
            if (!asked.current) return;
            event.preventDefault();
            focusComposer();
          }}
        >
          <DialogHeader className="relative z-20">
            <DialogTitle>Overview</DialogTitle>
            <DialogDescription className="sr-only">Your sessions by status</DialogDescription>
          </DialogHeader>
          <div className="-mx-2">
            {/* The drawer scrolls inside its 34px top padding (mobile.css), where pinned headers
                stop short; this strip of its background rests there so rows do not show above
                them. It takes no room: it starts 34px above the list. */}
            <div
              aria-hidden="true"
              className="pointer-events-none sticky -top-[34px] z-10 -mt-[34px] h-[34px] bg-popover"
            />
            {list}
          </div>
        </DialogContent>
      </Dialog>
    );

  return (
    <aside
      aria-label="Overview"
      className="flex w-[340px] shrink-0 flex-col border-l bg-sidebar text-ui text-sidebar-foreground"
    >
      {/* The Files panel's close button with its tooltip; the toolbar's button already names it. */}
      <div className="mx-2 mt-2 flex h-7 shrink-0 items-center justify-end px-1 select-none">
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
 * One session, led by the Supervisor chat's notice line so the two read as one row: its provider's
 * mark, "Workspace / Chat" with the chat's name in the stronger weight, how it ended or what is
 * queued, then its age (a spinner while it works, the unseen dot before an unopened finish). Under
 * it, in the text's column, its one-liners, because they are the reason to look: what it needs from
 * you, what it is doing or what it did, two lines at most; last, its model, quietest of all. A
 * paused queue offers "Review queue", which opens the session where it is resumed. An approval says only what it
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
  // quieter, since it is the request rather than anything the session said. An approval or a
  // paused queue says what it needs and nothing more, as the Supervisor chat's rows do.
  const said = approval || paused ? "" : row.update || (row.group === "Done" ? "" : task);
  // The whole row opens its session, as a notice row's toggle lies under its line: the button
  // spans the row and the row's own controls sit above it.
  const control = "pointer-events-auto";
  return (
    <li className="relative rounded-md hover:bg-sidebar-accent/70 has-[:focus-visible]:bg-sidebar-accent/70">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${name}`}
        data-overview-row={row.group}
        className="absolute inset-0 rounded-md outline-none"
      />
      <div className="pointer-events-none relative flex min-w-0 items-start gap-2 px-2 py-2 text-ui">
        <span className="flex h-5 shrink-0 items-center">
          <RowWorkspace sessionId={agent.id} />
        </span>
        <div className="min-w-0 flex-1">
          {/* The Supervisor chat's notice line: "Workspace / Chat", then how it ended or what waits. */}
          <div className="flex h-5 min-w-0 items-center gap-2">
            <NoticeChat
              title
              chat={{ workspace, label: name }}
              sessionId={agent.id}
              className="flex-1"
            >
              {extras.length > 0 &&
                extras.map((part) => (
                  <span
                    key={part}
                    className={cn(
                      "text-xs [text-box:trim-both_cap_alphabetic]",
                      part === "Failed" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {part}
                  </span>
                ))}
            </NoticeChat>
            {row.group === "In progress" && state === "working" ? (
              <span className="ml-auto flex shrink-0">
                <RowWorking />
              </span>
            ) : (
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {state === "done" && (
                  // Level with the middle of the time's lowercase letters, not its capitals: it
                  // rests on the time's baseline, raised by half the x-height less half its size.
                  <span className="mb-[calc(0.5ex-2.5px)] flex self-end text-xs">
                    <SidebarDot dot="done" />
                  </span>
                )}
                <span className="text-xs text-muted-foreground tabular-nums [text-box:trim-both_cap_alphabetic]">
                  {shortAge(row.updatedAt, now)}
                </span>
              </span>
            )}
          </div>
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
          {approval && foldable && (
            // A disclosure as the Earlier fold, its chevron leading the text column.
            <button
              type="button"
              aria-expanded={unfolded}
              onClick={() => setUnfolded(!unfolded)}
              className={cn(
                control,
                "mobile-hit-area mt-1 flex w-full min-w-0 items-start gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex h-5 shrink-0 items-center text-muted-foreground">
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
          )}
          {said && (
            <span
              className={cn(
                // A step smaller than the title above it, so the title reads as one.
                "mt-1 block text-xs leading-5 break-words text-muted-foreground",
                // Needs you keeps its line as it is; an unopened finish keeps two lines, as it is
                // news; the rest say their gist in one.
                row.needs ? "" : unseenDone(row) ? "line-clamp-2" : "truncate",
              )}
            >
              {said}
            </span>
          )}
          {paused && (
            <div className="my-2.5 flex">
              {/* Outlined as the Supervisor chat's "Review queue" and the approval card's Decline. */}
              <Button size="xs" variant="outline" className={control} onClick={onOpen}>
                Review queue
              </Button>
            </div>
          )}
          {onAsk && (
            // Further from the answers than they are from each other, so asking reads as its own,
            // quieter choice.
            <div className="my-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
              {request && <QuickApproval agent={agent} pending={request} className={control} />}
              <button
                type="button"
                disabled={!canAsk}
                onClick={onAsk}
                className={cn(
                  control,
                  "mobile-hit-area flex items-center gap-1 rounded text-xs text-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                )}
              >
                <MessageCircle className="size-3.5" />
                {/* Trimmed to its capitals, so the icon centres on the letters rather than on a line
                    box that runs below them. */}
                <span className="[text-box:trim-both_cap_alphabetic]">Ask Supervisor</span>
              </button>
            </div>
          )}
          {/* The provider's mark before the model's name, as the composer's model picker has them;
              set off from the line above it as lines in a row are, unless actions already are. */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground",
              !paused && !onAsk && "mt-1",
            )}
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center opacity-80">
              <ProviderIcon provider={agent.provider} size={12} />
            </span>
            <span className="min-w-0 truncate">{model}</span>
          </span>
        </div>
      </div>
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
      {/* Everything under Needs you waits on a person, so its state wears the attention dot, as the
          Supervisor chat's Needs block does, even when the chat's own state is quiet. */}
      <span className="mr-1.5 inline-flex h-5 items-center align-top">
        <SidebarDot dot="attention" />
      </span>
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

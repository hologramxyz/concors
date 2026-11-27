import type {
  AgentInfo,
  SupervisorBrief,
  SupervisorDelivery,
  WorkspaceSnapshot,
} from "@concors/protocol";
import { approvalParts, approvalSummary } from "@/agents/approval-summary";
import { closedChatIds } from "@/agents/closed-chats";
import { chatState } from "@/workspace/sidebar-rows";
import { briefLine } from "./brief";
import { waitingWords } from "./paused-notice";

/**
 * Overview lists sessions, not tasks: one row each, under the group a person acts on, saying what
 * it needs and what it last said, so nobody has to open sessions one by one to triage them. A
 * question, approval, unseen failure or paused queue with instructions waiting needs you, as the
 * Supervisor chat marks them; a reply in progress or queued work is in progress; everything else
 * that has replied, in an open tab or sent work by Supervisor, is done. Chats that never replied
 * stay out, and so do closed chats (no open pane shows them) unless they need you or Supervisor
 * sent them work: someone who closed a chat is done with it, but an agent waiting on a person
 * must not be left stuck where nobody looks.
 */
export type OverviewGroup = "Needs you" | "In progress" | "Done";
export const overviewGroups: readonly OverviewGroup[] = ["Needs you", "In progress", "Done"];
/** Done is history: the most recent rows are what is worth a glance beside the chat. */
export const DONE_LIMIT = 20;
/**
 * How long a finish stays in Done's view. Older ones fold under Earlier, so sessions from past
 * days do not pile up over today's, while one nobody has opened yet stays in view however old.
 */
export const RECENT_MS = 24 * 60 * 60 * 1000;

export interface OverviewRow {
  agent: AgentInfo;
  group: OverviewGroup;
  /**
   * What the person must do, in full: approve a request, answer a question, look at a failure.
   * `code` marks a command, shown as code rather than prose. A request a tool makes on a file or
   * address has `verb` (the tool) apart from `text` (what it acts on, in full), so the two can be
   * set side by side without a separator; `path` says `text` is a file, which the row shortens.
   */
  needs: { action: string; text: string; code?: boolean; verb?: string; path?: boolean } | null;
  /** The gist of its latest reply: progress while it works, the outcome once it is done. */
  update: string;
  /**
   * What the current turn was asked. Supervisor's latest instruction stands in until the turn's
   * brief arrives, or on a daemon without briefs, though it may belong to an earlier turn.
   */
  task: string;
  /** Follow-ups waiting behind the current turn. */
  queued: number;
  /** A seen finish from before the last day, folded under Earlier in Done. */
  earlier: boolean;
  updatedAt: string;
}

/** Sessions in the machine's workspaces, open or closed: what Overview lists and its button counts. */
export function workspaceAgents(agents: readonly AgentInfo[], workspace: WorkspaceSnapshot | null) {
  const projects = new Set(
    [...(workspace?.projects ?? []), ...(workspace?.closedProjects ?? [])].map((p) => p.id),
  );
  return agents.filter((agent) => projects.has(agent.projectId));
}

/**
 * Which sessions an open tab shows as a chat, and which are closed: no open pane shows them, as
 * the sidebar's Closed fold means it.
 */
export function overviewChats(workspace: WorkspaceSnapshot | null, agents: readonly AgentInfo[]) {
  const shown = new Set(
    (workspace?.projects ?? []).flatMap((project) =>
      project.tabs.flatMap((tab) =>
        tab.nodes.flatMap((node) =>
          node.kind === "pane" && node.profile === "chat" && node.sessionId ? [node.sessionId] : [],
        ),
      ),
    ),
  );
  return { shown, closed: closedChatIds(workspace, agents) };
}

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";

/** A queue held paused with instructions in it, which waits on someone to resume it. */
export const queuePaused = (agent: AgentInfo) => !!agent.queuePaused && !!agent.queue?.length;

/** Whether a session belongs under Needs you, which the Overview button also counts. */
export const needsYou = (agent: AgentInfo) =>
  !agent.supervisor &&
  (agent.pending.length > 0 || chatState(agent) === "attention" || queuePaused(agent));

function needs(agent: AgentInfo): OverviewRow["needs"] {
  const pending = agent.pending[0];
  if (pending?.kind === "approval") {
    const summary = approvalSummary(pending);
    if (!summary) return { action: "Approve", text: pending.title };
    // A file operation reads as its verb and the file, e.g. "Edit src/app.ts".
    const { tool, target, path } = approvalParts(pending);
    if (tool && target)
      return { action: "Approve", verb: tool, text: target, ...(path ? { path: true } : {}) };
    return { action: "Approve", text: firstLine(summary), code: true };
  }
  if (pending?.kind === "questions")
    return {
      action: "Answer",
      text: pending.questions.map((q) => q.question).join(" ") || pending.title,
    };
  if (pending) return { action: "Respond", text: pending.summary || pending.title };
  // A failure already seen needs nothing more; its paused queue, if any, still does.
  if (agent.status === "failed" && chatState(agent) === "attention")
    return { action: "Failed", text: firstLine(agent.error ?? "") || "The turn failed." };
  if (agent.status === "needs_input") return { action: "Respond", text: "It is waiting for you." };
  if (queuePaused(agent))
    return { action: "Queue paused", text: waitingWords(agent.queue?.length ?? 0) };
  return null;
}

export function overviewRows(
  agents: readonly AgentInfo[],
  deliveries: readonly SupervisorDelivery[],
  /** Sessions an open tab shows. */
  shown: ReadonlySet<string> = new Set(),
  briefs: ReadonlyMap<string, SupervisorBrief> | null = null,
  now = Date.now(),
  /** Sessions no open pane shows, which only Needs you and Supervisor's own work keep listed. */
  closed: ReadonlySet<string> = new Set(),
): OverviewRow[] {
  // Deliveries arrive newest first. The one in progress says what the agent is doing; without
  // one, the latest says what it was last asked.
  const asked = new Map<string, SupervisorDelivery>();
  const current = (d: SupervisorDelivery) => d.status === "working" || d.status === "needs_input";
  for (const delivery of deliveries) {
    const known = asked.get(delivery.sessionId);
    if (!known || (!current(known) && current(delivery))) asked.set(delivery.sessionId, delivery);
  }
  const rows = agents.flatMap<OverviewRow>((agent) => {
    if (agent.supervisor) return [];
    const state = chatState(agent);
    const delivery = asked.get(agent.id);
    const queued = agent.queue?.length ?? 0;
    const group: OverviewGroup | null = needsYou(agent)
      ? "Needs you"
      : closed.has(agent.id) && !delivery
        ? null
        : state === "working" || queued
          ? "In progress"
          : delivery || state === "done" || (shown.has(agent.id) && agent.turnId)
            ? "Done"
            : null;
    if (!group) return [];
    // A brief describes one turn; an earlier turn's says nothing about the current one.
    const brief = briefs?.get(agent.id);
    const turn = brief && brief.turnId === agent.turnId ? brief : null;
    return [
      {
        agent,
        group,
        needs: group === "Needs you" ? needs(agent) : null,
        update: turn ? briefLine(turn.reply) : "",
        task: firstLine(turn?.prompt ?? "") || firstLine(delivery?.text ?? ""),
        queued,
        earlier:
          group === "Done" && state !== "done" && now - Date.parse(agent.updatedAt) > RECENT_MS,
        updatedAt: agent.updatedAt,
      },
    ];
  });
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  // A finish nobody has opened is news however old, so the limit only drops seen ones.
  const done = rows
    .filter((row) => row.group === "Done" && chatState(row.agent) !== "done")
    .slice(DONE_LIMIT);
  return rows.filter((row) => !done.includes(row));
}

/** How many of Done's rows show until it is expanded: enough for a glance at what just finished. */
export const DONE_SHOWN = 5;

/** A finish nobody has opened yet, which keeps its dot. */
export const unseenDone = (row: OverviewRow) =>
  row.group === "Done" && chatState(row.agent) === "done";

/**
 * The Done rows in view, in the order given: the most recent few until `all` is asked for, plus
 * every finish nobody has opened, however far down, since those are news. `hidden` counts the rest.
 */
export function doneInView(rows: readonly OverviewRow[], all: boolean) {
  const shown = all
    ? [...rows]
    : rows.filter((row, index) => index < DONE_SHOWN || unseenDone(row));
  return { shown, hidden: rows.length - shown.length };
}

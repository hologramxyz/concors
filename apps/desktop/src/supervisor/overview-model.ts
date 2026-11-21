import type {
  AgentInfo,
  SupervisorBrief,
  SupervisorDelivery,
  WorkspaceSnapshot,
} from "@concors/protocol";
import { approvalSummary } from "@/agents/approval-summary";
import { chatState } from "@/workspace/sidebar-rows";
import { briefLine } from "./brief";

/**
 * Overview lists sessions, not tasks: one row each, under the group a person acts on, saying what
 * it needs and what it last said, so nobody has to open sessions one by one to triage them. A
 * question, approval or unseen failure needs you; a reply in progress or queued work is in
 * progress; everything else that has replied, in an open tab or sent work by Supervisor, is done.
 * Chats that never replied stay out.
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
   * `code` marks a command, shown as code rather than prose.
   */
  needs: { action: string; text: string; code?: boolean } | null;
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

const firstLine = (text: string) => text.trim().split("\n")[0]?.trim() ?? "";

/** A path inside the session's folder, as it would be written there. */
function relative(path: string, directory: string) {
  const root = directory.replace(/\/+$/, "") + "/";
  return path.startsWith(root) ? path.slice(root.length) : path;
}

function needs(agent: AgentInfo): OverviewRow["needs"] {
  const pending = agent.pending[0];
  if (pending?.kind === "approval") {
    const summary = approvalSummary(pending);
    if (!summary) return { action: "Approve", text: pending.title };
    // A file operation reads as its verb and the file, e.g. "Edit src/app.ts".
    const [verb, path] = firstLine(summary).split(" · ");
    if (path && verb && /^[A-Z][a-z]+(?: [a-z]+)*$/.test(verb))
      return { action: "Approve", text: `${verb} ${relative(path, agent.directory)}` };
    return { action: "Approve", text: firstLine(summary), code: true };
  }
  if (pending?.kind === "questions")
    return {
      action: "Answer",
      text: pending.questions.map((q) => q.question).join(" ") || pending.title,
    };
  if (pending) return { action: "Respond", text: pending.summary || pending.title };
  if (agent.status === "failed")
    return { action: "Failed", text: firstLine(agent.error ?? "") || "The turn failed." };
  if (agent.status === "needs_input") return { action: "Respond", text: "It is waiting for you." };
  return null;
}

export function overviewRows(
  agents: readonly AgentInfo[],
  deliveries: readonly SupervisorDelivery[],
  /** Sessions an open tab shows. */
  shown: ReadonlySet<string> = new Set(),
  briefs: ReadonlyMap<string, SupervisorBrief> | null = null,
  now = Date.now(),
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
    const group: OverviewGroup | null =
      agent.pending.length || state === "attention"
        ? "Needs you"
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

import type { AgentInfo, SupervisorBrief, SupervisorDelivery } from "@concors/protocol";
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
  /** What the turn was asked: Supervisor's instruction, else the turn's own prompt. */
  task: string;
  /** Follow-ups waiting behind the current turn. */
  queued: number;
  /** A finish or failure the user has not opened yet, marked as the sidebar marks it. */
  unseen: boolean;
  updatedAt: string;
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
        task: firstLine(delivery?.text ?? "") || firstLine(turn?.prompt ?? ""),
        queued,
        unseen: state === "done",
        updatedAt: agent.updatedAt,
      },
    ];
  });
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const done = rows.filter((row) => row.group === "Done").slice(DONE_LIMIT);
  return rows.filter((row) => !done.includes(row));
}

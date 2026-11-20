import type { AgentInfo, SupervisorBrief, SupervisorDelivery } from "@concors/protocol";
import { approvalSummary } from "@/agents/approval-summary";
import { chatState } from "@/workspace/sidebar-rows";
import { briefLine } from "./brief";

/**
 * Activity lists sessions, not tasks: one row each, under the group a person acts on, with what it
 * needs and the gist of its latest output, so nobody has to open chats one by one to triage them.
 * A question, approval or unseen failure needs you; a reply in progress or queued work is working;
 * everything else that has replied, in an open tab or sent work by Supervisor, is done. Chats that
 * never replied stay out.
 */
export type ActivityGroup = "Needs you" | "Working" | "Done";
export const activityGroups: readonly ActivityGroup[] = ["Needs you", "Working", "Done"];
/** Done is history: the most recent rows are what is worth a glance beside the chat. */
export const DONE_LIMIT = 20;

export interface ActivityRow {
  agent: AgentInfo;
  group: ActivityGroup;
  /** The one line under the name: what it asks, what it is doing, or how it ended. */
  detail: string;
  /** The gist of its latest reply, when the daemon could say; empty while a reply is written. */
  summary: string;
  /** Follow-ups waiting behind the current turn, shown beside the detail rather than in it. */
  queued: number;
  /** A finish or failure the user has not opened yet, marked as the sidebar marks it. */
  unseen: boolean;
  updatedAt: string;
}

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 180) ?? "";

export function activityRows(
  agents: readonly AgentInfo[],
  deliveries: readonly SupervisorDelivery[],
  /** Sessions an open tab shows. */
  shown: ReadonlySet<string> = new Set(),
  briefs: ReadonlyMap<string, SupervisorBrief> | null = null,
): ActivityRow[] {
  // Deliveries arrive newest first. The one in progress says what the agent is doing; queued ones
  // are only counted. Without one in progress, the latest says what it was last asked.
  const asked = new Map<string, SupervisorDelivery>();
  const current = (d: SupervisorDelivery) => d.status === "working" || d.status === "needs_input";
  for (const delivery of deliveries) {
    const known = asked.get(delivery.sessionId);
    if (!known || (!current(known) && current(delivery))) asked.set(delivery.sessionId, delivery);
  }
  const rows = agents.flatMap<ActivityRow>((agent) => {
    if (agent.supervisor) return [];
    const state = chatState(agent);
    const delivery = asked.get(agent.id);
    const queued = agent.queue?.length ?? 0;
    const group: ActivityGroup | null =
      agent.pending.length || state === "attention"
        ? "Needs you"
        : state === "working" || queued
          ? "Working"
          : delivery || state === "done" || (shown.has(agent.id) && agent.turnId)
            ? "Done"
            : null;
    if (!group) return [];
    const pending = agent.pending[0];
    const brief = briefs?.get(agent.id);
    // What the current turn was asked, for a session Supervisor did not send the work to.
    const currentPrompt = brief && brief.turnId === agent.turnId ? brief.prompt : "";
    const task = delivery ? firstLine(delivery.text) : "";
    const detail =
      group === "Needs you"
        ? pending
          ? approvalSummary(pending) || pending.title
          : agent.status === "failed"
            ? firstLine(agent.error ?? "") || "Failed"
            : task
        : group === "Working"
          ? task || firstLine(currentPrompt)
          : agent.status === "failed" || agent.status === "interrupted"
            ? [agent.status === "failed" ? "Failed" : "Stopped", task].filter(Boolean).join(" · ")
            : task;
    return [
      {
        agent,
        group,
        detail: firstLine(detail),
        summary:
          group !== "Working" && brief && brief.turnId === agent.turnId
            ? briefLine(brief.reply)
            : "",
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

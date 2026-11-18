import type { AgentInfo, SupervisorDelivery } from "@concors/protocol";
import { approvalSummary } from "@/agents/approval-summary";
import { chatState } from "@/workspace/sidebar-rows";

/**
 * Activity lists agents, not tasks: one row each, under the group a person acts on. A question,
 * approval or unseen failure needs you; a reply in progress or queued work is working; the rest of
 * what Supervisor delegated, and any finish not yet seen, is done. Idle chats Supervisor never
 * touched stay out, so the panel is a status summary rather than a second chat list.
 */
export type ActivityGroup = "Needs you" | "Working" | "Done";
export const activityGroups: readonly ActivityGroup[] = ["Needs you", "Working", "Done"];
/** Done is history: only the most recent rows are worth a glance beside the chat. */
export const DONE_LIMIT = 8;

export interface ActivityRow {
  agent: AgentInfo;
  group: ActivityGroup;
  /** The one line under the name: what it asks, what it is doing, or how it ended. */
  detail: string;
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
          : delivery || state === "done"
            ? "Done"
            : null;
    if (!group) return [];
    const pending = agent.pending[0];
    const task = delivery ? firstLine(delivery.text) : "";
    const detail =
      group === "Needs you"
        ? pending
          ? approvalSummary(pending) || pending.title
          : agent.status === "failed"
            ? firstLine(agent.error ?? "") || "Failed"
            : task
        : group === "Working"
          ? task || (queued ? "" : "Working")
          : agent.status === "failed" || agent.status === "interrupted"
            ? [agent.status === "failed" ? "Failed" : "Stopped", task].filter(Boolean).join(" · ")
            : task || "Finished";
    return [
      {
        agent,
        group,
        detail: firstLine(detail),
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

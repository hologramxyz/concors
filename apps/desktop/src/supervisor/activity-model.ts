import type { AgentInfo, SupervisorDelivery } from "@concors/protocol";

export type ActivityGroup = "Needs you" | "Working" | "Queued" | "Stopped" | "Finished" | "Ready";
export const activityGroups: readonly ActivityGroup[] = [
  "Needs you",
  "Working",
  "Queued",
  "Stopped",
  "Finished",
  "Ready",
];

const deliveryGroup: Record<SupervisorDelivery["status"], ActivityGroup> = {
  pending: "Queued",
  queued: "Queued",
  working: "Working",
  needs_input: "Needs you",
  done: "Finished",
  failed: "Stopped",
  interrupted: "Stopped",
  cancelled: "Stopped",
};

export interface ActivityRow {
  id: string;
  agent: AgentInfo;
  group: ActivityGroup;
  task?: string;
  updatedAt: string;
}

export function activityRows(agents: AgentInfo[], deliveries: readonly SupervisorDelivery[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const rows = deliveries.flatMap<ActivityRow>((delivery) => {
    const agent = byId.get(delivery.sessionId);
    if (!agent) return [];
    return [
      {
        id: delivery.id,
        agent,
        group: deliveryGroup[delivery.status],
        task: delivery.text.trim().split("\n")[0]?.slice(0, 180) ?? "",
        updatedAt: delivery.updatedAt,
      },
    ];
  });
  const activeSessions = new Set(
    rows.filter((row) => ["Needs you", "Working"].includes(row.group)).map((row) => row.agent.id),
  );
  const recentFinished = new Set(
    rows.filter((row) => row.group === "Finished").map((row) => row.agent.id),
  );
  for (const agent of agents) {
    const group: ActivityGroup =
      agent.pending.length || agent.status === "needs_input"
        ? "Needs you"
        : agent.status === "working" || agent.status === "starting"
          ? "Working"
          : agent.status === "failed" || agent.status === "interrupted"
            ? "Stopped"
            : agent.status === "done"
              ? "Finished"
              : "Ready";
    if (activeSessions.has(agent.id) || (group === "Finished" && recentFinished.has(agent.id)))
      continue;
    rows.push({ id: agent.id, agent, group, updatedAt: agent.updatedAt });
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

import {
  SUB_AGENT_STEPS,
  type AgentActivityStep,
  type AgentInfo,
  type AgentItem,
} from "@concors/protocol";
import { LIVE_SUB_AGENT, type SubAgentTarget } from "./sub-agent-context";

/** One sub-agent still working: what a chat pins so it stays in view while the timeline scrolls. */
export interface RunningSubAgent extends SubAgentTarget {
  key: string;
  /** What it was asked to do, from the call that started it. */
  task: string;
  steps: AgentActivityStep[];
}

type ChatTurn = Pick<AgentInfo, "status" | "backgroundAgents"> & { turnId: string | null };

/** The chat's rows that mention sub-agents, the separately tracked copy winning as the fresher. */
export function knownSubAgentRows(items: readonly AgentItem[], tracked: readonly AgentItem[]) {
  const ids = new Set(tracked.map((item) => item.id));
  return [
    ...items.filter((item) => item.presentation?.type === "sub_agent" && !ids.has(item.id)),
    ...tracked,
  ].sort((a, b) => a.position - b.position);
}

/**
 * Which sub-agents are working now, in the order they started. A row alone cannot say: a finished
 * turn leaves nothing running except what was sent to the background, and Codex reports one child
 * across several calls (spawn, then wait), so the latest call speaks for it.
 */
export function runningSubAgents(rows: readonly AgentItem[], chat: ChatTurn): RunningSubAgent[] {
  const turnActive = chat.status === "working" || chat.status === "needs_input";
  const found = new Map<string, { task: string; running: RunningSubAgent | null }>();
  for (const row of rows) {
    const data = row.presentation;
    // Progress notes about a child, whose status is an event name rather than its state.
    if (data?.type !== "sub_agent" || row.title === "Sub-agent activity") continue;
    const live =
      row.status !== "failed" &&
      row.status !== "interrupted" &&
      ((turnActive && row.turnId === chat.turnId) ||
        (!!data.background && row.status === "running" && (chat.backgroundAgents ?? 0) > 0));
    const children = data.children ?? [];
    const steps = data.activity ?? [];
    const task = (key: string) => found.get(key)?.task ?? row.text;
    if (!children.length) {
      found.set(row.id, {
        task: task(row.id),
        running:
          live && row.status === "running"
            ? { key: row.id, item: row, task: task(row.id), steps }
            : null,
      });
      continue;
    }
    children.forEach((child, index) => {
      found.set(child.id, {
        task: task(child.id),
        running:
          live && LIVE_SUB_AGENT.includes(child.status)
            ? {
                key: child.id,
                item: row,
                childId: child.id,
                index: children.length > 1 ? index : undefined,
                task: task(child.id),
                steps:
                  children.length > 1 ? steps.filter((step) => step.childId === child.id) : steps,
              }
            : null,
      });
    });
  }
  return [...found.values()].flatMap(({ running }) => (running ? [running] : []));
}

/** "3 steps", or "40+ steps" once a row has started dropping its oldest. */
export function stepCount(steps: readonly unknown[]): string | null {
  if (!steps.length) return null;
  if (steps.length >= SUB_AGENT_STEPS) return `${steps.length}+ steps`;
  return `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
}

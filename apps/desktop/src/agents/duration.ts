import type { AgentItem } from "@concors/protocol";

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

export function completedTurnFooters(items: AgentItem[]) {
  const replies = new Map<string, string>();
  for (const item of items) if (item.kind === "assistant") replies.set(item.turnId, item.id);
  const durations = new Map<string, string>();
  const hidden = new Set<string>();
  for (const item of items) {
    if (item.kind !== "system" || item.id !== `turn:${item.turnId}` || item.status !== "completed")
      continue;
    const match = /^(\d+)s$/.exec(item.text);
    const reply = replies.get(item.turnId);
    if (match && reply) {
      durations.set(reply, formatDuration(Number(match[1])));
      hidden.add(item.id);
    }
  }
  return { durations, hidden };
}

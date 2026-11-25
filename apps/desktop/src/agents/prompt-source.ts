import type { AgentItem } from "@concors/protocol";

export function promptSourceLabel(
  item: Pick<AgentItem, "kind" | "origin" | "trigger">,
): string | null {
  if (item.kind !== "user") return null;
  if (item.trigger) return `From webhook · ${item.trigger.source}`;
  return item.origin ? "From Supervisor" : null;
}

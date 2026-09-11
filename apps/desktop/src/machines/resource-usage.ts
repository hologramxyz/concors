import type { Machine } from "@concors/api-client";

export function usagePercent(capacity: { totalBytes: number; availableBytes: number }): number {
  return Math.round((1 - capacity.availableBytes / capacity.totalBytes) * 100);
}
export function formatResourceBytes(bytes: number): string {
  const gib = bytes / 1024 ** 3;
  return gib >= 1 ? `${gib.toFixed(1)} GiB` : `${Math.round(bytes / 1024 ** 2)} MiB`;
}
export function resourceFreshness(machine: Pick<Machine, "status" | "resourceUsage">, now: number) {
  const usage = machine.resourceUsage;
  if (!usage || (!usage.memory && !usage.disk)) return "unavailable";
  const age = now - Date.parse(usage.sampledAt);
  return machine.status === "running" && age >= -5000 && age < 90_000 ? "fresh" : "stale";
}
